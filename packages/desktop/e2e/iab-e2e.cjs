/**
 * End-to-end proof that the in-app browser works, run inside a real Electron main process.
 *
 * Everything here is the real thing: a real `BrowserWindow` with the real preload, the real
 * `WebContentsView`, the real relay, the real `/iab` transport, and the real executor driving
 * Playwright over CDP. The only substitution is the page — a local fixture served over loopback, so
 * the test is deterministic and works offline. The live Ctrip evidence lives in
 * `docs/verification/phase-01.md`; this exists so the path cannot silently rot.
 *
 * Two conditions are deliberate and load-bearing:
 *
 *   - **The pane starts closed and there are no targets.** That is the cold-start shape the product
 *     actually has, and it once deadlocked: the executor asked the shell for a tab through an
 *     existing page's CDP session, and on a fresh app there was no page to ask through. Pre-opening
 *     the pane in the harness would hide exactly the bug this is here to catch.
 *   - **The port is dynamic.** A fixed port collides with a developer's own relay and with a
 *     parallel run.
 *
 * Run it through `pnpm --filter @prismshadow/penguin-desktop test:e2e` (Xvfb on headless Linux).
 * Output is one `E2E {json}` line per step; the runner asserts on them.
 */
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const REPO = path.resolve(__dirname, "..", "..", "..");
const out = (o) => process.stdout.write(`E2E ${JSON.stringify(o)}\n`);

const FIXTURE = `<!doctype html>
<meta charset="utf-8">
<title>iab fixture</title>
<main>
  <h1 id="heading">Fixture</h1>
  <button id="go" onclick="document.getElementById('heading').textContent = 'clicked'">Search</button>
</main>`;

/** Serves the fixture on an ephemeral loopback port. */
function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(FIXTURE);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

(async () => {
  const { server: fixtureServer, port: fixturePort } = await startFixtureServer();
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/`;
  const relayPort = await reservePort();
  const key = `e2e-${Math.random().toString(36).slice(2)}`;

  const { startPenguinBrowserCDPRelayServer } = await import(
    path.join(REPO, "packages/browser-cli/dist/cdp-relay.js")
  );
  const relay = await startPenguinBrowserCDPRelayServer({
    port: relayPort,
    host: "127.0.0.1",
    iabKey: key,
  });

  await app.whenReady();

  // The real window, with the real preload and the real enabling switch.
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO, "packages/desktop/dist/preload-browser.cjs"),
      additionalArguments: ["--travel-agent-iab-enabled"],
    },
  });
  await win.loadURL("data:text/html,<title>host</title><body>host</body>");

  // The preload must have exposed the bridge, because main passed the switch.
  const bridgeOn = await win.webContents.executeJavaScript(
    "Boolean(window.travelAgentBrowser && window.travelAgentBrowser.available)",
  );
  out({ step: "bridge-with-flag", available: bridgeOn });

  // The other half of the same rule: without the switch the preload must report nothing available,
  // so a run where the relay failed to start cannot show a control whose every call would reject.
  const plain = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO, "packages/desktop/dist/preload-browser.cjs"),
      additionalArguments: [],
    },
  });
  await plain.loadURL("data:text/html,<title>plain</title><body>plain</body>");
  const bridgeOff = await plain.webContents.executeJavaScript(
    "Boolean(window.travelAgentBrowser && window.travelAgentBrowser.available)",
  );
  out({ step: "bridge-without-flag", available: bridgeOff });
  plain.destroy();

  const { BrowserPane } = await import(
    path.join(REPO, "packages/desktop/dist-e2e/browser-pane.js")
  );
  const { IabTransport } = await import(
    path.join(REPO, "packages/desktop/dist-e2e/iab-transport.js")
  );

  let lastState = null;
  const pane = new BrowserPane({
    window: win,
    onState: (state) => {
      lastState = state;
    },
  });
  const transport = new IabTransport({
    port: relayPort,
    key,
    installId: "e2e-install",
    openTab: (url) => pane.openTabForAgent(url),
    liveTargets: () => pane.liveContents(),
  });
  pane.setViewCreatedHandler((contents) => transport.attach(contents));
  transport.start();

  // The renderer reports where the pane goes, exactly as the real hook does. Note it is *not*
  // opened here: nothing has asked for it yet.
  pane.setMeasurement({ x: 700, y: 0, width: 700, height: 900 });
  out({ step: "cold-start", requested: pane.state().requested, present: pane.state().present });

  // Give the transport a moment to connect. No target exists yet — that is the point.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const status = await fetch(`http://127.0.0.1:${relayPort}/extensions/status`).then((r) =>
    r.json(),
  );
  out({
    step: "backend",
    connected: status.extensions.length,
    targets: status.extensions[0]?.activeTargets ?? 0,
  });

  const session = await fetch(`http://127.0.0.1:${relayPort}/cli/session/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ iab: true, cwd: REPO }),
  }).then((r) => r.json());
  out({ step: "session-new", mode: session.mode, id: session.id, error: session.error ?? null });

  const exec = async (code) => {
    const response = await fetch(`http://127.0.0.1:${relayPort}/cli/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, code, timeout: 45000 }),
    });
    return { status: response.status, body: await response.text() };
  };

  const opened = await exec(
    `const p = await tabs.open(${JSON.stringify(fixtureUrl)}); return p.url()`,
  );
  out({ step: "tabs-open", status: opened.status, body: opened.body.slice(0, 200) });

  // Opening a tab must have opened the pane, without the user touching anything.
  out({
    step: "auto-open",
    requested: pane.state().requested,
    visible: lastState?.visible ?? false,
  });

  const snap = await exec(`const s = await snapshot({ page }); return String(s).slice(0, 200)`);
  out({ step: "snapshot", status: snap.status, body: snap.body.slice(0, 300) });

  const clicked = await exec(`
    await clickThrough(page.locator('#go'));
    return await page.locator('#heading').innerText();
  `);
  out({ step: "click", status: clicked.status, body: clicked.body.slice(0, 200) });

  // --- the splitter, with the native view visible ------------------------------------------
  //
  // A WebContentsView is a native surface above the DOM, so it swallows pointer events that cross
  // it. The hook hides the view for the duration of a drag for exactly that reason; this exercises
  // the same sequence — occlude, move, restore — and checks the view really does step aside and
  // come back at the new width.
  pane.setOccluded(true);
  const midDrag = lastState?.visible ?? true;
  pane.setMeasurement({ x: 900, y: 0, width: 500, height: 900 });
  pane.setOccluded(false);
  out({
    step: "splitter",
    hiddenDuringDrag: midDrag === false,
    visibleAfter: lastState?.visible ?? false,
  });

  out({ step: "done" });
  transport.stop();
  relay.close();
  fixtureServer.close();
  app.exit(0);
})().catch((error) => {
  out({ step: "fatal", error: String(error?.stack ?? error).slice(0, 600) });
  app.exit(1);
});

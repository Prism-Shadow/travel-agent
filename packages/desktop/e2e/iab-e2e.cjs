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
 *   - **The pane starts open but there are no targets.** Visibility and target creation are separate:
 *     the product now shows the workspace immediately, while the executor must still bootstrap the
 *     first tab without an existing page's CDP session. The harness then closes the pane before the
 *     agent opens that tab, preserving the regression check that agent activity reopens it.
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
    path.join(REPO, "packages/browser-cli/dist/relay/cdp-relay.js")
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
  let transport = null;
  const pane = new BrowserPane({
    window: win,
    onState: (state) => {
      lastState = state;
    },
    onTabClosedByUser: (notice) => transport?.noteUserClosed(notice),
    onNotifyRelay: (method, params) => transport?.notify(method, params),
  });
  transport = new IabTransport({
    port: relayPort,
    key,
    installId: "e2e-install",
    openTab: (options) => pane.openTabForAgent(options),
    liveTargets: () => pane.liveContents(),
    activeTarget: () => pane.activeContents(),
    taskTarget: (taskId) => pane.taskContents(taskId),
    mayDrive: (contents, taskId) => pane.mayDrive(contents, taskId),
    claimTab: (targetId, identity) => pane.claimTab(targetId, identity),
    ownershipOf: (contents) => pane.ownershipOf(contents),
    declareOutcome: (taskId, outcome) => pane.declareTaskOutcome(taskId, outcome),
    // The real main answers { active: false } when no vault shell exists (main.ts); the executor
    // decodes that as "no redaction registry" and renders normally. Omitting the provider is not
    // the same state: the transport then refuses every snapshot (fail-closed by design).
    redactionState: async () => ({ active: false }),
  });
  pane.setViewCreatedHandler((contents) => transport.attach(contents));
  transport.start();

  // Before the first message there is no server Session, but the draft already has its own browser
  // strip. This is the product regression this run covers: the user can open and navigate a real
  // WebContentsView now, and the exact same tab is promoted once the Session is created.
  const DRAFT_SCOPE = "draft-scope-0123456789abcdef0123456789abcdef";
  const SESSION_ID = "session-2026-08-15-00-00-00-e2e00001";
  const TASK_ID = "task-1755000000000-e2e00001";
  pane.setActiveSession(DRAFT_SCOPE);

  // The renderer reports where the pane goes, exactly as the real hook does. The workspace is open
  // by product default, but no tab or WebContentsView exists until someone asks for one.
  pane.setMeasurement({ x: 700, y: 0, width: 700, height: 900 });
  out({ step: "cold-start", requested: pane.state().requested, present: pane.state().present });

  const draftTabId = pane.openTabForUser(fixtureUrl);
  await new Promise((resolve) => setTimeout(resolve, 250));
  out({
    step: "draft-before-chat",
    scope: pane.state().sessionScope,
    tabs: pane.state().tabs.length,
    navigated: pane.state().tabs[0]?.url === fixtureUrl,
    polledAsSession: pane.sessionsOfInterest().includes(DRAFT_SCOPE),
  });

  pane.reassignActiveSession(SESSION_ID);
  out({
    step: "draft-promoted",
    scope: pane.state().sessionScope,
    tabs: pane.state().tabs.length,
    sameTab: pane.state().tabs[0]?.id === draftTabId,
    polledAsSession: pane.sessionsOfInterest().includes(SESSION_ID),
  });
  // The real renderer's route switch confirms the promotion. Close this proof tab so all later
  // lifetime/count assertions remain about the agent tabs they were designed to cover.
  pane.setActiveSession(SESSION_ID);
  pane.closeTab(draftTabId);
  pane.setSessionDownloadDir(SESSION_ID, {
    directory: path.join(REPO, "packages/desktop/dist-e2e/downloads"),
    root: path.join(REPO, "packages/desktop/dist-e2e"),
  });
  // The harness stands in for the main-process supervisor applying what the *server* says is
  // running. That is the only way a turn gains authority: the pane opens tabs for a turn the
  // harness reports live, and an id alone is not authority, because a background command keeps a
  // genuine one long after its turn is over.
  pane.applyTaskState([
    {
      sessionId: SESSION_ID,
      projectId: "e2e-project",
      agentId: "default_agent",
      running: TASK_ID,
      lastFinished: null,
    },
  ]);
  // Keep the old visibility regression covered independently of the new launch default: an agent
  // that starts after the user closes the workspace must bring it back into view.
  pane.setRequested(false);

  // Give the transport a moment to connect. No target exists yet — that is the point.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  // The in-app browser speaks the extension protocol but is not a Chrome extension, and public
  // discovery must not see it: with the desktop app running and no extension installed, a caller
  // asking about Chrome extensions has to be told there are none — otherwise choosing "my own
  // Chrome" silently selects the in-app browser again.
  const status = await fetch(`http://127.0.0.1:${relayPort}/extensions/status`).then((r) =>
    r.json(),
  );
  out({ step: "backend", publicExtensions: status.extensions.length });

  const session = await fetch(`http://127.0.0.1:${relayPort}/cli/session/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ iab: true, cwd: REPO, sessionId: SESSION_ID, taskId: TASK_ID }),
  }).then((r) => r.json());
  out({ step: "session-new", mode: session.mode, id: session.id, error: session.error ?? null });

  // An in-app browser session without an identity is refused outright: a tab that belongs to no
  // conversation appears in no strip, and one that belongs to no task is never subject to the
  // end-of-task rules.
  const anonymous = await fetch(`http://127.0.0.1:${relayPort}/cli/session/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ iab: true, cwd: REPO }),
  });
  out({ step: "session-new-anonymous", status: anonymous.status });

  // A turn the harness never reported cannot open a tab, whatever id it carries.
  let staleTaskRefused = false;
  try {
    await pane.openTabForAgent({ sessionId: SESSION_ID, taskId: "task-1755000000000-e2e00099" });
  } catch (error) {
    staleTaskRefused = String(error?.message ?? error).includes("IAB_TASK_NOT_LIVE");
  }
  out({ step: "stale-task", refused: staleTaskRefused });

  const exec = async (code, taskId = TASK_ID) => {
    const response = await fetch(`http://127.0.0.1:${relayPort}/cli/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, code, timeout: 45000, taskId }),
    });
    return { status: response.status, body: await response.text() };
  };

  // Held on `state`, which persists across executions: each `tabs.open()` now mints a *new* tab, so
  // "the session's page" is no longer the same thing as "the page the agent just opened".
  const opened = await exec(
    `state.fixture = await tabs.open(${JSON.stringify(fixtureUrl)}); return state.fixture.url()`,
  );
  out({ step: "tabs-open", status: opened.status, body: opened.body.slice(0, 200) });

  // Opening a tab must have opened the pane, without the user touching anything.
  out({
    step: "auto-open",
    requested: pane.state().requested,
    visible: lastState?.visible ?? false,
  });

  const snap = await exec(
    `const s = await snapshot({ page: state.fixture }); return String(s).slice(0, 200)`,
  );
  out({ step: "snapshot", status: snap.status, body: snap.body.slice(0, 300) });

  const clicked = await exec(`
    await clickThrough(state.fixture.locator('#go'));
    return await state.fixture.locator('#heading').innerText();
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

  // --- a second tab, and switching between them --------------------------------------------
  const second = await exec(
    `state.second = await tabs.open(${JSON.stringify(`${fixtureUrl}?second=1`)});` +
      ` return state.second.url()`,
  );
  out({
    step: "second-tab",
    status: second.status,
    tabs: pane.state().tabs.length,
    active: pane.state().activeTabId,
  });

  // The bootstrap was navigated into fixture, so the strip is [fixture, second]. The last is the
  // page the agent most recently opened.
  const strip = pane.state().tabs;
  const firstTab = strip[0];
  const lastTab = strip[strip.length - 1];
  pane.selectTab(firstTab.id);
  out({
    step: "select-tab",
    active: pane.state().activeTabId,
    switched: pane.state().activeTabId === firstTab.id && lastTab.id !== firstTab.id,
  });

  // --- a session belonging to another task cannot be driven from this one ------------------
  const foreign = await exec("return 1", "task-1755000000000-e2e00002");
  out({ step: "foreign-task", status: foreign.status, body: foreign.body.slice(0, 200) });

  // --- the end of a task, and what the agent may do afterwards ------------------------------
  //
  // A read-only turn keeps its selected final result, while the one the user explicitly marked
  // stays as well. Both become unowned; intermediate pages are cleaned up. Then the agent's next
  // write is refused with a code it can act on rather than succeeding on a user-owned page.
  pane.setRetain(lastTab.id, true);
  pane.declareTaskOutcome(TASK_ID, "read_only");
  pane.endTask(TASK_ID, { abnormal: false });
  const remaining = pane.state().tabs;
  out({
    step: "task-end",
    tabs: remaining.length,
    retainedUnowned: remaining.length === 2 && remaining.every((tab) => tab.ownedByTask === null),
    resultRetained: remaining.some((tab) => tab.id === firstTab.id),
    markedRetained: remaining.some((tab) => tab.id === lastTab.id),
  });

  // The *retained* page: still open, still loaded, and no longer the agent's. Nothing else would
  // refuse this write — the executor is connected, the CDP session is valid, the page is there.
  const afterEnd = await exec("return await state.second.title()");
  out({ step: "write-after-end", status: afterEnd.status, body: afterEnd.body.slice(0, 300) });

  out({ step: "done" });
  transport.stop();
  relay.close();
  fixtureServer.close();
  app.exit(0);
})().catch((error) => {
  out({ step: "fatal", error: String(error?.stack ?? error).slice(0, 600) });
  app.exit(1);
});

/**
 * The in-app browser's session policy (src/session-partition.ts), for the parts that are pure.
 *
 * The permission predicate is tested apart from Electron because the property that matters is the
 * *direction* it fails in. An earlier revision listed permissions to deny, which granted everything
 * absent from the list — including every permission a future Chromium introduces. For a surface
 * rendering a booking site inside the application window, that is the wrong default, and a test
 * that only checked today's list would not have caught it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chromeLikeUserAgent,
  downloadTargetFor,
  setDownloadLogger,
  startDownload,
  isPermissionAllowed,
  releaseDownloadPath,
  resetDownloadReservationsForTests,
  resolveSessionDownloadDir,
  sanitizeDownloadFilename,
  uniqueDownloadPath,
} from "../src/session-partition.js";

describe("isPermissionAllowed", () => {
  it.each([
    "media",
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "pointerLock",
    "fullscreen",
    "openExternal",
    "display-capture",
    "clipboard-read",
    "hid",
    "serial",
    "usb",
    "window-management",
  ])("denies %s", (permission) => {
    expect(isPermissionAllowed(permission)).toBe(false);
  });

  it("denies a permission nobody has heard of yet", () => {
    // The regression guard: default-deny means a Chromium upgrade cannot silently grant something.
    expect(isPermissionAllowed("some-future-capability")).toBe(false);
    expect(isPermissionAllowed("")).toBe(false);
  });
});

describe("chromeLikeUserAgent", () => {
  it("strips the Electron token", () => {
    const input =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) travel-agent/0.2.2 Chrome/150.0.0.0 Electron/43.2.0 Safari/537.36";
    const result = chromeLikeUserAgent(input);
    expect(result).not.toMatch(/Electron/);
    expect(result).toMatch(/Chrome\/150\.0\.0\.0/);
  });

  it("leaves an already-clean agent alone", () => {
    const input =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
    expect(chromeLikeUserAgent(input)).toBe(input);
  });

  it("does not leave double spaces behind", () => {
    expect(chromeLikeUserAgent("A Electron/1.0 B")).not.toMatch(/ {2}/);
  });
});

describe("sanitizeDownloadFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeDownloadFilename("itinerary.pdf")).toBe("itinerary.pdf");
  });

  it.each([
    ["../../.ssh/authorized_keys", "authorized_keys"],
    ["..\\..\\windows\\system32\\evil.dll", "evil.dll"],
    ["/etc/passwd", "passwd"],
  ])("strips the path out of %s", (raw, expected) => {
    // The name comes from a Content-Disposition header or a URL, which is to say from the site.
    expect(sanitizeDownloadFilename(raw)).toBe(expected);
  });

  it("drops leading dots so a download cannot arrive hidden", () => {
    expect(sanitizeDownloadFilename(".bashrc")).toBe("bashrc");
  });

  it.each(['a"b.pdf', "a<b>.pdf", "a|b.pdf", "a\u0000b.pdf"])(
    "removes hostile characters in %s",
    (raw) => {
      expect(sanitizeDownloadFilename(raw)).not.toMatch(/["<>|\u0000]/);
    },
  );

  it("names an empty result rather than refusing it", () => {
    expect(sanitizeDownloadFilename("...")).toBe("download");
    expect(sanitizeDownloadFilename("")).toBe("download");
  });

  it("caps the length", () => {
    expect(sanitizeDownloadFilename("x".repeat(500)).length).toBeLessThanOrEqual(180);
  });
});

describe("resolveSessionDownloadDir", () => {
  const ids = { projectId: "proj", agentId: "default_agent", sessionId: "session-1" };

  it("is the Session's own scratchpad, which is what the agent reads and what is deleted with it", () => {
    // design/002 §5.2: a download belongs to the conversation that fetched it and lives exactly as
    // long. The shape is asserted literally because "somewhere under the data root" is not the
    // promise — `<agentDir>/scratchpad/<sessionId>` is.
    expect(resolveSessionDownloadDir("/data", ids)).toBe(
      path.join("/data", "proj", "agents", "default_agent", "scratchpad", "session-1", "downloads"),
    );
  });

  it("keeps conversations apart", () => {
    const first = resolveSessionDownloadDir("/data", ids);
    const second = resolveSessionDownloadDir("/data", { ...ids, sessionId: "session-2" });
    expect(first).not.toBe(second);
  });

  it.each([
    ["a traversing session id", { ...ids, sessionId: "../../../etc" }],
    ["a traversing project id", { ...ids, projectId: ".." }],
    ["a traversing agent id", { ...ids, agentId: "../../.." }],
    ["an absolute-looking id", { ...ids, sessionId: "/etc/passwd" }],
    ["an empty id", { ...ids, agentId: "" }],
  ])("refuses %s", (_label, hostile) => {
    // Ids come from the renderer. They name a conversation; they must not be able to name a place.
    expect(resolveSessionDownloadDir("/data", hostile)).toBeNull();
  });
});

describe("uniqueDownloadPath", () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iab-dl-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("uses the name as given when nothing is in the way", () => {
    const dir = tempDir();
    expect(uniqueDownloadPath(dir, "itinerary.pdf")).toBe(path.join(dir, "itinerary.pdf"));
  });

  it("does not overwrite an earlier download of the same name", () => {
    // Two confirmations both called `receipt.pdf` are two files. Replacing the first is losing the
    // thing the user came for.
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "receipt.pdf"), "first");
    expect(uniqueDownloadPath(dir, "receipt.pdf")).toBe(path.join(dir, "receipt (2).pdf"));

    fs.writeFileSync(path.join(dir, "receipt (2).pdf"), "second");
    expect(uniqueDownloadPath(dir, "receipt.pdf")).toBe(path.join(dir, "receipt (3).pdf"));
  });

  it("keeps the extension where a reader expects it", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "trip.tar.gz"), "x");
    expect(uniqueDownloadPath(dir, "trip.tar.gz")).toBe(path.join(dir, "trip.tar (2).gz"));
  });

  it("sanitises before de-duplicating", () => {
    const dir = tempDir();
    expect(uniqueDownloadPath(dir, "../../escape.sh")).toBe(path.join(dir, "escape.sh"));
  });
});

describe("containment", () => {
  const roots: string[] = [];
  const tempRoot = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iab-root-"));
    roots.push(dir);
    return dir;
  };
  afterEach(() => {
    resetDownloadReservationsForTests();
    while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it("refuses a directory reached through a link out of the data root", () => {
    // The lexical check passes here — the string is `<root>/proj/agents/.../downloads` — and the
    // bytes still land wherever the link points. Only the filesystem knows.
    const root = tempRoot();
    const outside = tempRoot();
    const agentDir = path.join(root, "proj", "agents", "default_agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.symlinkSync(outside, path.join(agentDir, "scratchpad"));

    expect(
      resolveSessionDownloadDir(root, {
        projectId: "proj",
        agentId: "default_agent",
        sessionId: "session-1",
      }),
    ).toBeNull();
  });

  it("allows a link that stays inside the data root", () => {
    // Containment, not link-phobia: a data root that is itself reached through a link (a symlinked
    // home directory, a relocated app-data folder) is ordinary, and refusing it would break the
    // feature for a large number of real machines.
    const root = tempRoot();
    const real = path.join(root, "real");
    fs.mkdirSync(path.join(real, "proj", "agents"), { recursive: true });
    fs.symlinkSync(path.join(real, "proj"), path.join(root, "proj"));

    expect(
      resolveSessionDownloadDir(root, {
        projectId: "proj",
        agentId: "default_agent",
        sessionId: "session-1",
      }),
    ).not.toBeNull();
  });

  it("re-checks at download time, after the directory has been swapped for a link", () => {
    // The TOCTOU this exists for. The directory is resolved when the shell learns which Agent a
    // conversation belongs to; the file is written minutes later. In between, anything running as
    // the user — the agent's own shell commands included — can replace `downloads` with a link
    // pointing anywhere. A check that ran only at resolve time would have been true and useless.
    const root = tempRoot();
    const outside = tempRoot();
    const directory = path.join(
      root,
      "proj",
      "agents",
      "default_agent",
      "scratchpad",
      "s1",
      "downloads",
    );
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(directory, { recursive: true });

    // Contained when it was resolved.
    expect(downloadTargetFor({ directory, root }, "receipt.pdf")).toBe(
      path.join(fs.realpathSync(directory), "receipt.pdf"),
    );

    fs.rmdirSync(directory);
    fs.symlinkSync(outside, directory);

    expect(downloadTargetFor({ directory, root }, "receipt.pdf")).toBeNull();
  });

  it("creates nothing outside the root when a parent has become a link", () => {
    // `mkdirSync(..., { recursive: true })` happily creates the tail of a path whose parent points
    // out of the data root. Checking containment only *after* that refuses the bytes but has
    // already made a directory somewhere it had no business writing — and left a foothold for the
    // next attempt. So the check runs first, and the post-check stays for the race it cannot see.
    const root = tempRoot();
    const outside = tempRoot();
    const scratchpad = path.join(root, "proj", "agents", "default_agent", "scratchpad");
    fs.mkdirSync(path.dirname(scratchpad), { recursive: true });
    fs.symlinkSync(outside, scratchpad);
    const directory = path.join(scratchpad, "s1", "downloads");

    expect(downloadTargetFor({ directory, root }, "receipt.pdf")).toBeNull();
    // Nothing was created through the link.
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.existsSync(path.join(outside, "s1"))).toBe(false);
  });

  it("refuses when a directory above the download folder becomes a link", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const scratchpad = path.join(root, "proj", "agents", "default_agent", "scratchpad");
    const directory = path.join(scratchpad, "s1", "downloads");
    fs.mkdirSync(directory, { recursive: true });
    expect(downloadTargetFor({ directory, root }, "a.pdf")).not.toBeNull();

    fs.rmSync(scratchpad, { recursive: true, force: true });
    fs.symlinkSync(outside, scratchpad);

    expect(downloadTargetFor({ directory, root }, "a.pdf")).toBeNull();
  });

  it("hands Chromium a path with no links left in it", () => {
    // The join is onto the *resolved* directory, so a component that is a link cannot be swapped
    // for a different destination between this call and Chromium opening the file.
    const root = tempRoot();
    const real = path.join(root, "real", "downloads");
    fs.mkdirSync(real, { recursive: true });
    const linked = path.join(root, "linked");
    fs.symlinkSync(path.join(root, "real"), linked);

    expect(downloadTargetFor({ directory: path.join(linked, "downloads"), root }, "x.pdf")).toBe(
      path.join(fs.realpathSync(real), "x.pdf"),
    );
  });

  it("refuses a name planted as a link to nowhere", () => {
    // `existsSync` follows the link and reports false for a dangling one, so the name looked free
    // and the download was written straight through it.
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory, { recursive: true });
    fs.symlinkSync(path.join(root, "..", "elsewhere.pdf"), path.join(directory, "receipt.pdf"));

    expect(downloadTargetFor({ directory, root }, "receipt.pdf")).toBe(
      path.join(fs.realpathSync(directory), "receipt (2).pdf"),
    );
  });

  it("refuses a download it cannot attribute to a conversation", () => {
    expect(downloadTargetFor(null, "receipt.pdf")).toBeNull();
  });

  it("gives two downloads of the same name two files, before either exists", () => {
    // `existsSync` alone is a check, not a reservation: both downloads start against an empty
    // directory, both are told `receipt.pdf`, and the second silently replaces the first. Chromium
    // creates the file some time after this returns, so the window is real.
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory, { recursive: true });

    const first = downloadTargetFor({ directory, root }, "receipt.pdf");
    const second = downloadTargetFor({ directory, root }, "receipt.pdf");
    expect(first).toBe(path.join(fs.realpathSync(directory), "receipt.pdf"));
    expect(second).toBe(path.join(fs.realpathSync(directory), "receipt (2).pdf"));

    // And the name comes back once that download is done with it.
    releaseDownloadPath(first!);
    expect(downloadTargetFor({ directory, root }, "receipt.pdf")).toBe(first);
  });
});

describe("starting a download", () => {
  const roots: string[] = [];
  const refusals: string[] = [];
  const tempRoot = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iab-dl-start-"));
    roots.push(dir);
    return dir;
  };

  /** Electron's `DownloadItem`, narrowed to what the module touches. */
  function item(
    options: {
      filename?: string;
      failSavePath?: boolean;
      failOnce?: boolean;
      /** A destroyed item: the *second* read of the name throws, as a real one would. */
      failSecondGetFilename?: boolean;
    } = {},
  ) {
    const saved: string[] = [];
    let doneListener: (() => void) | null = null;
    let reads = 0;
    return {
      saved,
      finish: () => doneListener?.(),
      handle: {
        getFilename: () => {
          reads += 1;
          if (options.failSecondGetFilename && reads > 1) {
            throw new Error("the item has been destroyed");
          }
          return options.filename ?? "receipt.pdf";
        },
        setSavePath: (target: string) => {
          if (options.failSavePath) throw new Error("the item is already destroyed");
          saved.push(target);
        },
        once: (_event: "done", listener: () => void) => {
          if (options.failOnce) throw new Error("the item is gone");
          doneListener = listener;
          return undefined;
        },
      },
    };
  }

  beforeEach(() => {
    refusals.length = 0;
    setDownloadLogger((message) => refusals.push(message));
  });

  afterEach(() => {
    resetDownloadReservationsForTests();
    setDownloadLogger((message) => process.stderr.write(`${message}\n`));
    while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it("saves into the conversation's own directory", () => {
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);
    const download = item();

    expect(startDownload({ directory, root }, download.handle)).toBe(true);
    expect(download.saved).toEqual([path.join(fs.realpathSync(directory), "receipt.pdf")]);
  });

  it("refuses a download it cannot place, without throwing", () => {
    // An exception escaping a `will-download` listener is an uncaught exception in the main
    // process — the app goes down instead of a file failing to save.
    expect(startDownload(null, item().handle)).toBe(false);
  });

  it("does not throw when Chromium will not take the path, and gives the name back", () => {
    // The leak this closes: the name is reserved before `setSavePath`, so a failure there would
    // hold it for the life of the process and the *next* download of that file would silently
    // become `receipt (2).pdf`.
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);

    const failing = item({ failSavePath: true });
    expect(startDownload({ directory, root }, failing.handle)).toBe(false);
    expect(refusals.join(" ")).toMatch(/could not set the save path/);

    // The name is free again, so the retry gets the name the user expects.
    const retry = item();
    expect(startDownload({ directory, root }, retry.handle)).toBe(true);
    expect(retry.saved).toEqual([path.join(fs.realpathSync(directory), "receipt.pdf")]);
  });

  it("holds the name until the download is done with it", () => {
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);

    const first = item();
    const second = item();
    startDownload({ directory, root }, first.handle);
    startDownload({ directory, root }, second.handle);
    expect(second.saved[0]).toBe(path.join(fs.realpathSync(directory), "receipt (2).pdf"));

    first.finish();
    const third = item();
    startDownload({ directory, root }, third.handle);
    expect(third.saved[0]).toBe(path.join(fs.realpathSync(directory), "receipt.pdf"));
  });

  it("does not throw when the item is destroyed mid-failure", () => {
    // The name is read once and kept: reporting a failed `setSavePath` by asking the item for its
    // name *again* reaches into a Chromium object that may be gone, and that throw would escape a
    // `will-download` listener and take the main process with it.
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);
    const download = item({ failSavePath: true, failSecondGetFilename: true });

    expect(startDownload({ directory, root }, download.handle)).toBe(false);
    expect(refusals.join(" ")).toMatch(/receipt\.pdf/);
  });

  it("does not throw when reporting the refusal is itself broken", () => {
    // The logger is injectable, so it is somebody else's code; a throw from it inside the listener
    // would be the same uncaught exception by another route.
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);
    setDownloadLogger(() => {
      throw new Error("the logger is broken");
    });

    expect(startDownload({ directory, root }, item({ failSavePath: true }).handle)).toBe(false);
  });

  it("reports a download it cannot watch, and keeps the name free", () => {
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);

    expect(startDownload({ directory, root }, item({ failOnce: true }).handle)).toBe(false);
    expect(refusals.join(" ")).toMatch(/could not watch the download/);

    const retry = item();
    expect(startDownload({ directory, root }, retry.handle)).toBe(true);
    expect(retry.saved).toEqual([path.join(fs.realpathSync(directory), "receipt.pdf")]);
  });

  it("refuses a download whose name cannot even be read", () => {
    const root = tempRoot();
    const directory = path.join(root, "downloads");
    fs.mkdirSync(directory);
    const broken = {
      getFilename: (): string => {
        throw new Error("the item has been destroyed");
      },
      setSavePath: () => {},
      once: () => undefined,
    };
    expect(startDownload({ directory, root }, broken)).toBe(false);
  });

  it("refuses a directory that has become a link out of the data root", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const directory = path.join(root, "downloads");
    fs.symlinkSync(outside, directory);
    expect(startDownload({ directory, root }, item().handle)).toBe(false);
  });
});

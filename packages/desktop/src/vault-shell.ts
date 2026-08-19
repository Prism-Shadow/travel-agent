/**
 * The vault side of the desktop shell, assembled in one place.
 *
 * Everything the main process holds for privacy — the vault, the grants, the sensitive element
 * registry, the secret phase, and the broker — is constructed here, and
 * only here, so that "what runs when the vault is on" is one readable function rather than a set
 * of side effects scattered through `main.ts`.
 *
 * Two decisions are made at this level and nowhere else:
 *
 * 1. **Whether to start at all.** The flags are resolved *with the storage probe folded in*:
 *    `vault.enabled` off (or refused by the probe) means none of this is constructed — not
 *    constructed-but-disabled, absent. The refusal reasons are kept and served to the settings
 *    page, because the fail-closed rule ends at a screen.
 * 2. **What the person is asked, and how.** A grant request surfaces as a native dialog naming the
 *    site, the purpose and the fields. It is deliberately modal and deliberately in the shell's
 *    own chrome: a page cannot draw over it, and an agent cannot answer it.
 *
 * What is *not* here: the agent-isolation probe. `agentRuntimeIsolated` is never reported true in
 * this phase — the isolation work is Phase 5 — so `vault.l2l3` and `secret_entry.live` resolve off
 * through the ordinary dependency chain, with reasons, however the
 * environment is configured. That single absence is what keeps every gated capability gated.
 */
import path from "node:path";
import { randomBytes } from "node:crypto";
import { app, dialog, safeStorage } from "electron";
import { resolveFlagsFromEnv } from "@prismshadow/penguin-core";
import type { FlagDenial } from "@prismshadow/penguin-core";
import { BROKER_SOCKET_ENV, BROKER_TOKEN_ENV } from "@prismshadow/penguin-server/broker-protocol";

import { startBrokerServer, type BrokerServer } from "./broker/server.js";
import { createBrokerHandlers, type GrantDecision } from "./vault/broker-handlers.js";
import { DebuggerFillPort, type TargetResolver } from "./vault/debugger-fill-port.js";
import { GrantRegistry } from "./vault/grants.js";
import { SecureFiller } from "./vault/secure-fill.js";
import { SecretPhaseController } from "./vault/secret-phase.js";
import { SensitiveElementRegistry } from "./vault/sensitive-elements.js";
import {
  electronSafeStorage,
  judgeStorage,
  readStorageFacts,
  type StorageAvailability,
} from "./vault/safe-storage.js";
import { createProfileVault, type ProfileVault } from "./vault/store.js";

export interface VaultShell {
  /** Environment for the forked server: where the broker is and the token to present. */
  env(): Record<string, string>;
  vault: ProfileVault;
  grants: GrantRegistry;
  sensitive: SensitiveElementRegistry;
  secretPhase: SecretPhaseController;
  close(): Promise<void>;
}

export interface VaultShellStatus {
  started: boolean;
  availability: StorageAvailability;
  denials: FlagDenial[];
}

/** The last start's outcome, for the settings surface and for diagnostics. */
let lastStatus: VaultShellStatus | null = null;

export function vaultShellStatus(): VaultShellStatus | null {
  return lastStatus;
}

/**
 * Starts the vault side, or reports precisely why it will not.
 *
 * `targets` is the bridge to the browser pane; it is a parameter because the pane belongs to
 * `main.ts` and this module must be constructible in a test without a window.
 */
export async function startVaultShell(input: {
  dataRoot: string;
  targets: TargetResolver;
  /** The tab a turn is working in, from the pane's own bookkeeping. Null = no page open. */
  currentTarget?: (input: { sessionId: string; taskId: string }) => Promise<string | null>;
  /** Injected in tests; defaults to Electron's dialog-based ask. */
  askForGrant?: (question: GrantQuestion) => Promise<GrantDecision>;
}): Promise<VaultShell | null> {
  const facts = readStorageFacts(safeStorage);
  const availability = judgeStorage(facts);
  const resolved = resolveFlagsFromEnv(process.env, {
    encryptedStorageAvailable: availability.usable,
    // Never true in this phase: the isolation decision (D3) is future work, and reporting it
    // without measuring it is exactly what the probe's contract forbids.
  });
  lastStatus = { started: false, availability, denials: resolved.denials };

  if (!resolved.flags["vault.enabled"]) return null;

  const vaultDir = path.join(app.getPath("userData"), "vault");
  const grants = new GrantRegistry({
    audit: async (event, details) => {
      await vault.auditLog()?.append(event, details);
    },
  });
  const vault = createProfileVault({
    filePath: path.join(vaultDir, "profile-vault.json"),
    auditPath: path.join(vaultDir, "vault-audit.jsonl"),
    safeStorage: electronSafeStorage(safeStorage),
    availability,
    onLock: () => {
      void grants.revokeAll();
    },
  });
  await vault.unlock();

  const sensitive = new SensitiveElementRegistry();
  const port = new DebuggerFillPort(input.targets);
  const filler = new SecureFiller({ vault, grants, sensitive, port, audit: vault.auditLog() });
  const secretPhase = new SecretPhaseController({
    port,
    sensitive,
    audit: vault.auditLog(),
    flags: { "secret_entry.live": resolved.flags["secret_entry.live"] },
  });

  const ask = input.askForGrant ?? dialogGrantAsk;
  const handlers = createBrokerHandlers({
    vault,
    grants,
    filler,
    audit: vault.auditLog(),
    // The pane's own bookkeeping when main wired it; without it every "current"-target call is
    // refused with "no page open", which is the failing-closed reading of "I don't know".
    currentTarget: input.currentTarget ?? (async () => null),
    pageDomain: async ({ targetId }) => {
      const url = input.targets.urlOf(targetId);
      if (!url) return null;
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    },
    askForGrant: (question) => ask(question),
  });

  const broker: BrokerServer = await startBrokerServer({
    socketPath: brokerPath(input.dataRoot),
    handlers,
    audit: async (entry) => {
      if (entry.outcome === "rejected") {
        await vault.auditLog()?.append("broker_rejected", {
          ...(entry.taskId ? { taskId: entry.taskId } : {}),
          ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
          ...(entry.domain ? { domain: entry.domain } : {}),
          ...(entry.reason ? { reason: entry.reason } : {}),
        });
      }
    },
  });

  lastStatus = { started: true, availability, denials: resolved.denials };
  return {
    env: () => ({ [BROKER_SOCKET_ENV]: broker.socketPath, [BROKER_TOKEN_ENV]: broker.token }),
    vault,
    grants,
    sensitive,
    secretPhase,
    async close() {
      await broker.close();
      await secretPhase.abandon("the application is closing");
      await vault.lock();
    },
  };
}

export interface GrantQuestion {
  sessionId: string;
  taskId: string;
  domain: string;
  purpose: string;
  fields: string[];
  mode: "projection" | "handle";
}

/**
 * The default ask: a native, modal dialog in the shell's own chrome.
 *
 * All-or-nothing in this phase — the card-based per-field version belongs with the interaction
 * cards, and a coarse dialog that a person actually decides beats a fine-grained one that is not
 * wired. The wording names the site, the purpose and every field, because those are the three
 * things the grant is *about*.
 */
async function dialogGrantAsk(question: GrantQuestion): Promise<GrantDecision> {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["允许", "拒绝"],
    defaultId: 1,
    cancelId: 1,
    title: "使用保管库资料",
    message: `允许在 ${question.domain} 使用以下资料吗？`,
    detail:
      `用途：${question.purpose}\n` +
      `字段：${question.fields.join("、")}\n` +
      (question.mode === "handle"
        ? "这些值会由应用直接填入页面，不会交给智能体。"
        : "这些值会以最小投影提供给智能体。"),
  });
  if (response === 0) return { approved: true, fields: question.fields };
  return { approved: false };
}

function brokerPath(dataRoot: string): string {
  const id = randomBytes(6).toString("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\penguin-broker-${id}`;
  return path.join(dataRoot, `broker-${id}.sock`);
}

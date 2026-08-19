/**
 * The cards the agent's questions arrive as.
 *
 * Docked above the composer, where a person's eyes already are when a conversation is waiting on
 * them, and never as a modal: the agent is still working in the browser beside this, and a dialog
 * that blocked the page would undo the thing the whole design is for (003 §0.2).
 *
 * Four kinds render here. The two that hand the browser over do not — those are drawn on the page
 * itself, because that is where the person has to act, and a card in the conversation saying "go
 * and look over there" would be one indirection too many.
 *
 * The payment card is the one to read closely. It shows all seven fields and puts the merchant's
 * *domain* next to its name (the display name is what a phishing page controls; the domain is what
 * it cannot). Its primary action hands payment to the person; it does not authorize an agent click.
 */
import { useState } from "react";
import type { InteractionOutcome, UserInteraction } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { toastError } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import { canSubmit, cardCopy, outcomeFor } from "./interaction-model";

function messageOf(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw.trim() || fallback;
}

export function InteractionCards({
  interactions,
  onResolve,
}: {
  interactions: readonly UserInteraction[];
  onResolve: (interactionId: string, outcome: InteractionOutcome) => Promise<void>;
}): React.ReactElement | null {
  const cards = interactions.filter(
    (interaction) =>
      interaction.kind !== "human_challenge" && interaction.kind !== "browser_takeover",
  );
  if (cards.length === 0) return null;
  return (
    <div className="mb-2 space-y-2">
      {cards.map((interaction) => (
        <InteractionCard key={interaction.id} interaction={interaction} onResolve={onResolve} />
      ))}
    </div>
  );
}

function InteractionCard({
  interaction,
  onResolve,
}: {
  interaction: UserInteraction;
  onResolve: (interactionId: string, outcome: InteractionOutcome) => Promise<void>;
}): React.ReactElement {
  const copy = cardCopy(interaction);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const answer = async (action: Parameters<typeof outcomeFor>[0]["action"]): Promise<void> => {
    setBusy(true);
    try {
      await onResolve(
        interaction.id,
        outcomeFor({
          action,
          text,
        }),
      );
    } catch (error) {
      // The card stays: the answer did not reach the agent, and taking the card away would leave
      // the person believing it had.
      toastError(messageOf(error, S.chat.interaction.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="interaction-card"
      data-kind={interaction.kind}
      aria-label={copy.tag}
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700/60 dark:bg-amber-950/30"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
          {copy.tag}
        </span>
        {copy.summary ? (
          <span className="truncate text-xs text-gray-600 dark:text-gray-400">{copy.summary}</span>
        ) : null}
      </div>

      <p className="mb-2 whitespace-pre-wrap text-gray-900 dark:text-gray-100">{copy.ask}</p>

      {copy.detail.length > 0 ? (
        <ul className="mb-2 space-y-0.5 rounded border border-amber-200 bg-white/70 p-2 text-xs text-gray-800 dark:border-amber-800/50 dark:bg-gray-900/50 dark:text-gray-200">
          {copy.detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {interaction.kind === "info_request" && interaction.answerShape !== "decision" ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          placeholder={S.chat.interaction.answerPlaceholder}
          className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-gray-700 dark:bg-gray-900"
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {copy.actions.map((action) =>
          action.kind === "choose" ? (
            <Button
              key={action.optionId}
              size="sm"
              disabled={busy}
              onClick={() => void answer(action)}
              title={action.rationale}
            >
              {action.label} · {action.rationale}
            </Button>
          ) : (
            <Button
              key={action.kind}
              size="sm"
              variant={action.tone === "primary" ? "primary" : undefined}
              disabled={busy || (action.kind === "submit" && !canSubmit(interaction, text))}
              onClick={() => void answer(action)}
            >
              {action.label}
            </Button>
          ),
        )}
      </div>
    </section>
  );
}

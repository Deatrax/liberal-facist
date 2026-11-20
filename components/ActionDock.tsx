"use client";

// "Your action area": the only place you act. It shows exactly one prompt for the current step
// (derived by the server in getPlayerView), or a single quiet line saying who the game waits on.

import { useState } from "react";
import type { AnyAction, GameView, Policy, PowerKind, Prompt, Vote } from "@/lib/game";
import { audio } from "@/lib/client/audio";
import { BallotImg, FlipTile, PartyImg, cx, Flip, CardBackImg } from "./cards";
import { RoleCards } from "./RoleCards";

type Act = (a: AnyAction) => Promise<boolean>;

const POWER_NAME: Record<PowerKind, string> = {
  peek: "Policy Peek",
  investigate: "Investigate Loyalty",
  special: "Call Special Election",
  execute: "Execution",
};

function joinNames(names: string[]): string {
  if (names.length > 3) return `${names.length} players`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function waitingLine(game: GameView, names: Map<string, string>): string {
  const n = (id: string | null) => (id ? (names.get(id) ?? "?") : "?");
  const who = game.waitingOn.map((id) => n(id));
  switch (game.phase) {
    case "roleReveal":
      return `Waiting for ${joinNames(who)} to get ready.`;
    case "nominate":
      return `${n(game.presidentId)} is choosing a Chancellor.`;
    case "vote":
      return `Waiting for ${joinNames(who)} to vote.`;
    case "presidentDiscard":
      return `${n(game.presidentId)} is choosing policies.`;
    case "chancellorEnact":
      return `${n(game.chancellorId)} is choosing a policy.`;
    case "vetoDecision":
      return `${n(game.presidentId)} is deciding on the veto.`;
    case "executive": {
      const power = game.powers[game.fascistPolicies - 1];
      return `${n(game.presidentId)} is using a Presidential Power${power ? `: ${POWER_NAME[power]}` : ""}.`;
    }
    case "gameOver":
      return "The game is over.";
  }
}

// ---------------------------------------------------------------------------
// Pieces

function Line({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-[17px] font-semibold leading-snug">{children}</p>;
}

/** Choose one player. Ineligible players stay visible but greyed, with the reason. */
function Picker({
  game,
  meId,
  targets,
  reason,
  confirm,
  danger,
  twoStep,
  pending,
  onConfirm,
}: {
  game: GameView;
  meId: string;
  targets: string[];
  reason: (id: string) => string;
  confirm: (name: string) => string;
  danger?: boolean;
  twoStep?: boolean;
  pending: boolean;
  onConfirm: (id: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const chosen = game.players.find((p) => p.id === sel);
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2">
        {game.players
          .filter((p) => p.id !== meId)
          .map((p) => {
            const ok = targets.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!ok}
                  aria-pressed={sel === p.id}
                  onClick={() => {
                    void audio.cue("tap");
                    setSel(p.id);
                    setArmed(false);
                  }}
                  className={cx(
                    "flex min-h-[48px] w-full flex-col items-start justify-center rounded-[4px] border-[1.5px] px-2.5 py-1 text-left",
                    ok ? "cursor-pointer border-ink" : "cursor-not-allowed border-ink/20 bg-panel text-ink-soft",
                    sel === p.id ? "bg-ink text-paper" : ok && "bg-paper hover:bg-panel",
                  )}
                >
                  <span className="max-w-full truncate font-display text-[15px] font-semibold leading-tight">{p.name}</span>
                  {!ok && <span className="text-[10px] leading-tight">{reason(p.id)}</span>}
                </button>
              </li>
            );
          })}
      </ul>
      <button
        type="button"
        className={cx("btn", danger ? "btn-danger" : "btn-primary")}
        disabled={!chosen || pending}
        onClick={() => {
          if (!chosen) return;
          if (twoStep && !armed) setArmed(true);
          else onConfirm(chosen.id);
        }}
      >
        {chosen ? (armed ? `Sure? ${confirm(chosen.name)}` : confirm(chosen.name)) : "Pick a player"}
      </button>
    </div>
  );
}

/** Face-down policy tiles. Tap to look; tap a face-up tile to mark it for discarding. */
function PolicyHand({
  hand,
  mode,
  confirmLabel,
  pending,
  onConfirm,
  extra,
}: {
  hand: Policy[];
  mode: "discard" | "view";
  confirmLabel: string;
  pending: boolean;
  onConfirm: (index: number | null) => void;
  extra?: React.ReactNode;
}) {
  const [up, setUp] = useState<boolean[]>(() => hand.map(() => false));
  const [pick, setPick] = useState<number | null>(null);
  const anyUp = up.some(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex justify-center gap-3">
        {hand.map((policy, i) => (
          <li key={i} className="w-[26%] max-w-[112px] min-w-[72px]">
            <button
              type="button"
              className={cx(
                "no-select block w-full rounded-[6px] transition-transform",
                pick === i && "-translate-y-1.5 outline outline-[3px] outline-offset-2 outline-ink",
              )}
              aria-pressed={pick === i}
              aria-label={up[i] ? (mode === "discard" ? `${policy} policy. Tap to mark for discarding` : `${policy} policy`) : "Policy, face down. Tap to look"}
              onClick={() => {
                if (!up[i]) {
                  void audio.cue("flip");
                  setUp((u) => u.map((v, j) => (j === i ? true : v)));
                } else if (mode === "discard") {
                  void audio.cue("tap");
                  setPick((p) => (p === i ? null : i));
                }
              }}
            >
              <FlipTile policy={policy} up={!!up[i]} />
            </button>
            <p className="mt-1.5 h-4 text-center text-[10px] uppercase tracking-wide">
              {pick === i ? "Discard" : !up[i] ? "Tap to look" : ""}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={pending || (mode === "discard" && pick === null)} onClick={() => {
            void audio.cue("ballot");
            onConfirm(pick);
          }}>
          {confirmLabel}
        </button>
        {extra}
        {anyUp && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              void audio.cue("flip");
              setUp(hand.map(() => false));
              setPick(null);
            }}
          >
            Turn face down
          </button>
        )}
      </div>
    </div>
  );
}

function Ballots({ game, pending, onVote }: { game: GameView; pending: boolean; onVote: (v: Vote) => void }) {
  const [sel, setSel] = useState<Vote | null>(null);
  const n = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "?";
  return (
    <div className="flex flex-col gap-3">
      <Line>
        {n(game.presidentId)} and {n(game.chancellorId)}. Ja! or Nein?
      </Line>
      <div className="grid grid-cols-2 gap-3">
        {(["ja", "nein"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={sel === v}
            onClick={() => {
              void audio.cue("tap");
              setSel(v);
            }}
            className={cx(
              "no-select rounded-[6px] transition-transform",
              sel === v ? "-translate-y-1 outline outline-[3px] outline-offset-2 outline-ink" : "opacity-90",
            )}
          >
            <BallotImg vote={v} />
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary" disabled={!sel || pending} onClick={() => {
          if (!sel) return;
          void audio.cue("ballot");
          onVote(sel);
        }}>
        {sel ? `Cast ${sel === "ja" ? "Ja!" : "Nein"}` : "Pick a ballot"}
      </button>
    </div>
  );
}

function InvestigationResult({ name, party, pending, onDone }: { name: string; party: "liberal" | "fascist"; pending: boolean; onDone: () => void }) {
  const [up, setUp] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Line>{up ? `${name} is in the ${party === "fascist" ? "Fascist" : "Liberal"} party.` : `Party Membership of ${name}`}</Line>
      <button type="button" onClick={() => {
          void audio.cue("flip");
          setUp((u) => !u);
        }} aria-label={up ? "Hide the card" : "Look at the card"} className="no-select mx-auto block w-[44%] max-w-[170px]">
        <Flip up={up} className="aspect-[520/735]" back={<CardBackImg />} front={<PartyImg party={party} />} />
      </button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ActionDock({
  game,
  meId,
  hostId,
  act,
  pending,
  error,
}: {
  game: GameView;
  meId: string;
  hostId: string;
  act: Act;
  pending: boolean;
  error: string | null;
}) {
  const names = new Map(game.players.map((p) => [p.id, p.name]));
  const p: Prompt | null = game.prompt;
  const me = game.me;
  const key = `${game.round}:${game.phase}:${p?.kind ?? "none"}:${game.vetoUnlocked}`;
  const lastElectedLimited = (id: string) =>
    !!game.lastElected &&
    (id === game.lastElected.chancellorId ||
      (id === game.lastElected.presidentId && game.players.filter((x) => x.alive).length > 5));

  let body: React.ReactNode;
  if (!p) {
    if (game.phase === "gameOver") {
      body =
        meId === hostId ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => act({ type: "playAgain" })}>
              Play again
            </button>
            <span className="text-[12px] text-ink-soft">Same players, new roles.</span>
          </div>
        ) : (
          <p className="text-[13px] text-ink-soft">Waiting for {names.get(hostId)} to start another game.</p>
        );
    } else {
      body = (
        <p className="text-[13px] text-ink-soft" aria-live="polite">
          {!me.alive ? "You were executed. Watch in silence. " : game.phase === "roleReveal" && me.ready ? "You are ready. " : ""}
          {waitingLine(game, names)}
        </p>
      );
    }
  } else {
    switch (p.kind) {
      case "ready":
        body = (
          <div className="flex flex-col gap-3">
            <Line>Look at your cards, then tap Ready.</Line>
            <div className="mx-auto w-full max-w-[420px]">
              <RoleCards me={me} names={names} />
            </div>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => {
                void audio.cue("confirm");
                void act({ type: "ready" });
              }}>
              Ready
            </button>
          </div>
        );
        break;

      case "nominate":
        body = (
          <div className="flex flex-col gap-3">
            <Line>Elect a Chancellor</Line>
            <Picker
              game={game}
              meId={meId}
              targets={p.targets}
              reason={(id) => (!game.players.find((x) => x.id === id)?.alive ? "Executed" : lastElectedLimited(id) ? "Term-limited" : "Not eligible")}
              confirm={(name) => `Nominate ${name}`}
              pending={pending}
              onConfirm={(id) => act({ type: "nominate", chancellorId: id })}
            />
          </div>
        );
        break;

      case "vote":
        body = <Ballots game={game} pending={pending} onVote={(vote) => act({ type: "vote", vote })} />;
        break;

      case "discard":
        body = (
          <div className="flex flex-col gap-3">
            <Line>Discard one policy</Line>
            <PolicyHand hand={p.hand} mode="discard" confirmLabel="Discard" pending={pending} onConfirm={(i) => i !== null && act({ type: "presidentDiscard", index: i })} />
          </div>
        );
        break;

      case "enact":
        body = (
          <div className="flex flex-col gap-3">
            <Line>Discard one. The other is enacted.</Line>
            <PolicyHand
              hand={p.hand}
              mode="discard"
              confirmLabel="Discard and enact"
              pending={pending}
              onConfirm={(i) => i !== null && act({ type: "chancellorDiscard", index: i })}
              extra={
                p.canVeto ? (
                  <button type="button" className="btn" disabled={pending} onClick={() => act({ type: "requestVeto" })}>
                    Veto
                  </button>
                ) : null
              }
            />
          </div>
        );
        break;

      case "vetoDecision":
        body = (
          <div className="flex flex-col gap-3">
            <Line>The Chancellor wishes to veto this agenda.</Line>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary flex-1" disabled={pending} onClick={() => act({ type: "vetoResponse", agree: true })}>
                Agree
              </button>
              <button type="button" className="btn flex-1" disabled={pending} onClick={() => act({ type: "vetoResponse", agree: false })}>
                Refuse
              </button>
            </div>
          </div>
        );
        break;

      case "investigate":
        body = p.result ? (
          <InvestigationResult name={names.get(p.result.targetId) ?? "?"} party={p.result.party} pending={pending} onDone={() => act({ type: "ackPower" })} />
        ) : (
          <div className="flex flex-col gap-3">
            <Line>Investigate a player&rsquo;s Party Membership</Line>
            <Picker
              game={game}
              meId={meId}
              targets={p.targets}
              reason={(id) => (!game.players.find((x) => x.id === id)?.alive ? "Executed" : "Already investigated")}
              confirm={(name) => `Investigate ${name}`}
              pending={pending}
              onConfirm={(id) => act({ type: "investigate", targetId: id })}
            />
          </div>
        );
        break;

      case "special":
        body = (
          <div className="flex flex-col gap-3">
            <Line>Choose the next Presidential Candidate</Line>
            <Picker
              game={game}
              meId={meId}
              targets={p.targets}
              reason={() => "Executed"}
              confirm={(name) => `Choose ${name}`}
              pending={pending}
              onConfirm={(id) => act({ type: "specialElection", targetId: id })}
            />
          </div>
        );
        break;

      case "execute":
        body = (
          <div className="flex flex-col gap-3">
            <Line>Execute a player</Line>
            <Picker
              game={game}
              meId={meId}
              targets={p.targets}
              reason={() => "Executed"}
              confirm={(name) => `Execute ${name}`}
              danger
              twoStep
              pending={pending}
              onConfirm={(id) => act({ type: "execute", targetId: id })}
            />
          </div>
        );
        break;

      case "peek":
        body = (
          <div className="flex flex-col gap-3">
            <Line>The top three policies</Line>
            <PolicyHand hand={p.cards} mode="view" confirmLabel="Done" pending={pending} onConfirm={() => act({ type: "ackPower" })} />
          </div>
        );
        break;
    }
  }

  const office = game.presidentId === meId ? "president" : game.chancellorId === meId ? "chancellor" : null;

  return (
    <div data-dock className="sticky bottom-0 z-20 -mx-4 max-h-[64dvh] overflow-y-auto border-t-[1.5px] border-ink bg-paper px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
      {error && (
        <p role="alert" className="mb-2 rounded-[3px] border border-fas-frame bg-fas-pale/40 px-2 py-1 text-[12px] text-fas-ink">
          {error}
        </p>
      )}
      <div className="flex items-start gap-3" key={key}>
        <div className="min-w-0 flex-1">{body}</div>
        {office && game.phase !== "gameOver" && p && (
          <img
            src={`/cards/placard-${office}.webp`}
            alt={office === "president" ? "You hold the President placard" : "You hold the Chancellor placard"}
            className="mt-0.5 hidden w-[104px] shrink-0 min-[460px]:block"
          />
        )}
      </div>
    </div>
  );
}

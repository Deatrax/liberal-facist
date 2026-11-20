"use client";

import { useEffect, useRef, useState } from "react";
import type { GameView, PublicPlayer, VoteResult } from "@/lib/game";
import { BallotImg, CardBackImg, ChancellorPlacard, Check, Flip, PresidentPlacard, RoleImg, Skull, cx } from "./cards";

/** 'reveal' while the ballots flip (~5 s after a vote resolves), 'compact' afterwards. */
function useVoteReveal(lastVote: VoteResult | null): "reveal" | "compact" {
  const seen = useRef<number | null>(lastVote?.id ?? null); // a vote that was already there on load is not re-animated
  const [revealing, setRevealing] = useState<number | null>(null);
  const id = lastVote?.id ?? null;
  useEffect(() => {
    if (id !== null && id !== seen.current) {
      seen.current = id;
      setRevealing(id);
      const t = setTimeout(() => setRevealing(null), 5000);
      return () => clearTimeout(t);
    }
  }, [id]);
  return revealing !== null && revealing === id ? "reveal" : "compact";
}

/** A ballot that starts face down and turns over as soon as it is mounted: all of them flip at once. */
function FlipBallot({ vote }: { vote: "ja" | "nein" }) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
    return () => cancelAnimationFrame(f);
  }, []);
  return (
    <Flip
      up={up}
      className="h-[30px] w-[44px]"
      back={<span className="block h-full w-full rounded-[3px] border-[3px] border-double border-brown bg-paper" />}
      front={<BallotImg vote={vote} />}
    />
  );
}

function Seat({
  p,
  me,
  waiting,
  idle,
  ballot,
  mode,
  voting,
}: {
  p: PublicPlayer;
  me: boolean;
  waiting: boolean;
  idle: boolean;
  ballot: "ja" | "nein" | null;
  mode: "reveal" | "compact";
  voting: boolean;
}) {
  return (
    <li
      className={cx(
        "relative flex min-h-[66px] min-w-0 flex-col justify-between gap-1.5 rounded-[4px] border-[1.5px] px-2.5 py-2",
        !p.alive ? "border-ink/20 bg-panel text-ink-soft" : waiting ? "border-ink bg-paper" : "border-ink/25 bg-paper",
        idle && p.alive && "opacity-55",
      )}
      aria-label={`${p.name}${me ? " (you)" : ""}${!p.alive ? ", executed" : ""}${idle ? ", away" : ""}`}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-mono text-[10px] text-ink-soft">{p.seat + 1}</span>
        <span className={cx("truncate font-display text-[15px] leading-tight", p.alive ? "font-semibold" : "font-medium line-through decoration-ink/40")}>{p.name}</span>
        {me && <span className="shrink-0 text-[10px] text-ink-soft">you</span>}
        {!p.alive && <Skull className="ml-auto self-center text-ink-soft" />}
      </div>

      <div className="flex min-h-[22px] flex-wrap items-center gap-1">
        {p.isPresident && <PresidentPlacard />}
        {p.isChancellor && <ChancellorPlacard />}
        {p.notHitler && (
          <span className="inline-flex items-center gap-1 rounded-full border border-lib-frame bg-lib-pale/50 px-1.5 text-[10px] font-medium leading-[1.6] text-lib-ink">
            <Check /> Not Hitler
          </span>
        )}
        {p.investigated && (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink-soft" title="Investigated">
            <img src="/cards/icon-investigate.webp" alt="" className="h-3.5 w-3.5" />
            <span className="sr-only">Investigated</span>
          </span>
        )}

        {voting && p.alive && (
          p.voted ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-ink-soft">
              <span className="block h-[22px] w-[15px]">
                <CardBackImg />
              </span>
              Voted
            </span>
          ) : (
            <span className="text-[10px] text-ink-soft">…</span>
          )
        )}

        {ballot &&
          (mode === "reveal" ? (
            <FlipBallot vote={ballot} />
          ) : (
            <span
              className={cx(
                "fade-in inline-flex items-center rounded-[3px] border px-1.5 font-fraktur text-[14px] leading-[1.3]",
                ballot === "ja" ? "border-brown bg-paper text-brown-deep" : "border-brown-deep bg-brown-deep text-paper",
              )}
            >
              {ballot === "ja" ? "Ja!" : "Nein"}
            </span>
          ))}

        {p.role && (
          <span className="ml-auto flex items-center gap-1.5">
            <span
              className={cx(
                "rounded-[3px] border px-1.5 text-[10px] font-semibold uppercase leading-[1.6] tracking-wider",
                p.role === "liberal" ? "border-lib-frame bg-lib-pale/60 text-lib-ink" : "border-fas-frame bg-fas-pale/60 text-fas-ink",
              )}
            >
              {p.role}
            </span>
            <span className="block h-[34px] w-[24px]">
              <RoleImg role={p.role} className="h-full w-full rounded-[2px]" />
            </span>
          </span>
        )}
      </div>
    </li>
  );
}

export function Players({ game, idle, meId }: { game: GameView; idle: Set<string>; meId: string }) {
  const mode = useVoteReveal(game.lastVote);
  const lv = game.lastVote;
  // Marks from the last vote stay up for the rest of the round (and the next nomination) until a new vote opens.
  const showLast = !!lv && game.phase !== "gameOver" && !(game.phase === "vote" && game.round > lv.id);
  const ja = lv ? Object.values(lv.votes).filter((v) => v === "ja").length : 0;
  const nein = lv ? Object.values(lv.votes).length - ja : 0;

  return (
    <section aria-label="Players" className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {game.players.map((p) => (
          <Seat
            key={p.id}
            p={p}
            me={p.id === meId}
            idle={idle.has(p.id)}
            waiting={game.phase !== "gameOver" && game.waitingOn.includes(p.id)}
            ballot={showLast && lv ? (lv.votes[p.id] ?? null) : null}
            mode={mode}
            voting={game.phase === "vote"}
          />
        ))}
      </ul>
      {showLast && lv && (
        <p className="fade-in font-mono text-[12px] text-ink-soft" aria-live="polite">
          {lv.passed ? "Elected" : "Rejected"}, {ja} Ja! – {nein} Nein.
        </p>
      )}
    </section>
  );
}

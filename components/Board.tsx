"use client";

// The two tracks, laid out like the colorized boards: a red Fascist track with six slots (power
// icon + short text for this player count, tile placed over it when enacted) and a blue Liberal
// track with five, the Election Tracker, and the draw / discard stacks.

import { useEffect, useRef, useState } from "react";
import type { GameView, PowerKind } from "@/lib/game";
import { TileImg, cx } from "./cards";

const POWER: Record<PowerKind, { icon: string; text: string; alt: string }> = {
  peek: { icon: "/cards/icon-peek.webp", text: "Top three cards", alt: "Policy Peek" },
  investigate: { icon: "/cards/icon-investigate.webp", text: "Investigate a player", alt: "Investigate Loyalty" },
  special: { icon: "/cards/icon-special-election.webp", text: "Choose next President", alt: "Call Special Election" },
  execute: { icon: "/cards/icon-execute.webp", text: "Execute a player", alt: "Execution" },
};

/** Index of a tile that was enacted since we mounted, for ~1 s, so only new tiles slide in. */
function useFreshSlot(count: number): number | null {
  const prev = useRef(count);
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => {
    if (count > prev.current) {
      setFresh(count - 1);
      const t = setTimeout(() => setFresh(null), 1000);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count]);
  return fresh;
}

function Arrow({ tone, className }: { tone: "red" | "white" | "blue"; className?: string }) {
  const ring = tone === "red" ? "bg-fas-frame text-white" : tone === "blue" ? "bg-lib-frame text-white" : "border-2 border-white bg-fas-frame text-white";
  return (
    <span aria-hidden="true" className={cx("absolute top-1/2 z-10 grid h-[22px] w-[22px] -translate-y-1/2 place-items-center rounded-full", ring, className)}>
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 6h7M6.5 3l3 3-3 3" />
      </svg>
    </span>
  );
}

function FascistSlot({ index, power, vetoSlot, tile, fresh }: { index: number; power: PowerKind | null; vetoSlot: boolean; tile: boolean; fresh: boolean }) {
  const red = index >= 3;
  const isWin = index === 5;
  const info = power ? POWER[power] : null;
  const label = isWin
    ? "Sixth Fascist policy: Fascists win"
    : info
      ? `Fascist policy ${index + 1}: ${info.alt}${vetoSlot ? ", Veto Power unlocks" : ""}`
      : `Fascist policy ${index + 1}: no power`;
  return (
    <div
      role="img"
      aria-label={`${label}${tile ? " (enacted)" : ""}`}
      className={cx(
        "relative flex min-h-[104px] flex-col items-center justify-center px-1.5 py-2 text-center",
        red ? "bg-fas-frame text-white" : "bg-paper text-fas-ink",
        index % 3 !== 0 && (red ? "border-l-[3px] border-dotted border-white" : "border-l-[3px] border-dotted border-fas-frame"),
      )}
    >
      {index % 3 !== 0 && <Arrow tone={red ? "white" : "red"} className="-left-[12px]" />}
      {index === 3 && <Arrow tone="white" className="-left-[12px] hidden sm:grid" />}

      {tile ? (
        <TileImg policy="fascist" className={cx("h-[84px] w-auto", fresh && "place-tile")} />
      ) : isWin ? (
        <>
          <img src="/cards/emblem-fascist.webp" alt="" width={388} height={458} className="h-[62px] w-auto" />
          <p className="mt-1 text-[10px] font-medium uppercase leading-tight tracking-wide">Fascists win</p>
        </>
      ) : info ? (
        <>
          <img src={info.icon} alt="" className="h-9 w-auto max-w-[64px] object-contain" />
          <p className="mt-1.5 text-[10px] font-medium uppercase leading-tight tracking-wide">{info.text}</p>
          {vetoSlot && <p className="mt-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide">Veto unlocked</p>}
        </>
      ) : (
        <div aria-hidden="true" className="dots-fas absolute inset-2" />
      )}
    </div>
  );
}

/** A draw/discard stack with its count, sized to sit in the Liberal track's header band. */
function Pile({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-white" aria-label={`${label} pile: ${count}`}>
      <div className="relative h-[27px] w-[19px] shrink-0" aria-hidden="true">
        {count > 2 && <img src="/cards/tile-back.webp" alt="" className="absolute left-[3px] top-[-2px] h-full w-full" />}
        {count > 0 && <img src="/cards/tile-back.webp" alt="" className="absolute left-[1.5px] top-[-1px] h-full w-full" />}
        {count > 0 ? (
          <img src="/cards/tile-back.webp" alt="" className="absolute left-0 top-0 h-full w-full" />
        ) : (
          <span className="absolute inset-0 rounded-[3px] border border-dashed border-white/80" />
        )}
      </div>
      <div className="leading-none">
        <div className="font-display text-[9px] font-semibold uppercase tracking-[0.12em]">{label}</div>
        <div className="mt-0.5 font-mono text-[14px] font-semibold">{count}</div>
      </div>
    </div>
  );
}

function ElectionTracker({ failed }: { failed: number }) {
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`Election Tracker: ${failed} of 3 failed governments`}>
      <span className="w-[68px] shrink-0 font-display text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-lib-ink">
        Election tracker
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-between">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center">
            {i > 0 && (
              <span aria-hidden="true" className="mx-1 flex items-center gap-0.5 font-display text-[9px] font-semibold uppercase tracking-wider text-lib-ink">
                <span className="hidden min-[420px]:inline">Fail</span>
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" />
                </svg>
              </span>
            )}
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border-[2.5px] border-dotted border-lib-frame">
              <span className={cx("grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-lib-frame", i === 3 && "bg-lib-pale")}>
                {i === failed && <span className="h-[10px] w-[10px] rounded-full bg-fas-ink" />}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Board({ game }: { game: GameView }) {
  const freshF = useFreshSlot(game.fascistPolicies);
  const freshL = useFreshSlot(game.liberalPolicies);

  return (
    <div className="flex flex-col gap-3">
      {/* ---------------- Fascist track ---------------- */}
      <section aria-label="Fascist track" className="overflow-hidden rounded-[6px] border-[3px] border-fas-frame bg-fas-frame">
        <h2 className="py-[3px] text-center font-display text-[17px] font-extrabold uppercase tracking-[0.34em] text-white">Fascist</h2>
        <div className="grid sm:grid-cols-2">
          <div className="grid grid-cols-3 bg-paper">
            {[0, 1, 2].map((i) => (
              <FascistSlot key={i} index={i} power={game.powers[i] ?? null} vetoSlot={false} tile={game.fascistPolicies > i} fresh={freshF === i} />
            ))}
          </div>
          <div className="bg-fas-frame">
            <p className="mx-2 mt-2 rounded-full bg-paper px-2 py-0.5 text-center text-[10px] font-medium uppercase leading-snug tracking-wide text-fas-ink sm:mt-2">
              Fascists win if Hitler is elected Chancellor
            </p>
            <div className="grid grid-cols-3">
              {[3, 4, 5].map((i) => (
                <FascistSlot key={i} index={i} power={game.powers[i] ?? null} vetoSlot={i === 4} tile={game.fascistPolicies > i} fresh={freshF === i} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Liberal track ---------------- */}
      <section aria-label="Liberal track" className="overflow-hidden rounded-[6px] border-[3px] border-lib-frame bg-lib-frame">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 py-1">
          <div className="justify-self-start">
            <Pile label="Draw" count={game.drawCount} />
          </div>
          <h2 className="font-display text-[17px] font-extrabold uppercase tracking-[0.34em] text-white">Liberal</h2>
          <div className="justify-self-end">
            <Pile label="Discard" count={game.discardCount} />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-px bg-lib-frame">
          {[0, 1, 2, 3, 4].map((i) => {
            const win = i === 4;
            const tile = game.liberalPolicies > i;
            return (
              <div
                key={i}
                role="img"
                aria-label={`Liberal policy ${i + 1}${win ? ": Liberals win" : ""}${tile ? " (enacted)" : ""}`}
                className={cx("relative grid min-h-[88px] place-items-center", win ? "bg-lib-deep" : "dots-lib bg-paper")}
              >
                {tile ? (
                  <TileImg policy="liberal" className={cx("h-[76px] w-auto", freshL === i && "place-tile")} />
                ) : win ? (
                  <img src="/cards/emblem-liberal.webp" alt="" width={420} height={393} className="w-[86%]" />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="bg-paper px-3 py-2.5">
          <ElectionTracker failed={game.electionTracker} />
        </div>
      </section>
    </div>
  );
}

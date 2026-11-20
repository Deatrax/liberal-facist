"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WinReason } from "@/lib/game";
import { playSound } from "@/lib/client/sound";
import type { Room } from "@/lib/client/useRoom";
import { ActionDock } from "./ActionDock";
import { Board } from "./Board";
import { cx, PartyImg } from "./cards";
import { LogSheet, MenuSheet, RulesSheet } from "./Panels";
import { Players } from "./Players";
import { RoleCards } from "./RoleCards";
import { Sheet } from "./Sheet";

const WIN_TEXT: Record<WinReason, string> = {
  liberalPolicies: "Five Liberal policies were enacted.",
  fascistPolicies: "Six Fascist policies were enacted.",
  hitlerElected: "Hitler was elected Chancellor.",
  hitlerExecuted: "Hitler was executed.",
};

type SheetName = "role" | "log" | "menu" | "rules" | null;

export function Game({ room }: { room: Room }) {
  const view = room.view!;
  const game = view.game!;
  const [sheet, setSheet] = useState<SheetName>(null);
  const names = useMemo(() => new Map(game.players.map((p) => [p.id, p.name])), [game.players]);
  const needsMe = game.prompt !== null;

  // "Your turn" in the tab title while the tab is in the background (or the window unfocused).
  useEffect(() => {
    const update = () => {
      document.title = needsMe && (document.hidden || !document.hasFocus()) ? "● Your turn · Secret Hitler" : "Secret Hitler";
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
      document.title = "Secret Hitler";
    };
  }, [needsMe]);

  // Optional sound when a policy lands.
  const prev = useRef({ l: game.liberalPolicies, f: game.fascistPolicies });
  useEffect(() => {
    if (game.liberalPolicies > prev.current.l) playSound("policy-liberal");
    else if (game.fascistPolicies > prev.current.f) playSound("policy-fascist");
    prev.current = { l: game.liberalPolicies, f: game.fascistPolicies };
  }, [game.liberalPolicies, game.fascistPolicies]);

  const closeSheet = () => setSheet(null);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col gap-4 px-4 pb-6">
      <header className="sticky top-0 z-30 -mx-4 flex items-center gap-2 border-b border-ink/20 bg-paper px-4 py-2">
        <img src="/cards/emblem-neutral.webp" alt="" width={360} height={355} className="hidden h-7 w-7 min-[390px]:block" />
        <span className="font-mono text-[13px] font-semibold tracking-[0.3em]" aria-label={`Room ${view.code}`}>
          {view.code}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button type="button" className="btn btn-primary !px-3 !tracking-[0.1em]" onClick={() => setSheet("role")}>
            My role
          </button>
          <button type="button" className="btn !px-3 !tracking-[0.1em]" onClick={() => setSheet("log")}>
            Log
          </button>
          <button type="button" className="btn !px-3 !tracking-[0.1em]" onClick={() => setSheet("menu")}>
            Menu
          </button>
        </div>
      </header>

      {game.winner && (
        <section
          aria-live="polite"
          className={cx(
            "flex items-center gap-4 rounded-[6px] border-[3px] p-3",
            game.winner.team === "liberal" ? "border-lib-frame bg-lib-pale/30" : "border-fas-frame bg-fas-pale/30",
          )}
        >
          <div className="w-[76px] shrink-0">
            <PartyImg party={game.winner.team} />
          </div>
          <div>
            <p className={cx("font-display text-[28px] font-extrabold uppercase leading-none tracking-[0.1em]", game.winner.team === "liberal" ? "text-lib-ink" : "text-fas-ink")}>
              {game.winner.team === "liberal" ? "Liberals win" : "Fascists win"}
            </p>
            <p className="mt-2 text-[13px]">{WIN_TEXT[game.winner.reason]}</p>
          </div>
        </section>
      )}

      <Board game={game} />
      <Players game={game} idle={room.idle} meId={view.me.id} />

      <div className="mt-auto" />
      <ActionDock game={game} meId={view.me.id} hostId={view.hostId} act={room.act} pending={room.pending} error={room.error} />

      {sheet === "role" && (
        <Sheet label="Your cards" onClose={closeSheet}>
          <div className="mx-auto max-w-[420px]">
            <RoleCards me={game.me} names={names} />
          </div>
        </Sheet>
      )}
      {sheet === "log" && <LogSheet game={game} onClose={closeSheet} />}
      {sheet === "rules" && <RulesSheet onClose={closeSheet} />}
      {sheet === "menu" && <MenuSheet view={view} pending={room.pending} onClose={closeSheet} onRules={() => setSheet("rules")} act={room.act} />}
    </div>
  );
}

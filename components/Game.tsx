"use client";

import { useEffect, useMemo, useState } from "react";
import type { WinReason } from "@/lib/game";
import type { Room } from "@/lib/client/useRoom";
import { ActionDock } from "./ActionDock";
import { Board } from "./Board";
import { cx, PartyImg } from "./cards";
import { CreditsSheet, LogSheet, MenuSheet, RulesSheet } from "./Panels";
import { Players } from "./Players";
import { RoleCards } from "./RoleCards";
import { Sheet } from "./Sheet";

const WIN_TEXT: Record<WinReason, string> = {
  liberalPolicies: "Five Liberal policies were enacted.",
  fascistPolicies: "Six Fascist policies were enacted.",
  hitlerElected: "Hitler was elected Chancellor.",
  hitlerExecuted: "Hitler was executed.",
};

type SheetName = "role" | "log" | "menu" | "rules" | "credits" | null;

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

  const closeSheet = () => setSheet(null);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col gap-4 px-4 pb-6 lg:max-w-[1400px] lg:px-6">
      <header className="sticky top-0 z-30 -mx-4 flex items-center gap-2 border-b border-ink/20 bg-paper px-4 py-2 lg:-mx-6 lg:px-6">
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

      {/* Phones: one column (these wrappers vanish via display: contents). Wide screens: the board on the
          left (~65%), seats and your action area in a sticky column on the right (~35%). */}
      <div className="contents lg:grid lg:grid-cols-[minmax(0,13fr)_minmax(0,7fr)] lg:items-start lg:gap-6">
        <Board game={game} />
        <aside className="contents lg:sticky lg:top-[76px] lg:flex lg:max-h-[calc(100dvh-92px)] lg:flex-col lg:gap-3">
          <Players game={game} idle={room.idle} meId={view.me.id} />
          <div className="mt-auto lg:hidden" />
          <ActionDock game={game} meId={view.me.id} hostId={view.hostId} act={room.act} pending={room.pending} error={room.error} />
        </aside>
      </div>

      {sheet === "role" && (
        <Sheet label="Your cards" onClose={closeSheet}>
          <div className="mx-auto max-w-[420px]">
            <RoleCards me={game.me} names={names} />
          </div>
        </Sheet>
      )}
      {sheet === "log" && <LogSheet game={game} onClose={closeSheet} />}
      {sheet === "rules" && <RulesSheet onClose={closeSheet} />}
      {sheet === "credits" && <CreditsSheet onClose={closeSheet} />}
      {sheet === "menu" && <MenuSheet view={view} pending={room.pending} onClose={closeSheet} onRules={() => setSheet("rules")} onCredits={() => setSheet("credits")} act={room.act} />}
    </div>
  );
}

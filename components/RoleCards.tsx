"use client";

// Your Secret Role and Party Membership cards. Face-down by default so people sitting next to you can't
// peek. Tap a card to turn both over, or hold the button to look only while you press it.

import { useState } from "react";
import type { GameView, Policy } from "@/lib/game";
import { CardBackImg, Flip, PartyImg, RoleImg, cx } from "./cards";

const PARTY_WORD = { liberal: "a Liberal", fascist: "a Fascist" } as const;
const word = (p: Policy) => (p === "liberal" ? "Liberal" : "Fascist");

export function RoleCards({ me, names }: { me: GameView["me"]; names: Map<string, string> }) {
  const [flipped, setFlipped] = useState(false);
  const [held, setHeld] = useState(false);
  const show = flipped || held;
  const nameOf = (id: string) => names.get(id) ?? "?";

  const fascists = me.allies.filter((a) => a.role === "fascist").map((a) => nameOf(a.id));
  const hitler = me.allies.find((a) => a.role === "hitler");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-pressed={flipped}
          aria-label={show ? "Hide your cards" : "Turn your cards face up"}
          className="no-select block w-full rounded-[6px]"
        >
          <Flip up={show} className="aspect-[540/787]" back={<CardBackImg />} front={<RoleImg role={me.role} />} />
        </button>
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-pressed={flipped}
          aria-label={show ? "Hide your cards" : "Turn your cards face up"}
          className="no-select block w-full rounded-[6px]"
        >
          <Flip up={show} className="aspect-[520/735]" back={<CardBackImg />} front={<PartyImg party={me.party} />} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cx("btn no-select touch-none", held && "bg-ink text-paper")}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setHeld(true);
          }}
          onPointerUp={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onLostPointerCapture={() => setHeld(false)}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setHeld(true)}
          onKeyUp={() => setHeld(false)}
          onBlur={() => setHeld(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          Hold to reveal
        </button>
        {flipped && (
          <button type="button" className="btn btn-quiet" onClick={() => setFlipped(false)}>
            Hide
          </button>
        )}
      </div>

      {show && (
        <div className="fade-in flex flex-col gap-2 text-[13px]" aria-live="polite">
          <p>
            You are {me.role === "hitler" ? "Hitler" : me.role === "fascist" ? "a Fascist" : "a Liberal"}. Party Membership:{" "}
            {PARTY_WORD[me.party]}.
          </p>
          {me.role === "fascist" && (
            <p>
              {fascists.length > 0 ? `Fellow Fascists: ${fascists.join(", ")}. ` : "You are the only ordinary Fascist. "}
              {hitler ? `Hitler: ${nameOf(hitler.id)}.` : ""}
            </p>
          )}
          {me.role === "hitler" && (
            <p>{fascists.length > 0 ? `Your Fascist: ${fascists.join(", ")}.` : "You do not know who the Fascists are."}</p>
          )}
          {me.notes.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-ink/20 pt-2">
              {me.notes.map((n, i) => (
                <li key={i}>
                  {n.kind === "investigation"
                    ? `Round ${n.round}: ${nameOf(n.targetId)} is in the ${word(n.party)} party.`
                    : `Round ${n.round}: the top three policies were ${n.cards.map(word).join(", ")}.`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/lib/game";
import type { Room } from "@/lib/client/useRoom";
import { cx } from "./cards";

function Chevron({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cx("h-4 w-4", down && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 10.5L8 6l4.5 4.5" />
    </svg>
  );
}

export function Lobby({ room }: { room: Room }) {
  const router = useRouter();
  const view = room.view!;
  const seats = view.seats;
  const isHost = view.me.isHost;
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/${view.code}`;

  const move = (i: number, d: -1 | 1) => {
    const order = seats.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    void room.act({ type: "reorder", order });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", link);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-col gap-6 px-4 py-8">
      <img src="/cards/wordmark.webp" alt="Secret Hitler" width={900} height={629} className="mx-auto w-[210px]" />

      <div className="flex items-center justify-between gap-3 rounded-[4px] border-[1.5px] border-ink px-4 py-3">
        <span className="font-display text-[36px] font-extrabold leading-none tracking-[0.28em]" aria-label={`Room code ${view.code.split("").join(" ")}`}>
          {view.code}
        </span>
        <button type="button" className="btn" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <ol className="flex flex-col gap-2">
        {seats.map((s, i) => {
          const me = s.id === view.me.id;
          return (
            <li
              key={s.id}
              className={cx(
                "flex min-h-[52px] items-center gap-3 rounded-[4px] border-[1.5px] border-ink/25 px-3 py-1",
                room.idle.has(s.id) && "opacity-55",
              )}
            >
              <span className="w-5 font-mono text-[12px] text-ink-soft">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold">
                {s.name}
                <span className="ml-2 font-mono text-[11px] font-normal text-ink-soft">
                  {[me && "you", s.id === view.hostId && "host"].filter(Boolean).join(" · ")}
                </span>
              </span>
              {isHost && (
                <span className="flex items-center gap-1">
                  <button type="button" className="btn !min-h-[44px] !min-w-[44px] !px-0" aria-label={`Move ${s.name} up`} disabled={i === 0 || room.pending} onClick={() => move(i, -1)}>
                    <Chevron />
                  </button>
                  <button type="button" className="btn !min-h-[44px] !min-w-[44px] !px-0" aria-label={`Move ${s.name} down`} disabled={i === seats.length - 1 || room.pending} onClick={() => move(i, 1)}>
                    <Chevron down />
                  </button>
                  {!me && (
                    <button type="button" className="btn btn-quiet !px-2" disabled={room.pending} onClick={() => room.act({ type: "kick", playerId: s.id })}>
                      Remove
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {room.error && (
        <p role="alert" className="text-[12px] text-fas-ink">
          {room.error}
        </p>
      )}

      {isHost ? (
        <div className="flex flex-col gap-2">
          <button type="button" className="btn btn-primary" disabled={seats.length < MIN_PLAYERS || room.pending} onClick={() => room.act({ type: "start" })}>
            Start
          </button>
          {seats.length < MIN_PLAYERS && (
            <p className="text-center text-[12px] text-ink-soft">
              {MIN_PLAYERS - seats.length} more to start ({MIN_PLAYERS}–{MAX_PLAYERS} players).
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-[13px] text-ink-soft" aria-live="polite">
            Waiting for {seats.find((s) => s.id === view.hostId)?.name} to start.
          </p>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={room.pending}
            onClick={async () => {
              if (await room.act({ type: "leave" })) router.push("/");
            }}
          >
            Leave
          </button>
        </div>
      )}
    </main>
  );
}

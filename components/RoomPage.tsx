"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRoom, type Room } from "@/lib/client/useRoom";
import { loadName, withDevSeat } from "@/lib/client/storage";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import { useRoomAudio } from "./useRoomAudio";

function Quiet({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex max-w-[420px] flex-col items-center gap-4 px-4 py-24 text-center text-[14px]">{children}</main>;
}

function JoinForm({ code, room }: { code: string; room: Room }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName((n) => n || loadName()), []);
  return (
    <main className="mx-auto flex w-full max-w-[380px] flex-col gap-6 px-4 py-16">
      <p className="text-center font-display text-[44px] font-extrabold leading-none tracking-[0.28em]">{code}</p>
      {room.notice && <p className="text-center text-[13px] text-ink-soft">{room.notice}</p>}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(await room.join(name));
          setBusy(false);
        }}
      >
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={16} autoComplete="nickname" aria-label="Your name" autoFocus />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Join
        </button>
        {error && (
          <p role="alert" className="text-[13px] text-fas-ink">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

export function RoomPage({ code }: { code: string }) {
  const room = useRoom(code);
  useRoomAudio(room.status === "ready" ? room.view : null);
  switch (room.status) {
    case "loading":
      return <Quiet>Loading…</Quiet>;
    case "missing":
      return (
        <Quiet>
          <p>That room does not exist, or it has expired.</p>
          <Link className="btn" href={withDevSeat("/")}>
            Home
          </Link>
        </Quiet>
      );
    case "offline":
      return (
        <Quiet>
          <p>Cannot reach the server.</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        </Quiet>
      );
    case "join":
      return <JoinForm code={code} room={room} />;
    case "ready":
      return room.view?.game ? <Game room={room} /> : <Lobby room={room} />;
  }
}

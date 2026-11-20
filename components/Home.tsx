"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROOM_CODE_RE } from "@/lib/game";
import { api } from "@/lib/client/api";
import { loadName, saveCreds, saveName, withDevSeat } from "@/lib/client/storage";

export function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setName((n) => n || loadName()), []);

  const run = async (fn: () => Promise<string>) => {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      saveName(name.trim());
      router.push(withDevSeat(`/${await fn()}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const r = await api.createRoom(name.trim());
      saveCreds(r.code, { playerId: r.playerId, token: r.token });
      return r.code;
    });

  const join = () =>
    run(async () => {
      const c = code.trim().toUpperCase();
      if (!ROOM_CODE_RE.test(c)) throw new Error("Room codes are four letters.");
      const r = await api.join(c, name.trim());
      saveCreds(c, r);
      return c;
    });

  return (
    <main className="mx-auto flex w-full max-w-[380px] flex-col items-stretch gap-8 px-4 py-14">
      <img src="/cards/wordmark.webp" alt="Secret Hitler" width={900} height={629} className="mx-auto w-[280px]" />

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (code.trim() ? join() : create());
        }}
      >
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={16}
          autoComplete="nickname"
          aria-label="Your name"
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
          Create room
        </button>

        <div className="mt-4 flex gap-2">
          <input
            className="field flex-1 text-center font-display text-[20px] font-bold uppercase tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 4))}
            placeholder="CODE"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Room code"
          />
          <button type="button" className="btn" disabled={busy || code.length !== 4} onClick={join}>
            Join
          </button>
        </div>

        {error && (
          <p role="alert" className="text-[13px] text-fas-ink">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

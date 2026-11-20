"use client";

// The room session: credentials, the cheap version poll, fetching the personalised state when
// (and only when) the version changes, and sending actions.
//
//  - polls GET /version every ~1.5 s in a game, ~5 s in the lobby and after the game ends
//  - pauses completely while the tab is hidden, and polls immediately when it comes back
//  - after your own action the server's response IS your new state: no extra fetch

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnyAction, RoomView } from "@/lib/game";
import { ApiError, api, type Creds } from "./api";
import { clearCreds, devSeat, loadCreds, loadName, saveCreds, saveName } from "./storage";

export type Status = "loading" | "join" | "ready" | "missing" | "offline";

const GAME_POLL_MS = 1500;
const QUIET_POLL_MS = 5000;

export interface Room {
  status: Status;
  view: RoomView | null;
  /** Players who haven't polled for a while (shown dimmed). */
  idle: Set<string>;
  notice: string | null;
  error: string | null;
  pending: boolean;
  join: (name: string) => Promise<string | null>;
  act: (action: AnyAction) => Promise<boolean>;
  clearError: () => void;
}

export function useRoom(code: string): Room {
  const [creds, setCreds] = useState<Creds | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<RoomView | null>(null);
  const [idle, setIdle] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const version = useRef(0);
  const phase = useRef<"quiet" | "game">("quiet");
  const credsRef = useRef<Creds | null>(null);

  const applyView = useCallback((v: RoomView) => {
    if (v.version < version.current) return; // an older response that lost the race
    version.current = v.version;
    phase.current = v.game && v.game.phase !== "gameOver" ? "game" : "quiet";
    setView(v);
    setStatus("ready");
  }, []);

  const dropSeat = useCallback(
    (message: string) => {
      clearCreds(code);
      credsRef.current = null;
      version.current = 0;
      setCreds(null);
      setView(null);
      setNotice(message);
      setStatus("join");
    },
    [code],
  );

  // 1. Who am I in this room? (localStorage; in dev, `?as=` gives each tab its own seat)
  useEffect(() => {
    const c = loadCreds(code);
    credsRef.current = c;
    setCreds(c);
    if (!c) setStatus("join");
  }, [code]);

  const fetchState = useCallback(
    async (c: Creds) => {
      try {
        applyView(await api.state(code, c));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) dropSeat("You are no longer seated in this room.");
        else if (e instanceof ApiError && e.status === 404) setStatus("missing");
        else setStatus((s) => (s === "ready" ? s : "offline"));
      }
    },
    [applyView, code, dropSeat],
  );

  // 2. Initial state, then the poll loop.
  useEffect(() => {
    if (!creds) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (stopped || document.hidden) return; // hidden: stay paused until visibilitychange
      timer = setTimeout(tick, phase.current === "game" ? GAME_POLL_MS : QUIET_POLL_MS);
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const { v, idle: ids } = await api.version(code, creds.playerId);
        if (stopped) return;
        setIdle(new Set(ids));
        if (v !== version.current) await fetchState(creds);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setStatus("missing");
          return;
        }
        /* network blip: just try again on the next beat */
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        clearTimeout(timer);
        void tick();
      }
    };

    void fetchState(creds).then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [creds, code, fetchState]);

  const join = useCallback(
    async (rawName: string): Promise<string | null> => {
      const name = rawName.trim();
      if (!name) return "Enter a name.";
      try {
        const c = await api.join(code, name);
        saveCreds(code, c);
        saveName(name);
        credsRef.current = c;
        setNotice(null);
        setStatus("loading");
        setCreds(c);
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setStatus("missing");
        return e instanceof Error ? e.message : "Could not join.";
      }
    },
    [code],
  );

  const act = useCallback(
    async (action: AnyAction): Promise<boolean> => {
      const c = credsRef.current;
      if (!c) return false;
      setPending(true);
      setError(null);
      try {
        const res = await api.action(code, c, action);
        if ("left" in res) {
          dropSeat("You left the room.");
        } else {
          applyView(res.view);
        }
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) dropSeat("You are no longer seated in this room.");
        else setError(e instanceof Error ? e.message : "Something went wrong.");
        return false;
      } finally {
        setPending(false);
      }
    },
    [applyView, code, dropSeat],
  );

  // Dev convenience: `/{code}?as=ann` joins as "ann" without typing.
  useEffect(() => {
    if (creds !== null || status !== "join" || notice) return;
    const as = devSeat();
    if (as && !loadCreds(code)) void join(loadName());
  }, [creds, status, notice, code, join]);

  const clearError = useCallback(() => setError(null), []);
  return { status, view, idle, notice, error, pending, join, act, clearError };
}

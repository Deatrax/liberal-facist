"use client";

// Turns what happens in the room into sound: the music bed follows the state of the game, and each
// newly arrived public event (vote reveal, policy, chaos, shot, ...) plays its cue. History is never
// replayed: joining or reloading mid-game stays silent until something new happens.

import { useEffect, useRef } from "react";
import type { RoomView } from "@/lib/game";
import { audio } from "@/lib/client/audio";
import { crossedIntoHitlerZone, newEntries, planEvents, promptKey, shouldRingTurn, trackFor } from "@/lib/client/audio-cues";

interface Seen {
  logN: number;
  fascist: number;
  alive: boolean;
  prompt: string | null;
  seats: number;
}

export function useRoomAudio(view: RoomView | null): void {
  const prev = useRef<Seen | null>(null);

  useEffect(() => audio.boot(), []);

  const game = view?.game ?? null;
  const track = view ? trackFor(game) : null; // no room (home / join form): silence
  useEffect(() => {
    audio.setTrack(track);
  }, [track]);

  useEffect(() => {
    if (!view) {
      prev.current = null;
      return;
    }
    const before = prev.current;

    if (!game) {
      // Lobby: someone arriving or leaving.
      if (before && before.logN === -1 && before.seats !== view.seats.length) {
        void audio.cue(view.seats.length > before.seats ? "join" : "leave");
      }
      prev.current = { logN: -1, fascist: 0, alive: true, prompt: null, seats: view.seats.length };
      return;
    }

    const lastN = game.log.at(-1)?.n ?? 0;
    // First look at a game that is already running (reload / late open): remember where we are, play nothing.
    // Coming from the lobby, or a rematch (the log restarted), the new game's first entries ARE news.
    let seen = before ? before.logN : lastN;
    if (before && (before.logN === -1 || lastN < before.logN)) seen = 0;

    const plan = planEvents(newEntries(game.log, seen).slice(-8));
    const tail = plan.cues.length ? Math.max(...plan.cues.map((c) => c.at)) + 1.2 : 0;
    audio.play(plan);

    if (before && before.logN !== -1 && crossedIntoHitlerZone(before.fascist, game.fascistPolicies)) {
      void audio.cue("zone", tail);
    }
    if (before && before.logN !== -1 && before.alive && !game.me.alive) {
      void audio.cue("dead", Math.max(tail, 1.3));
    }
    const key = promptKey(game);
    if (before && shouldRingTurn(before.prompt, game)) {
      void audio.cue("turn", tail);
    }

    prev.current = { logN: lastN, fascist: game.fascistPolicies, alive: game.me.alive, prompt: key, seats: view.seats.length };
  }, [view, game]);
}

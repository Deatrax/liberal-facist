// Which sound goes with which moment. Pure functions only (no browser APIs), so the mapping is unit-tested.
//
// Cues are driven by the game's public event log (LogEvent tags), so every player hears the same moments
// at the same points: the vote reveal, a policy landing, chaos, a shot. Music follows the state of the game.

import type { GameView, LogEntry } from "@/lib/game";

export type Cue =
  | "flip"
  | "ballot"
  | "peek"
  | "deal"
  | "reveal"
  | "tap"
  | "confirm"
  | "turn"
  | "join"
  | "leave"
  | "elected"
  | "rejected"
  | "policy-liberal"
  | "policy-fascist"
  | "tracker"
  | "chaos"
  | "zone"
  | "investigate"
  | "special"
  | "veto"
  | "shot"
  | "dead";

export type Track = "lobby" | "suspense" | "paranoia";
export type Stinger = "liberal" | "fascist";

export const CUES: readonly Cue[] = [
  "flip", "ballot", "peek", "deal", "reveal", "tap", "confirm", "turn", "join", "leave", "elected", "rejected",
  "policy-liberal", "policy-fascist", "tracker", "chaos", "zone", "investigate", "special", "veto", "shot", "dead",
];
export const TRACKS: readonly Track[] = ["lobby", "suspense", "paranoia"];
export const STINGERS: readonly Stinger[] = ["liberal", "fascist"];

/** Relative playback level per cue. Tactile paper sounds are quiet recordings, so they get a lift; alerts stay gentle. */
export const CUE_GAIN: Record<Cue, number> = {
  flip: 1.5, ballot: 1.6, peek: 1.1, deal: 1.4, reveal: 1.1, tap: 0.9, confirm: 0.5, turn: 0.55, join: 0.5, leave: 0.45,
  elected: 0.6, rejected: 0.75, "policy-liberal": 0.7, "policy-fascist": 1.0, tracker: 0.7, chaos: 1.0, zone: 0.9,
  investigate: 0.6, special: 0.7, veto: 1.0, shot: 0.95, dead: 0.8,
};

export interface PlannedCue {
  cue: Cue;
  /** Seconds from now. */
  at: number;
}

export interface Plan {
  cues: PlannedCue[];
  stinger: { kind: Stinger; at: number } | null;
}

/** Log entries the client has not heard yet. */
export function newEntries(log: LogEntry[], lastSeen: number): LogEntry[] {
  return log.filter((l) => l.n > lastSeen);
}

/**
 * Turns freshly arrived public events into a short timeline. Several events can arrive in one update
 * (a rejected vote that tips the tracker into chaos and enacts a policy), so each is spaced after the last.
 */
export function planEvents(entries: LogEntry[]): Plan {
  const cues: PlannedCue[] = [];
  let stinger: Plan["stinger"] = null;
  let t = 0.05;
  const add = (cue: Cue, at: number) => cues.push({ cue, at });

  for (const e of entries) {
    switch (e.ev) {
      case "start":
        add("deal", t);
        t += 0.3;
        break;
      case "elected":
        add("reveal", t);
        add("elected", t + 0.85);
        t += 1.7;
        break;
      case "rejected":
        add("reveal", t);
        add("rejected", t + 0.85);
        t += 1.7;
        break;
      case "not-hitler":
        add("confirm", t);
        t += 0.6;
        break;
      case "policy":
        add(e.policy === "liberal" ? "policy-liberal" : "policy-fascist", t);
        t += 1.3;
        break;
      case "tracker":
        add("tracker", t);
        t += 0.6;
        break;
      case "chaos":
        add("chaos", t);
        t += 2.0;
        break;
      case "investigate":
        add("investigate", t);
        t += 1.1;
        break;
      case "special":
        add("special", t);
        t += 1.1;
        break;
      case "peek":
        add("peek", t);
        t += 0.7;
        break;
      case "execute":
        add("shot", t);
        t += 1.2;
        break;
      case "veto-ask":
        add("veto", t);
        t += 1.0;
        break;
      case "veto-agree":
        add("rejected", t);
        t += 1.1;
        break;
      case "veto-refuse":
        add("tracker", t);
        t += 0.6;
        break;
      case "reshuffle":
        add("deal", t);
        t += 0.9;
        break;
      case "win":
        stinger = { kind: e.text.startsWith("Liberals") ? "liberal" : "fascist", at: t };
        break;
      default:
        break;
    }
  }
  return { cues, stinger };
}

/** The third Fascist policy opens the "Hitler zone": the music darkens and a low swell plays once. */
export function crossedIntoHitlerZone(prevFascist: number, nextFascist: number): boolean {
  return prevFascist < 3 && nextFascist >= 3;
}

/** Background music for the room state. Silence (null) is for screens that aren't in a room. */
export function trackFor(game: GameView | null): Track {
  if (!game || game.phase === "gameOver") return "lobby"; // the lobby bed returns once the stinger has played
  return game.fascistPolicies >= 3 ? "paranoia" : "suspense";
}

/** Identifies one prompt instance, so "it is your turn" fires once per prompt, not once per poll. */
export function promptKey(game: GameView | null): string | null {
  if (!game?.prompt) return null;
  return `${game.round}:${game.phase}:${game.prompt.kind}`;
}

/** Should this change of prompt ring the "your turn" bell? (Not for "Ready": the whole table has that one at the deal.) */
export function shouldRingTurn(prevKey: string | null, game: GameView | null): boolean {
  const key = promptKey(game);
  return key !== null && key !== prevKey && game!.prompt!.kind !== "ready";
}

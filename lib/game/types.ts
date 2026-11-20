// Shared types for the pure game engine. Everything here is JSON-serialisable
// (no Sets/Maps/Dates) because the whole room is stored as one JSON document.

export type Party = "liberal" | "fascist";
export type Role = "liberal" | "fascist" | "hitler";
export type Policy = Party;
export type Vote = "ja" | "nein";
export type PowerKind = "investigate" | "special" | "peek" | "execute";

export type Phase =
  | "roleReveal" // everyone looks at their role, taps Ready
  | "nominate" // Presidential Candidate picks a Chancellor Candidate
  | "vote" // everyone alive votes Ja!/Nein
  | "presidentDiscard" // President holds 3 policies, discards 1
  | "chancellorEnact" // Chancellor holds 2 policies, discards 1 and enacts the other (or vetoes)
  | "vetoDecision" // Chancellor asked for a veto, President decides
  | "executive" // President must use the power the policy unlocked
  | "gameOver";

export type WinReason =
  | "liberalPolicies" // five Liberal policies
  | "fascistPolicies" // six Fascist policies
  | "hitlerElected" // Hitler elected Chancellor after three Fascist policies
  | "hitlerExecuted"; // Hitler executed

export interface GamePlayer {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
}

export type LogKind = "info" | "nominate" | "vote" | "policy" | "power" | "death" | "end";

/**
 * What happened, as a machine-readable tag. Clients turn these into sound cues, so every player
 * hears the same public moments without anyone parsing log text.
 */
export type LogEvent =
  | "start"
  | "round"
  | "nominate"
  | "elected"
  | "rejected"
  | "not-hitler"
  | "policy"
  | "tracker"
  | "chaos"
  | "power"
  | "investigate"
  | "special"
  | "peek"
  | "execute"
  | "veto-ask"
  | "veto-agree"
  | "veto-refuse"
  | "reshuffle"
  | "win";

export interface LogEntry {
  n: number;
  kind: LogKind;
  text: string;
  /** Set on "policy" entries so the UI can tint them. */
  policy?: Policy;
  ev?: LogEvent;
}

/** Private knowledge a player earned (investigation results, peeks). Only ever sent to its owner. */
export type Note =
  | { round: number; kind: "investigation"; targetId: string; party: Party }
  | { round: number; kind: "peek"; cards: Policy[] };

export interface VoteResult {
  /** Round number, doubles as an id so the client can animate each reveal once. */
  id: number;
  presidentId: string;
  chancellorId: string;
  votes: Record<string, Vote>;
  passed: boolean;
}

export interface PendingPower {
  kind: PowerKind;
  /** Investigate only: set once the President has chosen, the result stays on screen until ackPower. */
  targetId?: string;
  party?: Party;
}

export interface GameState {
  /** Seat order == clockwise order at the table. */
  players: GamePlayer[];
  phase: Phase;
  round: number;

  // Policy cards. Order matters: deck[0] is the top.
  deck: Policy[];
  discard: Policy[];
  /** Cards currently in the President's (3) or Chancellor's (2) hand. */
  hand: Policy[];

  liberalPolicies: number;
  fascistPolicies: number;
  electionTracker: number;

  /** Seat of the last president chosen by normal rotation. Special elections don't move it. */
  anchor: number;
  /** Seat of the current Presidential Candidate / President. */
  presidentIndex: number;
  /** Chancellor Candidate / Chancellor of the current round. */
  chancellorId: string | null;
  /** Last *elected* government, for term limits. Cleared by chaos. */
  lastElected: { presidentId: string; chancellorId: string } | null;

  /** Ballots of the vote in progress (hidden from clients until the vote resolves). */
  votes: Record<string, Vote>;
  lastVote: VoteResult | null;
  vetoRefused: boolean;
  power: PendingPower | null;

  confirmedNotHitler: string[];
  investigated: string[];
  ready: string[];
  notes: Record<string, Note[]>;

  winner: { team: Party; reason: WinReason } | null;
  log: LogEntry[];
  logSeq: number;
}

export type Action =
  | { type: "ready" }
  | { type: "nominate"; chancellorId: string }
  | { type: "vote"; vote: Vote }
  | { type: "presidentDiscard"; index: number }
  | { type: "chancellorDiscard"; index: number }
  | { type: "requestVeto" }
  | { type: "vetoResponse"; agree: boolean }
  | { type: "investigate"; targetId: string }
  | { type: "specialElection"; targetId: string }
  | { type: "execute"; targetId: string }
  | { type: "ackPower" };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

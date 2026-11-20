// getPlayerView: the ONE place that decides what a client may see.
//
// The server never sends a Room or GameState to a browser. It sends the result of
// getPlayerView(room, playerId), which is built field by field from an allow-list:
//   - no tokens, no deck/discard contents (counts only), no other player's role
//     (except what the rules reveal to this player, or everything at game over),
//   - ballots stay hidden until the vote has resolved (only "has voted" is public),
//   - the President's 3 / Chancellor's 2 policies go to that player only,
//   - investigation results (Party Membership, never Secret Role) and Policy Peek
//     cards go to the acting President only.

import {
  alivePlayers,
  eligibleChancellors,
  partyOf,
  playerById,
  powerTargets,
  presidentOf,
  vetoUnlocked,
  waitingOn,
} from "./engine";
import type { Room } from "./room";
import { hitlerKnowsFascists, powerTrack } from "./setup";
import type {
  GameState,
  LogEntry,
  Note,
  Party,
  Phase,
  Policy,
  PowerKind,
  Role,
  Vote,
  VoteResult,
  WinReason,
} from "./types";

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  alive: boolean;
  isHost: boolean;
  isPresident: boolean;
  isChancellor: boolean;
  /** During a vote: has this player cast a ballot? (Never which.) */
  voted: boolean;
  /** During role reveal: has this player tapped Ready? */
  ready: boolean;
  /** Elected Chancellor after three Fascist policies, so publicly known not to be Hitler. */
  notHitler: boolean;
  /** Publicly known to have been investigated. */
  investigated: boolean;
  /** Only ever set at game over. */
  role: Role | null;
}

/** What the viewer is being asked to do right now, if anything. */
export type Prompt =
  | { kind: "ready" }
  | { kind: "nominate"; targets: string[] }
  | { kind: "vote" }
  | { kind: "discard"; hand: Policy[] }
  | { kind: "enact"; hand: Policy[]; canVeto: boolean }
  | { kind: "vetoDecision" }
  | { kind: "investigate"; targets: string[]; result: { targetId: string; party: Party } | null }
  | { kind: "special"; targets: string[] }
  | { kind: "execute"; targets: string[] }
  | { kind: "peek"; cards: Policy[] };

export interface GameView {
  phase: Phase;
  round: number;
  players: PublicPlayer[];
  presidentId: string;
  chancellorId: string | null;
  liberalPolicies: number;
  fascistPolicies: number;
  electionTracker: number;
  drawCount: number;
  discardCount: number;
  /** Power of each Fascist slot for this player count (slot 6, the skull, has none). */
  powers: (PowerKind | null)[];
  vetoUnlocked: boolean;
  lastElected: { presidentId: string; chancellorId: string } | null;
  lastVote: VoteResult | null;
  waitingOn: string[];
  me: {
    id: string;
    name: string;
    alive: boolean;
    role: Role;
    party: Party;
    /** Other players this player knows the role of (Fascists, and Hitler in 5–6 player games). */
    allies: { id: string; role: Role }[];
    notes: Note[];
    ready: boolean;
    /** Own ballot while the vote is open. */
    vote: Vote | null;
  };
  prompt: Prompt | null;
  winner: { team: Party; reason: WinReason } | null;
  log: LogEntry[];
}

export interface RoomView {
  code: string;
  version: number;
  me: { id: string; name: string; isHost: boolean };
  hostId: string;
  /** Seat order. In a running game this mirrors game.players. */
  seats: { id: string; name: string }[];
  game: GameView | null;
}

export function getPlayerView(room: Room, playerId: string): RoomView {
  const me = room.players.find((p) => p.id === playerId);
  if (!me) throw new Error("not in room");
  return {
    code: room.code,
    version: room.version,
    me: { id: me.id, name: me.name, isHost: me.id === room.hostId },
    hostId: room.hostId,
    seats: room.players.map((p) => ({ id: p.id, name: p.name })),
    game: room.game ? getGameView(room.game, playerId, room.hostId) : null,
  };
}

export function getGameView(s: GameState, playerId: string, hostId: string): GameView {
  const self = playerById(s, playerId);
  if (!self) throw new Error("not in game");
  const over = s.phase === "gameOver";
  const president = presidentOf(s);

  const players: PublicPlayer[] = s.players.map((p, seat) => ({
    id: p.id,
    name: p.name,
    seat,
    alive: p.alive,
    isHost: p.id === hostId,
    isPresident: !over && p.id === president.id,
    isChancellor: !over && p.id === s.chancellorId,
    voted: s.phase === "vote" && !!s.votes[p.id],
    ready: s.ready.includes(p.id),
    notHitler: s.confirmedNotHitler.includes(p.id),
    investigated: s.investigated.includes(p.id),
    role: over ? p.role : null,
  }));

  return {
    phase: s.phase,
    round: s.round,
    players,
    presidentId: president.id,
    chancellorId: s.chancellorId,
    liberalPolicies: s.liberalPolicies,
    fascistPolicies: s.fascistPolicies,
    electionTracker: s.electionTracker,
    drawCount: s.deck.length,
    discardCount: s.discard.length,
    powers: powerTrack(s.players.length),
    vetoUnlocked: vetoUnlocked(s),
    lastElected: s.lastElected ? { ...s.lastElected } : null,
    lastVote: s.lastVote
      ? { ...s.lastVote, votes: { ...s.lastVote.votes } } // resolved ballots are public
      : null,
    waitingOn: waitingOn(s),
    me: {
      id: self.id,
      name: self.name,
      alive: self.alive,
      role: self.role,
      party: partyOf(self.role),
      allies: alliesOf(s, self.id),
      notes: (s.notes[self.id] ?? []).map((n) => ({ ...n })),
      ready: s.ready.includes(self.id),
      vote: s.phase === "vote" ? (s.votes[self.id] ?? null) : null,
    },
    prompt: over ? null : promptFor(s, self.id),
    winner: s.winner ? { ...s.winner } : null,
    log: s.log.map((l) => ({ ...l })),
  };
}

/** What the rules let this player know about other roles. */
function alliesOf(s: GameState, id: string): { id: string; role: Role }[] {
  const self = playerById(s, id)!;
  const others = s.players.filter((p) => p.id !== id);
  if (self.role === "fascist") {
    return others.filter((p) => p.role !== "liberal").map((p) => ({ id: p.id, role: p.role }));
  }
  if (self.role === "hitler" && hitlerKnowsFascists(s.players.length)) {
    return others.filter((p) => p.role === "fascist").map((p) => ({ id: p.id, role: p.role }));
  }
  return [];
}

function promptFor(s: GameState, id: string): Prompt | null {
  const self = playerById(s, id)!;
  if (s.phase === "roleReveal") return s.ready.includes(id) ? null : { kind: "ready" };
  if (!self.alive) return null;

  const isPresident = id === presidentOf(s).id;
  const isChancellor = id === s.chancellorId;

  switch (s.phase) {
    case "nominate":
      return isPresident ? { kind: "nominate", targets: eligibleChancellors(s) } : null;
    case "vote":
      return s.votes[id] ? null : { kind: "vote" };
    case "presidentDiscard":
      return isPresident ? { kind: "discard", hand: [...s.hand] } : null;
    case "chancellorEnact":
      return isChancellor
        ? { kind: "enact", hand: [...s.hand], canVeto: vetoUnlocked(s) && !s.vetoRefused }
        : null;
    case "vetoDecision":
      return isPresident ? { kind: "vetoDecision" } : null;
    case "executive": {
      if (!isPresident || !s.power) return null;
      const kind = s.power.kind;
      if (kind === "peek") return { kind: "peek", cards: s.deck.slice(0, 3) };
      const targets = powerTargets(s, kind);
      if (kind === "investigate") {
        const result = s.power.targetId && s.power.party ? { targetId: s.power.targetId, party: s.power.party } : null;
        return { kind: "investigate", targets: result ? [] : targets, result };
      }
      return { kind, targets };
    }
    default:
      return null;
  }
}

/** Convenience for tests and callers: number of living players. */
export const livingCount = (s: GameState): number => alivePlayers(s).length;

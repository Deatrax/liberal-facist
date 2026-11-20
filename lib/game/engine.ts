// The Secret Hitler rules as a pure reducer: applyAction(state, action, actorId) -> new state | error.
// No I/O, no framework, no clocks. Randomness is injected so tests can be deterministic.
//
// Rule references are to the rulebook (Secret_Hitler_Rules.pdf).

import { cryptoRng, shuffle, type Rng } from "./rng";
import {
  CHAOS_AT,
  FASCIST_POLICIES,
  FASCIST_WIN,
  HITLER_ZONE,
  LIBERAL_POLICIES,
  LIBERAL_WIN,
  MAX_PLAYERS,
  MIN_PLAYERS,
  VETO_UNLOCKS_AT,
  powerTrack,
  roleList,
} from "./setup";
import type {
  Action,
  GamePlayer,
  GameState,
  LogEvent,
  LogKind,
  Party,
  Policy,
  PowerKind,
  Result,
  Role,
  WinReason,
} from "./types";

// ---------------------------------------------------------------------------
// Small queries (also used by the view builder and the UI)

export const partyOf = (role: Role): Party => (role === "liberal" ? "liberal" : "fascist");

export const alivePlayers = (s: GameState): GamePlayer[] => s.players.filter((p) => p.alive);

export const playerById = (s: GameState, id: string | null | undefined): GamePlayer | undefined =>
  id ? s.players.find((p) => p.id === id) : undefined;

export const presidentOf = (s: GameState): GamePlayer => s.players[s.presidentIndex]!;

export const vetoUnlocked = (s: GameState): boolean => s.fascistPolicies >= VETO_UNLOCKS_AT;

/**
 * Who may the Presidential Candidate nominate? (rulebook: Eligibility)
 * - the last *elected* Chancellor is always term-limited;
 * - the last elected President too, unless only five players are alive;
 * - dead players and the candidate themselves are out.
 */
export function eligibleChancellors(s: GameState): string[] {
  const aliveCount = alivePlayers(s).length;
  const president = presidentOf(s);
  const last = s.lastElected;
  return s.players
    .filter((p) => {
      if (!p.alive || p.id === president.id) return false;
      if (last) {
        if (p.id === last.chancellorId) return false;
        if (p.id === last.presidentId && aliveCount > 5) return false;
      }
      return true;
    })
    .map((p) => p.id);
}

/** Valid targets for the pending Presidential Power. */
export function powerTargets(s: GameState, kind: PowerKind): string[] {
  const president = presidentOf(s);
  return s.players
    .filter((p) => {
      if (!p.alive || p.id === president.id) return false;
      // Investigate Loyalty: nobody may be investigated twice in the same game.
      if (kind === "investigate" && s.investigated.includes(p.id)) return false;
      return true;
    })
    .map((p) => p.id);
}

/** Players the game is currently waiting on. */
export function waitingOn(s: GameState): string[] {
  switch (s.phase) {
    case "roleReveal":
      return s.players.filter((p) => !s.ready.includes(p.id)).map((p) => p.id);
    case "nominate":
    case "presidentDiscard":
    case "vetoDecision":
    case "executive":
      return [presidentOf(s).id];
    case "vote":
      return alivePlayers(s)
        .filter((p) => !s.votes[p.id])
        .map((p) => p.id);
    case "chancellorEnact":
      return s.chancellorId ? [s.chancellorId] : [];
    case "gameOver":
      return [];
  }
}

// ---------------------------------------------------------------------------
// Setup

export function newDeck(rng: Rng): Policy[] {
  return shuffle(
    [
      ...Array<Policy>(LIBERAL_POLICIES).fill("liberal"),
      ...Array<Policy>(FASCIST_POLICIES).fill("fascist"),
    ],
    rng,
  );
}

/** Deals secret roles, shuffles the deck, picks the first Presidential Candidate at random. */
export function createGame(
  seats: { id: string; name: string }[],
  rng: Rng = cryptoRng,
): GameState {
  const n = seats.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`Secret Hitler needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  const roles = shuffle(roleList(n), rng);
  const start = rng(n);
  const s: GameState = {
    players: seats.map((p, i) => ({ id: p.id, name: p.name, role: roles[i]!, alive: true })),
    phase: "roleReveal",
    round: 0,
    deck: newDeck(rng),
    discard: [],
    hand: [],
    liberalPolicies: 0,
    fascistPolicies: 0,
    electionTracker: 0,
    anchor: start,
    presidentIndex: start,
    chancellorId: null,
    lastElected: null,
    votes: {},
    lastVote: null,
    vetoRefused: false,
    power: null,
    confirmedNotHitler: [],
    investigated: [],
    ready: [],
    notes: {},
    winner: null,
    log: [],
    logSeq: 0,
  };
  log(s, "info", `A new game begins with ${n} players.`, { ev: "start" });
  return s;
}

// ---------------------------------------------------------------------------
// Reducer

class RuleError extends Error {}
const fail = (message: string): never => {
  throw new RuleError(message);
};

export function applyAction(
  state: GameState,
  action: Action,
  actorId: string,
  rng: Rng = cryptoRng,
): Result<GameState> {
  const s = structuredClone(state);
  try {
    if (s.phase === "gameOver") fail("The game is over.");
    const actor = playerById(s, actorId);
    if (!actor) fail("You are not in this game.");
    handle(s, action, actor!, rng);
    return { ok: true, value: s };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    throw e;
  }
}

function handle(s: GameState, a: Action, actor: GamePlayer, rng: Rng): void {
  if (a.type !== "ready" && !actor.alive) fail("Executed players cannot act.");
  const isPresident = actor.id === presidentOf(s).id;
  const isChancellor = actor.id === s.chancellorId;

  switch (a.type) {
    case "ready": {
      if (s.phase !== "roleReveal") fail("The game has already started.");
      if (!s.ready.includes(actor.id)) s.ready.push(actor.id);
      if (s.ready.length === s.players.length) beginRound(s);
      return;
    }

    case "nominate": {
      if (s.phase !== "nominate") fail("It is not time to nominate.");
      if (!isPresident) fail("Only the Presidential Candidate nominates.");
      const target = playerById(s, a.chancellorId);
      if (!target) fail("Unknown player.");
      if (!eligibleChancellors(s).includes(a.chancellorId)) {
        fail(`${target!.name} is not eligible to be Chancellor.`);
      }
      s.chancellorId = a.chancellorId;
      s.votes = {};
      s.phase = "vote";
      log(s, "nominate", `${actor.name} nominated ${target!.name} as Chancellor.`, { ev: "nominate" });
      return;
    }

    case "vote": {
      if (s.phase !== "vote") fail("There is no vote in progress.");
      if (s.votes[actor.id]) fail("You have already voted.");
      if (a.vote !== "ja" && a.vote !== "nein") fail("Vote Ja! or Nein.");
      s.votes[actor.id] = a.vote;
      if (alivePlayers(s).every((p) => s.votes[p.id])) resolveVote(s, rng);
      return;
    }

    case "presidentDiscard": {
      if (s.phase !== "presidentDiscard") fail("You are not choosing policies.");
      if (!isPresident) fail("Only the President discards here.");
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= s.hand.length) fail("Pick one of the three policies.");
      s.discard.push(s.hand.splice(a.index, 1)[0]!);
      s.vetoRefused = false;
      s.phase = "chancellorEnact";
      return;
    }

    case "chancellorDiscard": {
      if (s.phase !== "chancellorEnact") fail("You are not choosing policies.");
      if (!isChancellor) fail("Only the Chancellor enacts a policy.");
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= s.hand.length) fail("Pick one of the two policies.");
      const [discarded] = s.hand.splice(a.index, 1);
      s.discard.push(discarded!);
      const enacted = s.hand.pop()!;
      enact(s, enacted, `${actor.name} enacted a ${label(enacted)} policy.`);
      if (s.winner) return;
      endOfSession(s, enacted, rng);
      return;
    }

    case "requestVeto": {
      if (s.phase !== "chancellorEnact") fail("You cannot veto now.");
      if (!isChancellor) fail("Only the Chancellor can ask for a veto.");
      if (!vetoUnlocked(s)) fail("Veto Power is not unlocked yet.");
      if (s.vetoRefused) fail("The President already refused your veto.");
      s.phase = "vetoDecision";
      log(s, "info", `${actor.name} asked to veto this agenda.`, { ev: "veto-ask" });
      return;
    }

    case "vetoResponse": {
      if (s.phase !== "vetoDecision") fail("There is no veto to answer.");
      if (!isPresident) fail("Only the President answers a veto.");
      if (a.agree) {
        s.discard.push(...s.hand);
        s.hand = [];
        log(s, "info", `${actor.name} agreed to the veto. Both policies were discarded.`, { ev: "veto-agree" });
        reshuffleIfNeeded(s, rng);
        failGovernment(s, rng);
      } else {
        s.phase = "chancellorEnact";
        s.vetoRefused = true;
        log(s, "info", `${actor.name} refused the veto. The Chancellor must enact a policy.`, { ev: "veto-refuse" });
      }
      return;
    }

    case "investigate": {
      const power = requirePower(s, isPresident, "investigate");
      if (power.targetId) fail("You have already investigated.");
      const target = requireTarget(s, "investigate", a.targetId);
      s.investigated.push(target.id);
      power.targetId = target.id;
      power.party = partyOf(target.role);
      (s.notes[actor.id] ??= []).push({
        round: s.round,
        kind: "investigation",
        targetId: target.id,
        party: power.party,
      });
      log(s, "power", `${actor.name} investigated ${target.name}'s Party Membership.`, { ev: "investigate" });
      return;
    }

    case "specialElection": {
      requirePower(s, isPresident, "special");
      const target = requireTarget(s, "special", a.targetId);
      log(s, "power", `${actor.name} called a Special Election: ${target.name} is the next Presidential Candidate.`, { ev: "special" });
      startNextRound(s, s.players.indexOf(target));
      return;
    }

    case "execute": {
      requirePower(s, isPresident, "execute");
      const target = requireTarget(s, "execute", a.targetId);
      if (target.role === "hitler") {
        log(s, "death", `${actor.name} executed ${target.name}.`, { ev: "execute" });
        target.alive = false;
        win(s, "liberal", "hitlerExecuted");
        return;
      }
      target.alive = false; // the table does NOT learn the executed player's role
      log(s, "death", `${actor.name} executed ${target.name}.`, { ev: "execute" });
      startNextRound(s);
      return;
    }

    case "ackPower": {
      const power = requirePower(s, isPresident, null);
      if (power.kind === "investigate" && !power.targetId) fail("Choose a player to investigate first.");
      if (power.kind === "special" || power.kind === "execute") fail("Choose a player first.");
      if (power.kind === "peek") {
        (s.notes[actor.id] ??= []).push({ round: s.round, kind: "peek", cards: s.deck.slice(0, 3) });
        log(s, "power", `${actor.name} looked at the top three policies.`, { ev: "peek" });
      }
      startNextRound(s);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Flow

const label = (p: Policy) => (p === "liberal" ? "Liberal" : "Fascist");
const names = (s: GameState, ids: string[]) => (ids.length ? ids.map((id) => playerById(s, id)!.name).join(", ") : "nobody");

function log(s: GameState, kind: LogKind, text: string, extra: { policy?: Policy; ev?: LogEvent } = {}): void {
  s.logSeq += 1;
  s.log.push({ n: s.logSeq, kind, text, ...extra });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function nextAlive(s: GameState, from: number): number {
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (s.players[i]!.alive) return i;
  }
  throw new Error("no living players");
}

/** Opens a new round's nomination. */
function beginRound(s: GameState): void {
  s.round += 1;
  s.phase = "nominate";
  s.chancellorId = null;
  s.votes = {};
  s.hand = [];
  s.power = null;
  s.vetoRefused = false;
  log(s, "info", `${presidentOf(s).name} is the Presidential Candidate.`, { ev: "round" });
}

/**
 * Passes the presidency on. Normally that is the next living player after the last
 * *rotation* president. After a Special Election the rotation anchor is untouched, so the
 * placard "returns to the left of the President who enacted the Special Election"
 * and that player may serve twice in a row.
 */
function startNextRound(s: GameState, specialElectionSeat?: number): void {
  if (specialElectionSeat !== undefined) {
    s.presidentIndex = specialElectionSeat;
  } else {
    s.anchor = nextAlive(s, s.anchor);
    s.presidentIndex = s.anchor;
  }
  beginRound(s);
}

function win(s: GameState, team: Party, reason: WinReason): void {
  s.winner = { team, reason };
  s.phase = "gameOver";
  s.power = null;
  s.hand = [];
  const text: Record<WinReason, string> = {
    liberalPolicies: "Five Liberal policies were enacted.",
    fascistPolicies: "Six Fascist policies were enacted.",
    hitlerElected: "Hitler was elected Chancellor.",
    hitlerExecuted: "Hitler was executed.",
  };
  log(s, "end", `${team === "liberal" ? "Liberals" : "Fascists"} win. ${text[reason]}`, { ev: "win" });
}

/** Rulebook: with fewer than three tiles left, shuffle the discard into the deck (never just stack it on top). */
function reshuffleIfNeeded(s: GameState, rng: Rng): void {
  if (s.deck.length >= 3) return;
  s.deck = shuffle([...s.deck, ...s.discard], rng);
  s.discard = [];
  log(s, "info", "The discard pile was shuffled back into the policy deck.", { ev: "reshuffle" });
}

/** Places a policy on its track, resets the Election Tracker and checks the policy win conditions. */
function enact(s: GameState, policy: Policy, text: string): void {
  if (policy === "liberal") s.liberalPolicies += 1;
  else s.fascistPolicies += 1;
  s.electionTracker = 0; // any policy played face-up resets it
  log(s, "policy", text, { policy, ev: "policy" });
  if (s.liberalPolicies >= LIBERAL_WIN) win(s, "liberal", "liberalPolicies");
  else if (s.fascistPolicies >= FASCIST_WIN) win(s, "fascist", "fascistPolicies");
}

/** After a successful Legislative Session: reshuffle if needed, then Executive Action or the next round. */
function endOfSession(s: GameState, enacted: Policy, rng: Rng): void {
  reshuffleIfNeeded(s, rng);
  const power = enacted === "fascist" ? powerTrack(s.players.length)[s.fascistPolicies - 1] : null;
  if (power) {
    s.phase = "executive";
    s.power = { kind: power };
    const what = {
      investigate: "Investigate Loyalty",
      special: "Call Special Election",
      peek: "Policy Peek",
      execute: "Execution",
    }[power];
    log(s, "power", `${presidentOf(s).name} must use a Presidential Power: ${what}.`, { ev: "power" });
  } else {
    startNextRound(s);
  }
}

function resolveVote(s: GameState, rng: Rng): void {
  const president = presidentOf(s);
  const chancellor = playerById(s, s.chancellorId)!;
  const voters = alivePlayers(s);
  const ja = voters.filter((p) => s.votes[p.id] === "ja").map((p) => p.id);
  const nein = voters.filter((p) => s.votes[p.id] === "nein").map((p) => p.id);
  const passed = ja.length > nein.length; // a tie fails
  s.lastVote = {
    id: s.round,
    presidentId: president.id,
    chancellorId: chancellor.id,
    votes: { ...s.votes },
    passed,
  };
  s.votes = {};
  log(s, "vote", `${passed ? "Elected" : "Rejected"} ${ja.length}–${nein.length}: ${president.name} and ${chancellor.name}. Ja!: ${names(s, ja)}. Nein: ${names(s, nein)}.`, { ev: passed ? "elected" : "rejected" });

  if (!passed) {
    failGovernment(s, rng);
    return;
  }

  s.lastElected = { presidentId: president.id, chancellorId: chancellor.id };
  if (s.fascistPolicies >= HITLER_ZONE) {
    if (chancellor.role === "hitler") {
      win(s, "fascist", "hitlerElected");
      return;
    }
    if (!s.confirmedNotHitler.includes(chancellor.id)) s.confirmedNotHitler.push(chancellor.id);
    log(s, "info", `${chancellor.name} is not Hitler.`, { ev: "not-hitler" });
  }
  s.hand = s.deck.splice(0, 3);
  s.phase = "presidentDiscard";
}

/** A government that never took office: vote failed, or a veto was agreed. */
function failGovernment(s: GameState, rng: Rng): void {
  s.electionTracker += 1;
  if (s.electionTracker < CHAOS_AT) {
    log(s, "info", `Election Tracker: ${s.electionTracker}.`, { ev: "tracker" });
    startNextRound(s);
    return;
  }
  // Chaos: reveal and enact the top policy, ignore its power, forget term limits.
  log(s, "info", "Three failed governments. The country is thrown into chaos.", { ev: "chaos" });
  reshuffleIfNeeded(s, rng);
  const top = s.deck.shift()!;
  s.lastElected = null;
  enact(s, top, `The people enacted a ${label(top)} policy.`);
  if (s.winner) return;
  reshuffleIfNeeded(s, rng);
  startNextRound(s);
}

function requirePower(s: GameState, isPresident: boolean, kind: PowerKind | null) {
  if (s.phase !== "executive" || !s.power) fail("There is no power to use.");
  if (!isPresident) fail("Only the President uses the power.");
  if (kind && s.power!.kind !== kind) fail("That is not the power you were granted.");
  return s.power!;
}

function requireTarget(s: GameState, kind: PowerKind, id: string): GamePlayer {
  const target = playerById(s, id);
  if (!target) return fail("Unknown player.");
  if (!powerTargets(s, kind).includes(id)) {
    if (target.id === presidentOf(s).id) return fail("Pick another player.");
    if (!target.alive) return fail(`${target.name} is already dead.`);
    if (kind === "investigate") return fail(`${target.name} has already been investigated.`);
    return fail("That player cannot be chosen.");
  }
  return target;
}

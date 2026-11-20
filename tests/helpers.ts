import {
  applyAction,
  createGame,
  presidentOf,
  seededRng,
  type Action,
  type GameState,
  type Policy,
  type Role,
} from "@/lib/game";

export const seatIds = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

export function newGame(n: number, seed = 1): GameState {
  return createGame(seatIds(n).map((id) => ({ id, name: id.toUpperCase() })), seededRng(seed));
}

export function act(s: GameState, action: Action, actor: string, seed = 99): GameState {
  const r = applyAction(s, action, actor, seededRng(seed));
  if (!r.ok) throw new Error(`${action.type} by ${actor} rejected: ${r.error}`);
  return r.value;
}

export function rejected(s: GameState, action: Action, actor: string): string {
  const r = applyAction(s, action, actor, seededRng(99));
  if (r.ok) throw new Error(`${action.type} by ${actor} was accepted but should have been rejected`);
  return r.error;
}

/** Everyone taps Ready, so the game is in the first nomination. */
export function started(n: number, seed = 1): GameState {
  let s = newGame(n, seed);
  for (const p of s.players) s = act(s, { type: "ready" }, p.id);
  return s;
}

/** Overwrite the secret roles in seat order. */
export function setRoles(s: GameState, roles: Role[]): GameState {
  const c = structuredClone(s);
  c.players.forEach((p, i) => (p.role = roles[i]!));
  return c;
}

/** Put `top` on top of the deck, keeping the 17 cards of the game conserved. */
export function rigDeck(s: GameState, top: Policy[]): GameState {
  const c = structuredClone(s);
  const pool = [...c.deck, ...c.discard, ...c.hand];
  for (const card of top) {
    const i = pool.indexOf(card);
    if (i < 0) throw new Error(`no ${card} card left to rig`);
    pool.splice(i, 1);
  }
  c.deck = [...top, ...pool];
  c.discard = [];
  c.hand = [];
  return c;
}

export const pres = (s: GameState) => presidentOf(s).id;

/** Nominate `chancellorId` and have every living player vote. `ja` lists who votes Ja!; the rest vote Nein. */
export function holdVote(s: GameState, chancellorId: string, ja: "all" | "none" | string[]): GameState {
  let g = act(s, { type: "nominate", chancellorId }, pres(s));
  for (const p of g.players.filter((x) => x.alive)) {
    const yes = ja === "all" || (Array.isArray(ja) && ja.includes(p.id));
    g = act(g, { type: "vote", vote: yes ? "ja" : "nein" }, p.id);
  }
  return g;
}

/** First eligible chancellor candidate for the current president (avoids Hitler unless forced). */
export function anyChancellor(s: GameState, allowHitler = false): string {
  const president = pres(s);
  const last = s.lastElected;
  const alive = s.players.filter((p) => p.alive);
  const eligible = alive.filter(
    (p) =>
      p.id !== president &&
      p.id !== last?.chancellorId &&
      !(alive.length > 5 && p.id === last?.presidentId),
  );
  const c = eligible.find((p) => allowHitler || p.role !== "hitler") ?? eligible[0];
  if (!c) throw new Error("no eligible chancellor");
  return c.id;
}

/**
 * Elect the next government and have it enact `policy` (the rigged top card).
 * Returns the state after the Chancellor's choice. The President discards the opposite
 * kind when possible so the requested policy gets enacted.
 */
export function enactViaGovernment(s: GameState, policy: Policy, chancellorId?: string): GameState {
  const other: Policy = policy === "fascist" ? "liberal" : "fascist";
  let g = rigDeck(s, [policy, policy, other]);
  g = holdVote(g, chancellorId ?? anyChancellor(g), "all");
  if (g.winner) return g;
  const president = pres(g);
  const chancellor = g.chancellorId!;
  g = act(g, { type: "presidentDiscard", index: g.hand.indexOf(other) }, president);
  // The Chancellor now holds two copies of `policy`; discarding either enacts the other.
  return act(g, { type: "chancellorDiscard", index: 0 }, chancellor);
}

/** Resolve a pending power with some valid default choice (for tests that don't care which). */
export function resolvePower(s: GameState, targetId?: string): GameState {
  if (s.phase !== "executive" || !s.power) return s;
  const president = pres(s);
  const alive = s.players.filter((p) => p.alive && p.id !== president && !s.investigated.includes(p.id));
  const t = targetId ?? alive.find((p) => p.role !== "hitler")?.id ?? alive[0]!.id;
  switch (s.power.kind) {
    case "peek":
      return act(s, { type: "ackPower" }, president);
    case "investigate":
      return act(act(s, { type: "investigate", targetId: t }, president), { type: "ackPower" }, president);
    case "special":
      return act(s, { type: "specialElection", targetId: t }, president);
    case "execute":
      return act(s, { type: "execute", targetId: t }, president);
  }
}

export function cardsInPlay(s: GameState): number {
  return s.deck.length + s.discard.length + s.hand.length + s.liberalPolicies + s.fascistPolicies;
}

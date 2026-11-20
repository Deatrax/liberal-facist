import type { PowerKind, Role } from "./types";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

/** Secret Roles by player count. `fascists` are the ordinary Fascists, Hitler is extra. */
export function roleCounts(players: number): { liberals: number; fascists: number } {
  const table: Record<number, { liberals: number; fascists: number }> = {
    5: { liberals: 3, fascists: 1 },
    6: { liberals: 4, fascists: 1 },
    7: { liberals: 4, fascists: 2 },
    8: { liberals: 5, fascists: 2 },
    9: { liberals: 5, fascists: 3 },
    10: { liberals: 6, fascists: 3 },
  };
  const row = table[players];
  if (!row) throw new Error(`Unsupported player count: ${players}`);
  return row;
}

export function roleList(players: number): Role[] {
  const { liberals, fascists } = roleCounts(players);
  return [
    ...Array<Role>(liberals).fill("liberal"),
    ...Array<Role>(fascists).fill("fascist"),
    "hitler",
  ];
}

export const LIBERAL_POLICIES = 6;
export const FASCIST_POLICIES = 11;
export const LIBERAL_WIN = 5;
export const FASCIST_WIN = 6;
export const VETO_UNLOCKS_AT = 5;
export const CHAOS_AT = 3;
/** Fascist policies that must be on the track before electing Hitler wins. */
export const HITLER_ZONE = 3;

/**
 * Fascist track by player count, as printed on the colorized board. Index 0 is the
 * first Fascist policy; index 5 (the skull) is the sixth, which simply wins.
 */
export function powerTrack(players: number): (PowerKind | null)[] {
  if (players <= 6) return [null, null, "peek", "execute", "execute", null];
  if (players <= 8) return [null, "investigate", "special", "execute", "execute", null];
  return ["investigate", "investigate", "special", "execute", "execute", null];
}

/** Does Hitler know who the Fascist is? Only in the small games (5–6 players). */
export function hitlerKnowsFascists(players: number): boolean {
  return players <= 6;
}

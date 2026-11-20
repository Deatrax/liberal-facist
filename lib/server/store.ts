// Storage interface for rooms. Two adapters: Upstash Redis (production) and an in-memory
// map (local dev with zero setup). The rest of the server only talks to `Store`.

import type { Room } from "@/lib/game";
import { MemoryStore } from "./memory-store";
import { RedisStore } from "./redis-store";

/** A room is deleted ~24 h after its last write. */
export const ROOM_TTL_SECONDS = 24 * 60 * 60;
/** Players who haven't polled for this long are shown dimmed. Nobody is ever auto-skipped. */
export const IDLE_AFTER_MS = 20_000;

export interface PollResult {
  version: number;
  /** Ids of players who haven't been seen for IDLE_AFTER_MS. */
  idle: string[];
}

export interface PresenceChange {
  add?: string[];
  remove?: string[];
}

export type SaveResult = "ok" | "conflict" | "missing";

export interface Store {
  /** Creates the room unless the code is taken. Returns false if taken. */
  create(room: Room): Promise<boolean>;
  /** The authoritative room document. */
  load(code: string): Promise<Room | null>;
  /**
   * Atomic compare-and-set: stores `next` only if the stored version is still `expected`,
   * then the stored version becomes expected + 1. Also refreshes the TTL.
   */
  save(code: string, expected: number, next: Room, presence?: PresenceChange): Promise<SaveResult>;
  /** Cheapest possible read: current version + who is idle. Records that `playerId` is here. */
  poll(code: string, playerId: string | null): Promise<PollResult | null>;
}

declare global {
  // Shared across route modules in `next dev`, where each route gets its own module instance.
  var __shStore: Store | undefined;
}

export function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function getStore(): Store {
  if (globalThis.__shStore) return globalThis.__shStore;
  const cfg = redisConfig();
  if (cfg) {
    globalThis.__shStore = new RedisStore(cfg.url, cfg.token);
  } else {
    if (process.env.VERCEL) {
      // Serverless instances don't share memory: an in-memory store would silently lose rooms.
      throw new Error(
        "Redis is not configured. Add the Upstash Redis integration (Vercel Marketplace) so UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN) are set.",
      );
    }
    console.warn("[secret-hitler] No Redis env vars found: using the in-memory store (dev only).");
    globalThis.__shStore = new MemoryStore();
  }
  return globalThis.__shStore;
}

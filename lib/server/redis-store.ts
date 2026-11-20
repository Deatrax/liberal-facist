// Upstash Redis adapter, talking to the REST API with plain fetch (no SDK needed).
//
// Keys per room (both expire ~24 h after the last write):
//   sh:room:CODE:s   string  the Room as JSON (single source of truth)
//   sh:room:CODE:m   hash    v = version, p:<playerId> = last-seen ms
//
// Command budget (the free tier counts commands): every operation below is exactly ONE
// Redis command, because each is an EVAL (or a GET). A client poll is one EVAL that
// returns the version and everyone's last-seen times. A per-instance micro-cache lets all
// polls for a room that land on the same serverless instance within POLL_CACHE_MS share
// a single call, which cuts the command count several-fold during a game.

import type { Room } from "@/lib/game";
import {
  IDLE_AFTER_MS,
  ROOM_TTL_SECONDS,
  type PollResult,
  type PresenceChange,
  type SaveResult,
  type Store,
} from "./store";

/** Polls served from memory for at most this long. Writes through this instance invalidate it at once. */
const POLL_CACHE_MS = 700;

const stateKey = (code: string) => `sh:room:${code}:s`;
const metaKey = (code: string) => `sh:room:${code}:m`;

// KEYS: state, meta. ARGV: json, version, ttl, hostId, now. Returns 1 if created, 0 if the code is taken.
const CREATE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('DEL', KEYS[2])
redis.call('HSET', KEYS[2], 'v', ARGV[2], 'p:' .. ARGV[4], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;

// KEYS: state, meta. ARGV: expectedVersion, json, ttl, now, then presence ops "a:<id>" / "r:<id>".
// Returns 1 (saved), 0 (version conflict) or -1 (room is gone). Atomic: nothing can interleave.
const SAVE = `
local cur = redis.call('HGET', KEYS[2], 'v')
if not cur then return -1 end
if tonumber(cur) ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('HSET', KEYS[2], 'v', tonumber(ARGV[1]) + 1)
for i = 5, #ARGV do
  local op = string.sub(ARGV[i], 1, 1)
  local id = string.sub(ARGV[i], 3)
  if op == 'a' then redis.call('HSET', KEYS[2], 'p:' .. id, ARGV[4]) else redis.call('HDEL', KEYS[2], 'p:' .. id) end
end
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;

// KEYS: meta. ARGV: field, value, field, value ... (presence updates, "p:<id>" -> ms).
// Only updates players that already exist, so random ids can't grow the hash. Returns the whole hash.
// No TTL refresh here: only real writes keep a room alive.
const POLL = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
for i = 1, #ARGV - 1, 2 do
  if redis.call('HEXISTS', KEYS[1], ARGV[i]) == 1 then redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
end
return redis.call('HGETALL', KEYS[1])`;

interface PollEntry {
  at: number;
  version: number;
  presence: Record<string, number>;
  missing: boolean;
  pending: Map<string, number>;
  inflight?: Promise<void>;
}

export class RedisStore implements Store {
  private polls = new Map<string, PollEntry>();

  constructor(
    private url: string,
    private token: string,
  ) {}

  private async command(cmd: (string | number)[]): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(cmd.map(String)),
          cache: "no-store",
        });
        const body = (await res.json()) as { result?: unknown; error?: string };
        if (!res.ok || body.error) throw new Error(`Redis: ${body.error ?? res.status}`);
        return body.result;
      } catch (e) {
        lastError = e;
        if (e instanceof Error && e.message.startsWith("Redis: ERR")) throw e; // a real command error: don't retry
      }
    }
    throw lastError;
  }

  async create(room: Room): Promise<boolean> {
    const r = await this.command([
      "EVAL", CREATE, 2, stateKey(room.code), metaKey(room.code),
      JSON.stringify(room), room.version, ROOM_TTL_SECONDS, room.hostId, Date.now(),
    ]);
    this.polls.delete(room.code); // drop any cached "no such room"
    return r === 1;
  }

  async load(code: string): Promise<Room | null> {
    const r = await this.command(["GET", stateKey(code)]);
    return typeof r === "string" ? (JSON.parse(r) as Room) : null;
  }

  async save(code: string, expected: number, next: Room, presence?: PresenceChange): Promise<SaveResult> {
    const ops = [
      ...(presence?.add ?? []).map((id) => `a:${id}`),
      ...(presence?.remove ?? []).map((id) => `r:${id}`),
    ];
    const r = await this.command([
      "EVAL", SAVE, 2, stateKey(code), metaKey(code),
      expected, JSON.stringify({ ...next, version: expected + 1 }), ROOM_TTL_SECONDS, Date.now(), ...ops,
    ]);
    this.polls.delete(code); // the next poll on this instance must see the new version
    if (r === 1) return "ok";
    return r === -1 ? "missing" : "conflict";
  }

  async poll(code: string, playerId: string | null): Promise<PollResult | null> {
    const now = Date.now();
    let e = this.polls.get(code);
    if (!e) {
      e = { at: 0, version: 0, presence: {}, missing: false, pending: new Map() };
      this.polls.set(code, e);
    }
    if (playerId) {
      e.pending.set(playerId, now);
      if (playerId in e.presence) e.presence[playerId] = now; // clear "idle" locally right away
    }
    if (now - e.at >= POLL_CACHE_MS) {
      const entry = e;
      entry.inflight ??= this.refresh(code, entry).finally(() => {
        entry.inflight = undefined;
      });
      await entry.inflight;
    }
    if (e.missing) return null;
    const t = Date.now();
    const idle = Object.entries(e.presence)
      .filter(([, seen]) => t - seen > IDLE_AFTER_MS)
      .map(([id]) => id);
    return { version: e.version, idle };
  }

  private async refresh(code: string, e: PollEntry): Promise<void> {
    const args: string[] = [];
    for (const [id, at] of e.pending) args.push(`p:${id}`, String(at));
    e.pending.clear();
    const r = await this.command(["EVAL", POLL, 1, metaKey(code), ...args]);
    e.at = Date.now();
    if (!Array.isArray(r)) {
      e.missing = true;
      return;
    }
    e.missing = false;
    const presence: Record<string, number> = {};
    for (let i = 0; i + 1 < r.length; i += 2) {
      const field = String(r[i]);
      const value = String(r[i + 1]);
      if (field === "v") e.version = Number(value);
      else if (field.startsWith("p:")) presence[field.slice(2)] = Number(value);
    }
    e.presence = presence;
    if (this.polls.size > 200) {
      for (const [k, v] of this.polls) if (Date.now() - v.at > 10 * 60_000) this.polls.delete(k);
    }
  }
}

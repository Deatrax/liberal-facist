import type { Room } from "@/lib/game";
import {
  IDLE_AFTER_MS,
  ROOM_TTL_SECONDS,
  type PollResult,
  type PresenceChange,
  type SaveResult,
  type Store,
} from "./store";

interface Entry {
  json: string;
  version: number;
  presence: Map<string, number>;
  expiresAt: number;
}

/** Single-process store for local development. Behaves like the Redis adapter (JSON round-trips, TTL, CAS). */
export class MemoryStore implements Store {
  private rooms = new Map<string, Entry>();

  private get(code: string): Entry | null {
    const e = this.rooms.get(code);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.rooms.delete(code);
      return null;
    }
    return e;
  }

  async create(room: Room): Promise<boolean> {
    if (this.get(room.code)) return false;
    this.rooms.set(room.code, {
      json: JSON.stringify(room),
      version: room.version,
      presence: new Map([[room.hostId, Date.now()]]),
      expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000,
    });
    return true;
  }

  async load(code: string): Promise<Room | null> {
    const e = this.get(code);
    return e ? (JSON.parse(e.json) as Room) : null;
  }

  async save(code: string, expected: number, next: Room, presence?: PresenceChange): Promise<SaveResult> {
    const e = this.get(code);
    if (!e) return "missing";
    if (e.version !== expected) return "conflict";
    e.version = expected + 1;
    e.json = JSON.stringify({ ...next, version: e.version });
    e.expiresAt = Date.now() + ROOM_TTL_SECONDS * 1000;
    for (const id of presence?.add ?? []) e.presence.set(id, Date.now());
    for (const id of presence?.remove ?? []) e.presence.delete(id);
    return "ok";
  }

  async poll(code: string, playerId: string | null): Promise<PollResult | null> {
    const e = this.get(code);
    if (!e) return null;
    const now = Date.now();
    if (playerId && e.presence.has(playerId)) e.presence.set(playerId, now);
    const idle = [...e.presence].filter(([, seen]) => now - seen > IDLE_AFTER_MS).map(([id]) => id);
    return { version: e.version, idle };
  }
}

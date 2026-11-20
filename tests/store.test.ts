// The same contract suite runs against the in-memory adapter and against the Redis adapter
// (talking to a real redis-server, so the Lua scripts are executed for real).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRoom, type Room } from "@/lib/game";
import { MemoryStore } from "@/lib/server/memory-store";
import { RedisStore } from "@/lib/server/redis-store";
import { ROOM_TTL_SECONDS, type Store } from "@/lib/server/store";
import { hasRedisServer, startRedis, type RedisHarness } from "./redis-shim";

let seq = 0;
const newRoom = (): Room => {
  const code = String.fromCharCode(65 + (seq % 20)) + String.fromCharCode(65 + ((seq / 20) | 0) % 20) + "AB";
  seq++;
  return createRoom(code, { id: "host", name: "Host", token: "t" }, 1);
};

function contract(name: string, make: () => Store | Promise<Store>, extra?: (get: () => Store) => void) {
  describe(`${name} store`, () => {
    let store: Store;
    beforeAll(async () => {
      store = await make();
    });

    it("create is exclusive per code, load round-trips", async () => {
      const room = newRoom();
      expect(await store.create(room)).toBe(true);
      expect(await store.create(room)).toBe(false);
      expect(await store.load(room.code)).toEqual(room);
      expect(await store.load("ZZZZ")).toBeNull();
    });

    it("save is compare-and-set on the version", async () => {
      const room = newRoom();
      await store.create(room);
      const changed = { ...room, gamesPlayed: 5 };
      expect(await store.save(room.code, 1, changed)).toBe("ok");
      const loaded = await store.load(room.code);
      expect(loaded?.gamesPlayed).toBe(5);
      expect(loaded?.version).toBe(2); // bumped by the store
      expect(await store.save(room.code, 1, { ...room, gamesPlayed: 9 })).toBe("conflict"); // stale writer
      expect((await store.load(room.code))?.gamesPlayed).toBe(5);
      expect(await store.save("ZZZY", 1, room)).toBe("missing");
    });

    it("exactly one of many simultaneous writers wins a given version", async () => {
      const room = newRoom();
      await store.create(room);
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) => store.save(room.code, 1, { ...room, gamesPlayed: i + 1 })),
      );
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results.filter((r) => r === "conflict")).toHaveLength(24);
      expect((await store.load(room.code))?.version).toBe(2);
    });

    it("poll reports the version and tracks presence only for seated players", async () => {
      const room = newRoom();
      await store.create(room);
      expect(await store.poll(room.code, "host")).toEqual({ version: 1, idle: [] });
      expect(await store.poll(room.code, "stranger")).toEqual({ version: 1, idle: [] }); // not recorded
      await store.save(room.code, 1, room, { add: ["guest"] });
      expect((await store.poll(room.code, "guest"))?.version).toBe(2); // sees the write immediately
      expect(await store.poll("ZZZX", null)).toBeNull();
    });

    extra?.(() => store);
  });
}

contract("in-memory", () => new MemoryStore());

describe.skipIf(!hasRedisServer)("redis store (real redis-server)", () => {
  let h: RedisHarness;
  let store: RedisStore;
  beforeAll(async () => {
    h = await startRedis();
    store = new RedisStore(h.url, h.token);
  });
  afterAll(async () => {
    await h.stop();
  });

  // Same contract, run lazily against the shared harness.
  contract("redis", () => store);

  it("keys expire ~24h after the last write, and refresh on every write", async () => {
    const room = newRoom();
    await store.create(room);
    const ttl = async (suffix: string) => Number(await h.resp.command(["TTL", `sh:room:${room.code}:${suffix}`]));
    for (const k of ["s", "m"]) {
      expect(await ttl(k)).toBeGreaterThan(ROOM_TTL_SECONDS - 10);
      expect(await ttl(k)).toBeLessThanOrEqual(ROOM_TTL_SECONDS);
    }
    await h.resp.command(["EXPIRE", `sh:room:${room.code}:s`, "100"]);
    await h.resp.command(["EXPIRE", `sh:room:${room.code}:m`, "100"]);
    await store.save(room.code, 1, room);
    expect(await ttl("s")).toBeGreaterThan(ROOM_TTL_SECONDS - 10);
    expect(await ttl("m")).toBeGreaterThan(ROOM_TTL_SECONDS - 10);
  });

  it("polling is not a write: it does not extend the TTL", async () => {
    const room = newRoom();
    await store.create(room);
    await h.resp.command(["EXPIRE", `sh:room:${room.code}:m`, "100"]);
    await store.poll(room.code, "host");
    expect(Number(await h.resp.command(["TTL", `sh:room:${room.code}:m`]))).toBeLessThanOrEqual(100);
  });

  it("idle players are reported after 20 s without a poll, and clear when they come back", async () => {
    const room = newRoom();
    await store.create(room);
    await store.save(room.code, 1, room, { add: ["guest"] });
    await h.resp.command(["HSET", `sh:room:${room.code}:m`, "p:guest", String(Date.now() - 30_000)]);
    const fresh = new RedisStore(h.url, h.token); // no cache
    expect((await fresh.poll(room.code, "host"))?.idle).toEqual(["guest"]);
    await new Promise((r) => setTimeout(r, 750)); // let the micro-cache lapse
    expect((await fresh.poll(room.code, "guest"))?.idle).toEqual([]);
    await new Promise((r) => setTimeout(r, 750));
    expect((await fresh.poll(room.code, "host"))?.idle).toEqual([]); // guest's poll was flushed to Redis
  });

  it("removed players disappear from presence", async () => {
    const room = newRoom();
    await store.create(room);
    await store.save(room.code, 1, room, { add: ["guest"] });
    await store.save(room.code, 2, room, { remove: ["guest"] });
    expect(await h.resp.command(["HEXISTS", `sh:room:${room.code}:m`, "p:guest"])).toBe(0);
  });

  it("many simultaneous polls on one instance cost ONE redis command (micro-cache)", async () => {
    const room = newRoom();
    await store.create(room);
    await store.poll(room.code, "host"); // warm
    await new Promise((r) => setTimeout(r, 750)); // cache lapses
    h.commands.length = 0;
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => store.poll(room.code, i % 2 ? "host" : null)));
    expect(results.every((r) => r?.version === 1)).toBe(true);
    expect(h.commands.filter((c) => c[0] === "EVAL")).toHaveLength(1);
    // And a burst right afterwards is free.
    h.commands.length = 0;
    for (let i = 0; i < 20; i++) await store.poll(room.code, "host");
    expect(h.commands).toHaveLength(0);
  });

  it("every operation is a single command", async () => {
    const room = newRoom();
    h.commands.length = 0;
    await store.create(room);
    expect(h.commands).toHaveLength(1);
    h.commands.length = 0;
    await store.load(room.code);
    expect(h.commands).toHaveLength(1);
    h.commands.length = 0;
    await store.save(room.code, 1, room, { add: ["a", "b"] });
    expect(h.commands).toHaveLength(1);
  });

  it("a missing room reads as null / missing / 404", async () => {
    const other = new RedisStore(h.url, h.token);
    expect(await other.load("QQQQ")).toBeNull();
    expect(await other.poll("QQQQ", "x")).toBeNull();
    expect(await other.save("QQQQ", 1, newRoom())).toBe("missing");
  });
});

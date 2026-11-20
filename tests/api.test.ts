// End-to-end through the real route handlers (no HTTP server needed): create a room, join,
// start, and play complete games with every player acting through the API, including
// simultaneous actions that race for the same room version.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededRng, type RoomView } from "@/lib/game";
import { POST as createRoute } from "@/app/api/room/route";
import { POST as joinRoute } from "@/app/api/room/[code]/join/route";
import { GET as stateRoute } from "@/app/api/room/[code]/state/route";
import { POST as actionRoute } from "@/app/api/room/[code]/action/route";
import { GET as versionRoute } from "@/app/api/room/[code]/version/route";
import { botAction } from "./bot";
import { hasRedisServer, startRedis, type RedisHarness } from "./redis-shim";

interface Seat {
  name: string;
  playerId: string;
  token: string;
}

const call = async (
  handler: (req: Request, ctx: { params: Promise<{ code: string }> }) => Promise<Response>,
  code: string,
  opts: { method?: string; body?: unknown; seat?: { playerId: string; token: string }; query?: string; raw?: string } = {},
) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.seat) {
    headers["x-player-id"] = opts.seat.playerId;
    headers["x-player-token"] = opts.seat.token;
  }
  const res = await handler(
    new Request(`http://localhost/api/room/${code}${opts.query ?? ""}`, {
      method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"),
      headers,
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    }),
    { params: Promise.resolve({ code }) },
  );
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
};

async function newRoom(hostName: string, extra: string[]) {
  const created = await createRoute(
    new Request("http://localhost/api/room", { method: "POST", body: JSON.stringify({ name: hostName }) }),
  );
  const c = (await created.json()) as { code: string; playerId: string; token: string };
  const seats: Seat[] = [{ name: hostName, playerId: c.playerId, token: c.token }];
  for (const name of extra) {
    const r = await call(joinRoute, c.code, { body: { name } });
    expect(r.status).toBe(200);
    seats.push({ name, playerId: r.body.playerId, token: r.body.token });
  }
  return { code: c.code, seats };
}

const stateOf = async (code: string, s: Seat): Promise<RoomView> => {
  const r = await call(stateRoute, code, { seat: s });
  expect(r.status).toBe(200);
  return r.body as RoomView;
};

function scenarios(label: string, useRedis: () => RedisHarness | null) {
  describe(`API (${label})`, () => {
    beforeAll(() => {
      globalThis.__shStore = undefined;
      const h = useRedis();
      if (h) {
        process.env.UPSTASH_REDIS_REST_URL = h.url;
        process.env.UPSTASH_REDIS_REST_TOKEN = h.token;
      } else {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        delete process.env.KV_REST_API_URL;
        delete process.env.KV_REST_API_TOKEN;
      }
    });

    it("lobby rules over HTTP: codes, names, auth, host-only controls", async () => {
      const { code, seats } = await newRoom("Host", ["Ann", "Bo", "Cy"]);
      expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
      const [host, ann] = [seats[0]!, seats[1]!];

      // Names are unique; bad credentials are refused; unknown rooms 404.
      expect((await call(joinRoute, code, { body: { name: "ann" } })).status).toBe(409);
      expect((await call(joinRoute, code, { body: { name: "   " } })).status).toBe(400);
      expect((await call(stateRoute, code, { seat: { playerId: ann.playerId, token: "wrong" } })).status).toBe(401);
      expect((await call(stateRoute, code, { seat: { playerId: "nobody", token: ann.token } })).status).toBe(401);
      expect((await call(stateRoute, "AAAA", { seat: host })).status).toBe(404);
      expect((await call(stateRoute, "abc!", { seat: host })).status).toBe(404);
      expect((await call(actionRoute, code, { seat: host, raw: "{not json" })).status).toBe(400);
      expect((await call(actionRoute, code, { seat: host, body: { type: "hack" } })).status).toBe(400);

      // Lowercase codes work (people type them).
      expect((await call(stateRoute, code.toLowerCase(), { seat: host })).status).toBe(200);

      // Only the host starts, and not with fewer than 5.
      expect((await call(actionRoute, code, { seat: ann, body: { type: "start" } })).status).toBe(422);
      expect((await call(actionRoute, code, { seat: host, body: { type: "start" } })).body.error).toMatch(/at least 5/);

      // Fifth player, then a kick and a re-join.
      const joined = await call(joinRoute, code, { body: { name: "Di" } });
      const di = { name: "Di", playerId: joined.body.playerId, token: joined.body.token };
      const kick = await call(actionRoute, code, { seat: host, body: { type: "kick", playerId: di.playerId } });
      expect(kick.status).toBe(200);
      expect((await call(stateRoute, code, { seat: di })).status).toBe(401); // removed players are locked out
      const again = await call(joinRoute, code, { body: { name: "Di" } });
      expect(again.status).toBe(200);

      const v = (await call(stateRoute, code, { seat: host })).body as RoomView;
      expect(v.seats.map((s) => s.name)).toEqual(["Host", "Ann", "Bo", "Cy", "Di"]);
      expect(v.me.isHost).toBe(true);
      expect(JSON.stringify(v)).not.toContain(host.token);

      // Start; nobody can join after.
      const start = await call(actionRoute, code, { seat: host, body: { type: "start" } });
      expect(start.status).toBe(200);
      expect(start.body.view.game.phase).toBe("roleReveal");
      expect((await call(joinRoute, code, { body: { name: "Late" } })).status).toBe(409);
    });

    it("version poll: cheap, bumps on every write, no auth needed, not cacheable", async () => {
      const { code, seats } = await newRoom("Host", ["A", "B", "C", "D"]);
      const v1 = await call(versionRoute, code, { query: `?p=${seats[0]!.playerId}` });
      expect(v1.status).toBe(200);
      expect(Object.keys(v1.body).sort()).toEqual(["idle", "v"]);
      expect(v1.headers.get("cache-control")).toBe("no-store");
      await call(actionRoute, code, { seat: seats[0]!, body: { type: "start" } });
      await new Promise((r) => setTimeout(r, 750)); // past the poll micro-cache (Redis variant)
      const v2 = await call(versionRoute, code, {});
      expect(v2.body.v).toBeGreaterThan(v1.body.v);
      expect((await call(versionRoute, "QQQQ", {})).status).toBe(404);
    });

    for (const n of [5, 8, 10]) {
      it(`plays a complete ${n}-player game with simultaneous actions`, async () => {
        const names = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal", "Ivy"].slice(0, n - 1);
        const { code, seats } = await newRoom("Host", names);
        const rng = seededRng(n * 31);
        expect((await call(actionRoute, code, { seat: seats[0]!, body: { type: "start" } })).status).toBe(200);

        let rounds = 0;
        let lastVersion = 0;
        for (;;) {
          if (++rounds > 1500) throw new Error("game did not finish");
          const views = await Promise.all(seats.map((s) => stateOf(code, s)));
          const game = views[0]!.game!;
          // Versions never go backwards and every player sees the same one.
          expect(new Set(views.map((v) => v.version)).size).toBe(1);
          expect(views[0]!.version).toBeGreaterThanOrEqual(lastVersion);
          lastVersion = views[0]!.version;
          // No secrets in anyone's payload.
          for (const v of views) {
            const text = JSON.stringify(v);
            for (const s of seats) expect(text).not.toContain(s.token);
            expect(text).not.toContain('"deck"');
            if (v.game!.phase !== "gameOver") expect(v.game!.players.every((p) => p.role === null)).toBe(true);
          }
          if (game.phase === "gameOver") {
            expect(views.every((v) => v.game!.players.every((p) => p.role !== null))).toBe(true);
            expect(game.winner).not.toBeNull();
            break;
          }
          // Everyone who has something to do does it AT THE SAME TIME.
          const acting = views.map((v, i) => ({ v, seat: seats[i]! })).filter(({ v }) => v.game!.prompt);
          const results = await Promise.all(
            acting.map(({ v, seat }) => call(actionRoute, code, { seat, body: botAction(v.game!, rng) })),
          );
          for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
        }

        // Host can start a rematch with the same room and players.
        const again = await call(actionRoute, code, { seat: seats[0]!, body: { type: "playAgain" } });
        expect(again.status).toBe(200);
        expect(again.body.view.game.phase).toBe("roleReveal");
        expect(again.body.view.game.round).toBe(0);
        expect(again.body.view.seats).toHaveLength(n);
      }, 60_000);
    }

    it("all voters voting in the same instant are all counted (compare-and-set + retry)", async () => {
      const { code, seats } = await newRoom("Host", ["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
      await call(actionRoute, code, { seat: seats[0]!, body: { type: "start" } });
      await Promise.all(seats.map((s) => call(actionRoute, code, { seat: s, body: { type: "ready" } })));
      let views = await Promise.all(seats.map((s) => stateOf(code, s)));
      expect(views[0]!.game!.phase).toBe("nominate");
      const pi = seats.findIndex((_, i) => views[i]!.game!.prompt?.kind === "nominate");
      const targets = (views[pi]!.game!.prompt as { targets: string[] }).targets;
      expect((await call(actionRoute, code, { seat: seats[pi]!, body: { type: "nominate", chancellorId: targets[0] } })).status).toBe(200);

      const votes = await Promise.all(
        seats.map((s, i) => call(actionRoute, code, { seat: s, body: { type: "vote", vote: i % 2 ? "ja" : "nein" } })),
      );
      expect(votes.map((v) => v.status)).toEqual(Array(10).fill(200));
      views = await Promise.all(seats.map((s) => stateOf(code, s)));
      const lastVote = views[0]!.game!.lastVote!;
      expect(Object.keys(lastVote.votes)).toHaveLength(10); // nobody's ballot was lost
      expect(lastVote.passed).toBe(false); // 5 Ja!, 5 Nein: a tie fails
      // Double voting is refused.
      expect((await call(actionRoute, code, { seat: seats[1]!, body: { type: "vote", vote: "ja" } })).status).toBe(422);
    });

    it("rules are enforced server-side: wrong player, wrong phase", async () => {
      const { code, seats } = await newRoom("Host", ["A", "B", "C", "D"]);
      await call(actionRoute, code, { seat: seats[0]!, body: { type: "start" } });
      await Promise.all(seats.map((s) => call(actionRoute, code, { seat: s, body: { type: "ready" } })));
      const views = await Promise.all(seats.map((s) => stateOf(code, s)));
      const pi = views.findIndex((v) => v.game!.prompt?.kind === "nominate");
      const other = (pi + 1) % 5;
      const target = seats[other]!;
      const targetId = views[pi]!.seats[other]!.id;
      expect((await call(actionRoute, code, { seat: seats[other]!, body: { type: "nominate", chancellorId: seats[pi]!.playerId } })).status).toBe(422);
      expect((await call(actionRoute, code, { seat: target, body: { type: "vote", vote: "ja" } })).status).toBe(422);
      expect((await call(actionRoute, code, { seat: seats[pi]!, body: { type: "nominate", chancellorId: targetId } })).status).toBe(200);
      // Host-only controls are refused for others.
      expect((await call(actionRoute, code, { seat: seats[1]!, body: { type: "endGame" } })).status).toBe(422);
      const end = await call(actionRoute, code, { seat: seats[0]!, body: { type: "endGame" } });
      expect(end.status).toBe(200);
      expect(end.body.view.game).toBeNull();
    });
  });
}

scenarios("in-memory store", () => null);

describe.skipIf(!hasRedisServer)("API over real Redis", () => {
  let h: RedisHarness;
  beforeAll(async () => {
    h = await startRedis();
  });
  afterAll(async () => {
    await h.stop();
  });
  scenarios("Redis store", () => h);
});

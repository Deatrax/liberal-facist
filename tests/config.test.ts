import { afterEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/room/route";
import { GET as stateRoute } from "@/app/api/room/[code]/state/route";
import { getStore, redisConfig } from "@/lib/server/store";

const KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "VERCEL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  globalThis.__shStore = undefined;
});

describe("configuration", () => {
  it("accepts both env var spellings (Upstash and Vercel KV style)", () => {
    for (const k of KEYS) delete process.env[k];
    expect(redisConfig()).toBeNull();
    process.env.UPSTASH_REDIS_REST_URL = "https://a.upstash.io/";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok-a";
    expect(redisConfig()).toEqual({ url: "https://a.upstash.io", token: "tok-a" });
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL = "https://b.upstash.io";
    process.env.KV_REST_API_TOKEN = "tok-b";
    expect(redisConfig()).toEqual({ url: "https://b.upstash.io", token: "tok-b" });
  });

  it("falls back to memory locally but refuses to on Vercel, and says why in the response", async () => {
    for (const k of KEYS) delete process.env[k];
    globalThis.__shStore = undefined;
    expect(getStore().constructor.name).toBe("MemoryStore");

    globalThis.__shStore = undefined;
    process.env.VERCEL = "1";
    const res = await createRoute(new Request("http://x/api/room", { method: "POST", body: JSON.stringify({ name: "Ann" }) }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/Redis is not configured.*UPSTASH_REDIS_REST_URL/);
    const res2 = await stateRoute(new Request("http://x/api/room/ABCD/state"), { params: Promise.resolve({ code: "ABCD" }) });
    expect(((await res2.json()) as { error: string }).error).toMatch(/Redis is not configured/);
  });
});

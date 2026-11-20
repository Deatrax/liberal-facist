import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getGameView, type LogEntry } from "@/lib/game";
import {
  CUES,
  CUE_GAIN,
  STINGERS,
  TRACKS,
  crossedIntoHitlerZone,
  newEntries,
  planEvents,
  promptKey,
  shouldRingTurn,
  trackFor,
} from "@/lib/client/audio-cues";
import { act, anyChancellor, enactViaGovernment, holdVote, newGame, pres, setRoles, started } from "./helpers";

const AUDIO = path.resolve(__dirname, "../public/audio");
const entry = (n: number, ev: LogEntry["ev"], extra: Partial<LogEntry> = {}): LogEntry => ({ n, kind: "info", text: "x", ev, ...extra });
const names = (r: ReturnType<typeof planEvents>) => r.cues.map((c) => c.cue);

describe("audio files", () => {
  it("every cue, music bed and stinger the code references exists, and the whole set stays small", () => {
    const files = readdirSync(AUDIO);
    for (const c of CUES) expect(files, `sfx-${c}.mp3`).toContain(`sfx-${c}.mp3`);
    for (const t of TRACKS) expect(files, `music-${t}.mp3`).toContain(`music-${t}.mp3`);
    for (const s of STINGERS) expect(files, `stinger-${s}.mp3`).toContain(`stinger-${s}.mp3`);
    const total = files.reduce((n, f) => n + statSync(path.join(AUDIO, f)).size, 0);
    expect(total).toBeLessThan(10 * 1024 * 1024);
    for (const c of CUES) expect(CUE_GAIN[c], c).toBeGreaterThan(0);
  });

  it("every attribution-required source is credited, and every source has a license and a page", () => {
    const sources = JSON.parse(readFileSync(path.resolve(__dirname, "../data/audio-sources.json"), "utf8")) as {
      key: string; author: string; license: string; licenseUrl: string; page: string; attribution: boolean;
    }[];
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.author).toBeTruthy();
      expect(s.license).toMatch(/^(CC0 1\.0|CC BY (3|4)\.0)$/); // only CC0 / CC BY: compatible with this project's BY-NC-SA 4.0
      expect(s.page).toMatch(/^https:\/\/opengameart\.org\/content\//);
    }
    const readme = readFileSync(path.resolve(__dirname, "../README.md"), "utf8");
    for (const s of sources.filter((x) => x.attribution)) expect(readme, `README credits ${s.author}`).toContain(s.author.split(" (")[0]!);
    expect(existsSync(path.resolve(__dirname, "../scripts/build-audio.py"))).toBe(true);
  });
});

describe("planning cues from public events", () => {
  it("a vote reveal is the ballot flurry, then the verdict", () => {
    const passed = planEvents([entry(1, "elected")]);
    expect(names(passed)).toEqual(["reveal", "elected"]);
    expect(passed.cues[1]!.at).toBeGreaterThan(passed.cues[0]!.at);
    expect(names(planEvents([entry(1, "rejected")]))).toEqual(["reveal", "rejected"]);
  });

  it("a policy sounds Liberal or Fascist", () => {
    expect(names(planEvents([entry(1, "policy", { policy: "liberal" })]))).toEqual(["policy-liberal"]);
    expect(names(planEvents([entry(1, "policy", { policy: "fascist" })]))).toEqual(["policy-fascist"]);
  });

  it("chaos arrives as one batch (reject, chaos, policy) and is spaced out in order", () => {
    const plan = planEvents([entry(1, "rejected"), entry(2, "chaos"), entry(3, "policy", { policy: "fascist" })]);
    expect(names(plan)).toEqual(["reveal", "rejected", "chaos", "policy-fascist"]);
    const times = plan.cues.map((c) => c.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(plan.cues.at(-1)!.at).toBeGreaterThan(plan.cues[2]!.at + 1); // the policy waits for the chaos to land
  });

  it("powers and executions have their own cues; the dead are announced by a shot", () => {
    expect(names(planEvents([entry(1, "investigate")]))).toEqual(["investigate"]);
    expect(names(planEvents([entry(1, "special")]))).toEqual(["special"]);
    expect(names(planEvents([entry(1, "peek")]))).toEqual(["peek"]);
    expect(names(planEvents([entry(1, "execute")]))).toEqual(["shot"]);
    expect(names(planEvents([entry(1, "veto-ask")]))).toEqual(["veto"]);
  });

  it("the end of the game yields a stinger for the winning side, after any cue that ended it", () => {
    const hitler = planEvents([entry(1, "execute"), entry(2, "win", { kind: "end", text: "Liberals win. Hitler was executed." })]);
    expect(names(hitler)).toEqual(["shot"]);
    expect(hitler.stinger?.kind).toBe("liberal");
    expect(hitler.stinger!.at).toBeGreaterThan(hitler.cues[0]!.at);
    expect(planEvents([entry(1, "win", { kind: "end", text: "Fascists win. Six Fascist policies were enacted." })]).stinger?.kind).toBe("fascist");
  });

  it("events with no sound (rounds, nominations) stay silent, and history is never replayed", () => {
    expect(planEvents([entry(1, "round"), entry(2, "nominate"), entry(3, "power")]).cues).toEqual([]);
    const log = [entry(1, "start"), entry(2, "elected"), entry(3, "policy", { policy: "liberal" })];
    expect(newEntries(log, 3)).toEqual([]);
    expect(newEntries(log, 1).map((e) => e.n)).toEqual([2, 3]);
  });
});

describe("planning from a real game", () => {
  it("the engine's own log produces the right sounds for a played round", () => {
    let g = started(7, 20);
    g = setRoles(g, ["liberal", "liberal", "liberal", "liberal", "fascist", "fascist", "hitler"]);
    const before = g.logSeq;
    g = enactViaGovernment(g, "fascist");
    const plan = planEvents(g.log.filter((l) => l.n > before));
    expect(names(plan)).toEqual(["reveal", "elected", "policy-fascist"]);
  });

  it("three failed governments sound like chaos then a policy", () => {
    let g = started(7, 21);
    const before = g.logSeq;
    for (let i = 0; i < 3; i++) g = holdVote(g, anyChancellor(g), "none");
    const plan = planEvents(g.log.filter((l) => l.n > before));
    // Two failed votes tick the tracker; the third tips it into chaos, which enacts a policy.
    expect(names(plan)).toEqual([
      "reveal", "rejected", "tracker", "reveal", "rejected", "tracker", "reveal", "rejected", "chaos", expect.stringMatching(/^policy-/),
    ]);
  });

  it("executing Hitler plays the shot and then the Liberal stinger", () => {
    let g = setRoles(started(7, 60), ["hitler", ...Array(6).fill("liberal")]);
    for (let i = 0; i < 3; i++) {
      g = enactViaGovernment(g, "fascist");
      if (g.phase === "executive") {
        const t = g.players.find((p) => p.alive && p.id !== pres(g) && p.role === "liberal" && !g.investigated.includes(p.id))!.id;
        const kind = g.power!.kind;
        g = act(g, kind === "investigate" ? { type: "investigate", targetId: t } : kind === "special" ? { type: "specialElection", targetId: t } : { type: "ackPower" }, pres(g));
        if (g.phase === "executive") g = act(g, { type: "ackPower" }, pres(g));
      }
    }
    g = enactViaGovernment(g, "fascist");
    const before = g.logSeq;
    g = act(g, { type: "execute", targetId: "p0" }, pres(g));
    const plan = planEvents(g.log.filter((l) => l.n > before));
    expect(names(plan)).toEqual(["shot"]);
    expect(plan.stinger?.kind).toBe("liberal");
  });
});

describe("music and the turn bell", () => {
  const view = (g: ReturnType<typeof newGame>, id = "p0") => getGameView(g, id, "p0");

  it("lobby bed outside a game, suspense in play, paranoia in the Hitler zone, lobby bed again at the end", () => {
    expect(trackFor(null)).toBe("lobby");
    const g = started(5, 3);
    expect(trackFor(view(g))).toBe("suspense");
    expect(trackFor(view({ ...g, fascistPolicies: 2 }))).toBe("suspense");
    expect(trackFor(view({ ...g, fascistPolicies: 3 }))).toBe("paranoia");
    expect(trackFor(view({ ...g, fascistPolicies: 5 }))).toBe("paranoia");
    expect(trackFor(view({ ...g, phase: "gameOver" }))).toBe("lobby");
  });

  it("the Hitler zone swell fires only when the third Fascist policy lands", () => {
    expect(crossedIntoHitlerZone(2, 3)).toBe(true);
    expect(crossedIntoHitlerZone(3, 4)).toBe(false);
    expect(crossedIntoHitlerZone(0, 1)).toBe(false);
  });

  it("it rings once per prompt, never for Ready", () => {
    const g = started(5, 3);
    const p = pres(g);
    const mine = view(g, p);
    expect(mine.prompt?.kind).toBe("nominate");
    expect(shouldRingTurn(null, mine)).toBe(true);
    expect(shouldRingTurn(promptKey(mine), mine)).toBe(false); // the next poll of the same prompt is silent
    const other = view(g, g.players.find((x) => x.id !== p)!.id);
    expect(shouldRingTurn(null, other)).toBe(false); // nothing to do
    expect(shouldRingTurn(null, view(newGame(5, 3)))).toBe(false); // the deal's "Ready" prompt
  });
});

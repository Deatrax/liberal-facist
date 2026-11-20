import type { Action, GameView, Rng } from "@/lib/game";

/** A random player that acts only on what its own view says it may do (like a real client). */
export function botAction(v: GameView, rng: Rng): Action {
  const p = v.prompt!;
  const pick = <T>(a: T[]) => a[rng(a.length)]!;
  switch (p.kind) {
    case "ready":
      return { type: "ready" };
    case "nominate":
      return { type: "nominate", chancellorId: pick(p.targets) };
    case "vote":
      return { type: "vote", vote: rng(100) < 65 ? "ja" : "nein" };
    case "discard":
      return { type: "presidentDiscard", index: rng(p.hand.length) };
    case "enact":
      return p.canVeto && rng(100) < 40 ? { type: "requestVeto" } : { type: "chancellorDiscard", index: rng(p.hand.length) };
    case "vetoDecision":
      return { type: "vetoResponse", agree: rng(2) === 0 };
    case "investigate":
      return p.result ? { type: "ackPower" } : { type: "investigate", targetId: pick(p.targets) };
    case "special":
      return { type: "specialElection", targetId: pick(p.targets) };
    case "execute":
      return { type: "execute", targetId: pick(p.targets) };
    case "peek":
      return { type: "ackPower" };
  }
}

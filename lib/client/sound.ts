// Optional, off by default. Tiny synthesised blips (no audio files): one for the vote reveal,
// one for an enacted policy.

let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem("sh:sound") === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem("sh:sound", on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function tone(freq: number, start: number, length: number, type: OscillatorType, gain = 0.06) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
}

export function playSound(kind: "reveal" | "policy-liberal" | "policy-fascist"): void {
  if (!soundEnabled()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (kind === "reveal") {
      tone(440, 0, 0.12, "triangle");
      tone(587, 0.09, 0.16, "triangle");
    } else if (kind === "policy-liberal") {
      tone(523, 0, 0.14, "sine");
      tone(784, 0.1, 0.22, "sine");
    } else {
      tone(196, 0, 0.18, "sawtooth", 0.035);
      tone(147, 0.12, 0.26, "sawtooth", 0.035);
    }
  } catch {
    /* audio blocked: ignore */
  }
}

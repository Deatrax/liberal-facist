// The browser side of the sound: music beds that crossfade with the state of the game, short cues,
// and victory stingers that duck the music. Off by default; the player turns Music and Effects on
// in the menu (browsers also require a tap before any sound may play).
//
// Graph:   cue buffers ──► sfx ───────────────┐
//          <audio> voices ► music ► (ducking) ┼► master ► compressor ► speakers
//          stinger buffer ───────────────────┘
//
// Music is STREAMED through <audio> elements (routed into Web Audio for fades) instead of decoded:
// the 5-minute suspense bed would be ~110 MB of PCM, which kills mobile tabs. A loop is a crossfade
// between two voices, so it is seamless whatever the MP3 encoder padding does.

import { useSyncExternalStore } from "react";
import { CUE_GAIN, type Cue, type Plan, type Stinger, type Track } from "./audio-cues";

export interface AudioSettings {
  music: boolean;
  effects: boolean;
  /** Master volume, 0–1. */
  volume: number;
}

const DEFAULTS: AudioSettings = { music: false, effects: false, volume: 0.7 };
const MUSIC_LEVEL = 0.5; // beds sit well under the cues (people are on voice chat too)
const STINGER_LEVEL = 0.9;
const DUCK_TO = 0.18;
const TRACK_FADE = 2.5; // seconds
const LOOP_FADE = 2.5;
const VOICES = 3; // current, the one fading in for the loop/track change, the one fading out

const KEY = { music: "sh:music", effects: "sh:effects", volume: "sh:volume" } as const;

function loadSettings(): AudioSettings {
  try {
    const v = Number(window.localStorage.getItem(KEY.volume));
    return {
      music: window.localStorage.getItem(KEY.music) === "on",
      effects: window.localStorage.getItem(KEY.effects) === "on",
      volume: window.localStorage.getItem(KEY.volume) !== null && v >= 0 && v <= 1 ? v : DEFAULTS.volume,
    };
  } catch {
    return DEFAULTS;
  }
}

class Voice {
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
  track: Track | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.el = new Audio();
    this.el.preload = "auto";
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(this.el).connect(this.gain).connect(out);
  }

  private freeAt = 0;

  /** In use, or still fading out (so a fade is never cut short by reusing the voice). */
  get busy(): boolean {
    return this.track !== null || this.ctx.currentTime < this.freeAt;
  }
  get remaining(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration - this.el.currentTime : Infinity;
  }

  /** Starts `track` from the beginning, fading in. Resolves false if the browser blocked playback. */
  async start(track: Track, fadeIn: number): Promise<boolean> {
    clearTimeout(this.stopTimer);
    this.track = track;
    this.el.src = `/audio/music-${track}.mp3`;
    this.el.currentTime = 0;
    const g = this.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(0, this.ctx.currentTime);
    g.linearRampToValueAtTime(1, this.ctx.currentTime + fadeIn);
    try {
      await this.el.play();
      return true;
    } catch {
      this.track = null;
      return false;
    }
  }

  fadeOutAndStop(seconds: number): void {
    const g = this.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(0, this.ctx.currentTime + seconds);
    this.track = null;
    this.freeAt = this.ctx.currentTime + seconds + 0.2;
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => this.el.pause(), seconds * 1000 + 100);
  }

  pause(): void {
    this.el.pause();
  }
  resume(): void {
    if (this.track) void this.el.play().catch(() => undefined);
  }
}

class AudioEngine {
  private settings: AudioSettings = DEFAULTS;
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices: Voice[] = [];
  private current: Voice | null = null;
  private desired: Track | null = null;
  private loopTimer: ReturnType<typeof setInterval> | undefined;
  private hidden = false;
  private booted = false;

  // ---- settings ----------------------------------------------------------------------------
  getSettings = (): AudioSettings => this.settings;
  getServerSettings = (): AudioSettings => DEFAULTS;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Call once on the client: loads saved settings and installs the tap-to-unlock and tab-visibility hooks. */
  boot(): void {
    if (this.booted || typeof window === "undefined") return;
    this.booted = true;
    this.settings = loadSettings();
    this.emit();
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", () => this.onVisibility());
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private save<K extends keyof AudioSettings>(k: K, v: AudioSettings[K]) {
    this.settings = { ...this.settings, [k]: v };
    try {
      window.localStorage.setItem(KEY[k], typeof v === "boolean" ? (v ? "on" : "off") : String(v));
    } catch {
      /* storage unavailable: the setting just won't persist */
    }
    this.emit();
  }

  setMusic(on: boolean): void {
    this.save("music", on);
    if (on) {
      this.unlock();
      void this.applyTrack();
    } else {
      this.stopMusic(0.8);
    }
  }
  setEffects(on: boolean): void {
    this.save("effects", on);
    if (on) {
      this.unlock();
      void this.preloadCues();
    }
  }
  setVolume(v: number): void {
    this.save("volume", Math.min(1, Math.max(0, v)));
    if (this.ctx) this.master.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.05);
  }

  // ---- context -----------------------------------------------------------------------------
  /** Creates / resumes the AudioContext. Must run inside a user gesture the first time. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor(); // a safety net when cues land on top of music
      comp.threshold.value = -8;
      comp.knee.value = 8;
      comp.ratio.value = 10;
      this.master = ctx.createGain();
      this.master.gain.value = this.settings.volume;
      this.sfx = ctx.createGain();
      this.music = ctx.createGain();
      this.music.gain.value = MUSIC_LEVEL;
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(comp).connect(ctx.destination);
      this.voices = Array.from({ length: VOICES }, () => new Voice(ctx, this.music));
    }
    if (this.ctx.state === "suspended" && !this.hidden) void this.ctx.resume();
    if (this.settings.effects) void this.preloadCues();
    if (this.settings.music) void this.applyTrack();
  }

  private onVisibility(): void {
    this.hidden = document.hidden;
    if (!this.ctx) return;
    if (this.hidden) {
      this.voices.forEach((v) => v.pause());
      void this.ctx.suspend();
    } else {
      void this.ctx.resume().then(() => this.voices.forEach((v) => v.resume()));
    }
  }

  // ---- buffers -----------------------------------------------------------------------------
  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch(() => {
          this.buffers.delete(url); // try again next time
          return null;
        });
      this.buffers.set(url, p);
    }
    return p;
  }

  private async preloadCues(): Promise<void> {
    if (!this.ctx) return;
    for (const name of Object.keys(CUE_GAIN)) void this.load(`/audio/sfx-${name}.mp3`);
  }

  // ---- cues and stingers -------------------------------------------------------------------
  /** Plays a short cue, optionally after `delay` seconds. Silent unless Effects is on and sound is unlocked. */
  async cue(name: Cue, delay = 0): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.settings.effects || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    const buffer = await this.load(`/audio/sfx-${name}.mp3`);
    if (!buffer || !this.settings.effects) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = CUE_GAIN[name];
    src.connect(g).connect(this.sfx);
    src.start(Math.max(ctx.currentTime, t0 + delay));
  }

  /** Victory stinger: the music ducks beneath it, then comes back. Belongs to the Music setting. */
  async stinger(kind: Stinger, delay = 0): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.settings.music || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    const buffer = await this.load(`/audio/stinger-${kind}.mp3`);
    if (!buffer || !this.settings.music) return;
    const start = Math.max(ctx.currentTime, t0 + delay);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = STINGER_LEVEL;
    src.connect(g).connect(this.master);
    src.start(start);
    this.music.gain.cancelScheduledValues(start - 0.4);
    this.music.gain.setTargetAtTime(MUSIC_LEVEL * DUCK_TO, Math.max(ctx.currentTime, start - 0.3), 0.25);
    this.music.gain.setTargetAtTime(MUSIC_LEVEL, start + buffer.duration - 0.5, 1.2);
  }

  /** Plays everything planned from a batch of public events. */
  play(plan: Plan): void {
    for (const c of plan.cues) void this.cue(c.cue, c.at);
    if (plan.stinger) void this.stinger(plan.stinger.kind, plan.stinger.at);
  }

  // ---- music -------------------------------------------------------------------------------
  /** The bed that fits the room right now (null = silence). Applied only while Music is on. */
  setTrack(track: Track | null): void {
    if (track === this.desired) return;
    this.desired = track;
    void this.applyTrack();
  }

  private async applyTrack(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.settings.music || this.hidden) return;
    const want = this.desired;
    if (want === null) return this.stopMusic(TRACK_FADE);
    if (this.current?.track === want) return;
    const next = this.voices.find((v) => !v.busy);
    if (!next) return;
    const old = this.current;
    this.current = next;
    const ok = await next.start(want, old ? TRACK_FADE : 1.5);
    if (!ok) {
      this.current = old; // blocked until the next tap; unlock() retries
      return;
    }
    old?.fadeOutAndStop(TRACK_FADE);
    this.ensureLoopTimer();
  }

  private stopMusic(fade: number): void {
    this.voices.forEach((v) => v.track && v.fadeOutAndStop(fade));
    this.current = null;
    clearInterval(this.loopTimer);
    this.loopTimer = undefined;
  }

  /** When the current voice nears its end, crossfade into a fresh copy of the same track. */
  private ensureLoopTimer(): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      const cur = this.current;
      if (!cur || !cur.track || this.hidden || cur.remaining > LOOP_FADE + 0.3) return;
      const next = this.voices.find((v) => !v.busy);
      if (!next) return;
      const track = cur.track;
      this.current = next;
      void next.start(track, LOOP_FADE).then((ok) => {
        if (ok) cur.fadeOutAndStop(LOOP_FADE);
        else this.current = cur;
      });
    }, 250);
  }
}

export const audio = new AudioEngine();

/** React binding for the menu toggles. */
export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(audio.subscribe, audio.getSettings, audio.getServerSettings);
}

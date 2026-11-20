#!/usr/bin/env python3
"""
Builds the game's music and sound cues into public/audio/*.mp3.

    python3 scripts/build-audio.py [workdir]

* Downloads the licensed source files listed in data/audio-sources.json into `workdir`
  (default: a temp dir, one sub-directory per source), then unpacks the Kenney / pistol zips.
* Music and stingers are trimmed, loudness-matched and re-encoded (long ambient loops are
  lightly compressed so their very quiet passages stay audible).
* Short cues are built from recorded samples (cards, thuds, doors, the pistol) layered with
  tones synthesised here (bells, pings, stamps, rumble), then peak-normalised.

Requires: ffmpeg (libmp3lame), numpy, scipy.
Sources are third-party files under CC0 / CC BY; credits live in data/audio-sources.json and the
in-app Credits sheet. Synthesised sounds are original to this project.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio"
SR = 44100
UA = {"User-Agent": "Mozilla/5.0 (secret-hitler-online asset build)"}


# --------------------------------------------------------------------------- fetching
def fetch_sources(work: Path) -> None:
    for src in json.loads((ROOT / "data" / "audio-sources.json").read_text()):
        d = work / src["key"]
        d.mkdir(parents=True, exist_ok=True)
        names = [(src["url"].format(name=n), f"{n}.wav") for n in src["files"]] if "files" in src else [(src["url"], src["file"])]
        for url, name in names:
            dest = d / name
            if not dest.exists():
                print(f"  downloading {src['key']}/{name}")
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=120) as r:
                    dest.write_bytes(r.read())
            if dest.suffix == ".zip" and not (d / "x").exists():
                with zipfile.ZipFile(dest) as z:
                    z.extractall(d / "x")  # ZipFile refuses absolute paths and '..' components


def find(work: Path, key: str, name: str) -> Path:
    hits = list((work / key).rglob(name))
    if not hits:
        raise FileNotFoundError(f"{key}/{name}")
    return hits[0]


# --------------------------------------------------------------------------- audio helpers
def ff(path: Path, af: str = "", ss: float | None = None, t: float | None = None) -> np.ndarray:
    """Decode through ffmpeg (optionally filtered) to a float32 stereo array at 44.1 kHz."""
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None:
        cmd += ["-ss", str(ss)]
    cmd += ["-i", str(path)]
    if t is not None:
        cmd += ["-t", str(t)]
    if af:
        cmd += ["-af", af]
    cmd += ["-ar", str(SR), "-ac", "2", "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def mono(a: np.ndarray) -> np.ndarray:
    return np.stack([a, a], axis=1).astype(np.float32)


def mix(*layers: tuple[np.ndarray, float, float]) -> np.ndarray:
    """layers = (audio, start_seconds, gain)."""
    end = max(int(s * SR) + len(a) for a, s, _ in layers)
    out = np.zeros((end, 2), np.float32)
    for a, s, g in layers:
        i = int(s * SR)
        out[i : i + len(a)] += a * g
    return out


def fade(a: np.ndarray, fin: float = 0.002, fout: float = 0.03) -> np.ndarray:
    a = a.copy()
    n_in, n_out = min(int(fin * SR), len(a)), min(int(fout * SR), len(a))
    if n_in:
        a[:n_in] *= np.linspace(0, 1, n_in)[:, None]
    if n_out:
        a[-n_out:] *= np.linspace(1, 0, n_out)[:, None]
    return a


def lowpass(a: np.ndarray, hz: float, order: int = 4) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, hz, "low", fs=SR, output="sos"), a, axis=0).astype(np.float32)


def echo(a: np.ndarray, taps: list[tuple[float, float]]) -> np.ndarray:
    return mix((a, 0, 1.0), *[(a, d, g) for d, g in taps])


def normalize(a: np.ndarray, peak_db: float = -4.0) -> np.ndarray:
    p = float(np.abs(a).max())
    return (a * (10 ** (peak_db / 20) / p)).astype(np.float32) if p > 0 else a


def trim(a: np.ndarray, seconds: float) -> np.ndarray:
    return a[: int(seconds * SR)]


def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


# --------------------------------------------------------------------------- synthesis
def bell(midi: float, dur: float = 1.2, decay: float = 0.45) -> np.ndarray:
    """A soft struck-bell / glockenspiel tone: slightly inharmonic partials, fast attack, exponential decay."""
    t, f = tt(dur), mtof(midi)
    y = np.zeros_like(t)
    for ratio, amp, d in [(1.0, 1.0, 1.0), (2.0, 0.35, 0.6), (3.01, 0.2, 0.4), (4.17, 0.1, 0.3), (5.43, 0.05, 0.2)]:
        y += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (decay * d))
    y *= np.minimum(1.0, t / 0.004)
    return mono(y)


def pluck(midi: float, dur: float = 0.35) -> np.ndarray:
    t, f = tt(dur), mtof(midi)
    y = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t / 0.09)
    y *= np.minimum(1.0, t / 0.002)
    return mono(y)


def woodblock() -> np.ndarray:
    t = tt(0.09)
    rng = np.random.default_rng(7)
    y = np.sin(2 * np.pi * 1150 * t) * np.exp(-t / 0.018) + 0.35 * rng.standard_normal(len(t)) * np.exp(-t / 0.004)
    return mono(y)


def sub_thump(f0: float = 95.0, f1: float = 38.0, dur: float = 0.55) -> np.ndarray:
    t = tt(dur)
    freq = f1 + (f0 - f1) * np.exp(-t / 0.07)
    y = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.16)
    return mono(y)


def rumble(dur: float, swell: float = 0.35, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = rng.standard_normal(int(dur * SR))
    n = np.cumsum(n)  # brown noise
    n -= n.mean()
    n = signal.sosfilt(signal.butter(2, 160, "low", fs=SR, output="sos"), n)
    t = tt(dur)
    env = np.minimum(1, t / swell) * np.exp(-np.maximum(0, t - swell) / (dur * 0.45))
    y = n * env
    return mono(y / np.abs(y).max())


def dark_pad(dur: float, rise: float) -> np.ndarray:
    """A low minor chord (D2 A2 F3) of detuned saws, slowly swelling in."""
    t = tt(dur)
    y = np.zeros_like(t)
    for midi in (38, 45, 53):
        for det in (-0.07, 0.0, 0.08):
            y += signal.sawtooth(2 * np.pi * mtof(midi + det) * t) * 0.3
    y = signal.sosfilt(signal.butter(3, 700, "low", fs=SR, output="sos"), y)
    env = np.minimum(1, (t / rise) ** 2) * np.minimum(1, (dur - t) / 1.2)
    return mono(y * env / np.abs(y).max())


def sonar_ping() -> np.ndarray:
    t = tt(0.9)
    y = np.sin(2 * np.pi * 1568 * t) * np.exp(-t / 0.12) * np.minimum(1, t / 0.003)
    return echo(mono(y), [(0.23, 0.45), (0.46, 0.22)])


# --------------------------------------------------------------------------- encoding
def write_mp3(a: np.ndarray, name: str, bitrate: str = "112k") -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
         "-c:a", "libmp3lame", "-b:a", bitrate, str(path)],
        input=a.astype(np.float32).tobytes(), check=True,
    )
    print(f"  {name:28s} {len(a) / SR:6.2f}s  {path.stat().st_size / 1024:7.1f} KB")


def encode_file(src: Path, name: str, af: str, bitrate: str, t: float | None = None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src)]
    if t is not None:
        cmd += ["-t", str(t)]
    cmd += ["-af", af, "-ar", str(SR), "-ac", "2", "-c:a", "libmp3lame", "-b:a", bitrate, str(OUT / name)]
    subprocess.run(cmd, check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(OUT / name)], capture_output=True, text=True).stdout)
    print(f"  {name:28s} {dur:6.2f}s  {(OUT / name).stat().st_size / 1024:7.1f} KB")


# --------------------------------------------------------------------------- the build
def build(work: Path) -> None:
    def card(n: str) -> Path:
        return find(work, "casino", n)

    def rpg(n: str) -> Path:
        return find(work, "rpg", n)

    def metal(n: str) -> Path:
        return find(work, "metal", n)

    print("music and stingers")
    # Long ambient beds: compress lightly so the near-silent passages stay audible, then match loudness.
    encode_file(find(work, "horror", "horror.ogg"), "music-suspense.mp3",
                "acompressor=threshold=0.04:ratio=3.5:attack=250:release=1500:makeup=2.5,loudnorm=I=-23:TP=-2:LRA=8", "80k")
    encode_file(find(work, "insistent", "insistent.ogg"), "music-paranoia.mp3", "loudnorm=I=-23:TP=-2:LRA=8", "96k")
    encode_file(find(work, "longing", "longing.ogg"), "music-lobby.mp3", "loudnorm=I=-23:TP=-2:LRA=8", "96k")
    # Stingers sit a little louder than the beds.
    encode_file(find(work, "fanfare", "fanfare.wav"), "stinger-liberal.mp3", "afade=t=out:st=9.3:d=1.8,loudnorm=I=-17:TP=-2:LRA=6", "128k", t=11.1)
    encode_file(find(work, "stinger", "stinger.mp3"), "stinger-fascist.mp3", "afade=t=out:st=8.6:d=1.4,loudnorm=I=-17:TP=-2:LRA=6", "128k", t=10.0)

    print("cues")
    cues: dict[str, np.ndarray] = {}

    # --- cards (recorded): flips, ballots, shuffling
    cues["flip"] = fade(trim(ff(card("card-slide-2.ogg")), 0.34), fout=0.06)
    cues["ballot"] = fade(trim(ff(card("card-place-2.ogg")), 0.4), fout=0.08)
    cues["peek"] = fade(trim(ff(card("card-fan-1.ogg")), 0.72), fout=0.1)
    cues["deal"] = fade(trim(ff(card("card-shuffle.ogg")), 2.3), fout=0.5)
    # All ballots turning at once: a quick flurry of slides, then a soft knock on the table.
    flurry = [("card-slide-1.ogg", 0.0), ("card-slide-2.ogg", 0.025), ("card-slide-4.ogg", 0.05), ("card-slide-3.ogg", 0.08),
              ("card-slide-5.ogg", 0.11), ("card-slide-6.ogg", 0.135)]
    cues["reveal"] = fade(mix(*[(trim(ff(card(n)), 0.3), s, 0.8) for n, s in flurry],
                              (trim(ff(card("card-place-1.ogg")), 0.4), 0.16, 0.9),
                              (trim(ff(metal("thud2.wav")), 0.4), 0.17, 0.35)), fout=0.1)

    # --- small UI cues (synthesised)
    cues["tap"] = woodblock() * 0.9
    cues["confirm"] = mix((bell(79, 0.7, 0.25), 0, 0.7), (bell(84, 0.8, 0.28), 0.09, 0.7))
    cues["turn"] = mix((bell(76, 1.1, 0.32), 0, 0.8), (bell(83, 1.3, 0.38), 0.14, 0.65))   # E5 then B5: soft, unmistakable
    cues["join"] = mix((pluck(79), 0, 0.8), (pluck(86), 0.09, 0.7))
    cues["leave"] = mix((pluck(74), 0, 0.8), (pluck(67), 0.09, 0.7))

    # --- vote outcomes
    cues["elected"] = mix(*[(bell(m, 1.2, 0.4), i * 0.075, 0.7) for i, m in enumerate((72, 76, 79, 84))])
    rej = ff(metal("bong1.wav"), "lowpass=f=700")
    cues["rejected"] = fade(mix((trim(rej, 1.3), 0, 0.7), (bell(64, 1.0, 0.35), 0, 0.5), (bell(63, 1.1, 0.35), 0.16, 0.5)), fout=0.2)

    # --- policies: Liberal = bright, a card laid and bells rising; Fascist = a heavy stamp
    cues["policy-liberal"] = fade(mix((trim(ff(card("card-place-1.ogg")), 0.5), 0, 0.9),
                                      *[(bell(m, 1.5, 0.5), 0.12 + i * 0.08, 0.6) for i, m in enumerate((79, 84, 88, 91))]), fout=0.25)
    bong_low = ff(metal("bong1.wav"), "asetrate=30870,aresample=44100,lowpass=f=900")  # pitched down ~0.7x
    cues["policy-fascist"] = fade(mix((sub_thump(), 0, 1.0),
                                      (trim(ff(metal("thud3.wav")), 0.45), 0.0, 1.0),
                                      (trim(ff(rpg("doorClose_4.ogg")), 0.6), 0.02, 0.55),
                                      (trim(bong_low, 1.6), 0.03, 0.4),
                                      (trim(ff(rpg("creak3.ogg")), 0.34), 0.45, 0.35)), fout=0.3)

    # --- election tracker, chaos, the Hitler zone
    cues["tracker"] = mix((trim(ff(metal("clink2.wav")), 0.3), 0, 0.9), (pluck(57, 0.3), 0.0, 0.5))
    tritone = mix((bell(57, 1.6, 0.6), 0, 0.5), (bell(63, 1.6, 0.6), 0.02, 0.45))
    cues["chaos"] = fade(mix((rumble(2.6), 0, 0.9), (trim(ff(rpg("doorClose_3.ogg")), 0.71), 0.05, 0.8),
                             (tritone, 0.1, 0.8), (trim(ff(rpg("creak2.ogg")), 0.83), 0.6, 0.4)), fout=0.5)
    cues["zone"] = fade(mix((dark_pad(4.0, 2.3), 0, 0.9), (trim(ff(rpg("creak1.ogg")), 0.66), 2.2, 0.4), (sub_thump(70, 32, 0.8), 2.45, 0.8)), fout=0.9)

    # --- powers
    cues["investigate"] = sonar_ping()
    cues["special"] = mix((trim(ff(card("card-fan-1.ogg")), 0.72), 0, 0.8), (bell(72, 1.0, 0.3), 0.18, 0.55), (bell(79, 1.2, 0.34), 0.3, 0.55))
    cues["veto"] = fade(mix((trim(ff(rpg("metalLatch.ogg")), 0.26), 0, 0.9), (trim(rej, 1.1), 0.1, 0.55)), fout=0.2)
    # The recording holds four shots; take the first, starting right at the crack (0.17 s) and fading
    # out its room tail so the cue is one clean shot.
    gun = ff(find(work, "gunshot", "cz.wav"), "lowpass=f=7500,aecho=0.7:0.6:70|170:0.35|0.18", ss=0.17, t=1.9)
    cues["shot"] = fade(gun, fout=1.0) * 0.9
    dead_bell = ff(metal("bong1.wav"), "asetrate=22050,aresample=44100,lowpass=f=450")  # an octave down
    cues["dead"] = fade(mix((sub_thump(80, 30, 0.9), 0, 0.9), (trim(dead_bell, 3.0), 0.02, 0.8), (trim(ff(metal("thud2.wav")), 0.5), 0.0, 0.6)), fout=1.0)

    for name, a in cues.items():
        write_mp3(normalize(a, -4.0), f"sfx-{name}.mp3", "96k")


def main() -> None:
    work = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="sh-audio-"))
    work.mkdir(parents=True, exist_ok=True)
    print("sources ->", work)
    fetch_sources(work)
    build(work)
    print("done ->", OUT)


if __name__ == "__main__":
    main()

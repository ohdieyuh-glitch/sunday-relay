#!/usr/bin/env python3
"""Wonderland procedural audio — the WAVs generate-hub-level.py imports.

PROVENANCE, and it is the whole point of this file: every sample below is
synthesised here from noise, sines and envelopes. Nothing is sampled, nothing
is downloaded, no third-party asset is involved, and there is no licence to
honour beyond our own. That matches the contract build_audio() states in
generate-hub-level.py:

    "100% procedurally synthesised in-repo (noise/sine/envelope), CC0-equivalent"

WHY THIS FILE EXISTS HERE. generate-hub-level.py imports
/opt/wonderland/audio/<name>.wav and names gen-audio.py as their source, but
that generator was never committed — it lived only on the retired Japan build
host, so a fresh host had no audio and the level build failed on seven missing
imports. This is that generator, written to the documented contract.

THE LOOPS ARE SEAMLESS BY CONSTRUCTION. amb_* are marked looping in the level,
and a loop whose end does not meet its start clicks once per cycle. Every
periodic component uses a whole number of cycles across the buffer, and the
noise beds are cross-faded head-to-tail, so the last sample joins the first.

Stdlib only (wave, struct, math, random) — the build host has no numpy.
"""
import math
import os
import random
import struct
import sys
import wave

RATE = 48000          # matches UE's mixer rate; avoids a resample on import
AMP = 0.72            # headroom: leaves room for the engine's own attenuation
OUT_DIR = os.environ.get("WONDERLAND_AUDIO_DIR", "/opt/wonderland/audio")

# Deterministic: the same commit produces byte-identical audio, so a rebuild
# is not a silent content change.
random.seed(0x77ABCD)


def _write(name, samples, rate=RATE):
    """One mono 16-bit PCM WAV, hard-limited rather than allowed to wrap."""
    path = os.path.join(OUT_DIR, name + ".wav")
    frames = bytearray()
    for s in samples:
        v = max(-1.0, min(1.0, s))
        frames += struct.pack("<h", int(v * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    print("wrote %s (%.1fs, %d frames)" % (path, len(samples) / float(rate), len(samples)))


def _seamless(samples, fade):
    """Cross-fade the tail into the head so the loop point is inaudible."""
    n = len(samples)
    fade = min(fade, n // 2)
    out = list(samples)
    for i in range(fade):
        a = i / float(fade)
        out[i] = samples[i] * a + samples[n - fade + i] * (1.0 - a)
    return out[: n - fade]


def _lowpass(samples, alpha):
    """One-pole low-pass. alpha near 0 = darker."""
    out = []
    prev = 0.0
    for s in samples:
        prev += alpha * (s - prev)
        out.append(prev)
    return out


def amb_wind(seconds=8.0):
    """Noise through a slowly-breathing low-pass — air, not hiss."""
    n = int(RATE * seconds)
    noise = [random.uniform(-1.0, 1.0) for _ in range(n)]
    body = _lowpass(noise, 0.020)
    out = []
    for i, s in enumerate(body):
        t = i / float(RATE)
        # Two gusts across the buffer: whole cycles, so the loop matches.
        gust = 0.55 + 0.45 * math.sin(2 * math.pi * (2.0 / seconds) * t)
        swell = 0.85 + 0.15 * math.sin(2 * math.pi * (1.0 / seconds) * t)
        out.append(s * gust * swell * AMP * 3.2)
    return _seamless(out, int(RATE * 0.35))


def amb_water(seconds=8.0):
    """Brighter noise plus burbles — a stream, close but not loud."""
    n = int(RATE * seconds)
    noise = [random.uniform(-1.0, 1.0) for _ in range(n)]
    body = _lowpass(noise, 0.14)
    out = []
    for i, s in enumerate(body):
        t = i / float(RATE)
        burble = (
            0.10 * math.sin(2 * math.pi * (3.0 / seconds) * t)
            + 0.06 * math.sin(2 * math.pi * (7.0 / seconds) * t)
        )
        out.append((s * 0.55 + burble) * AMP * 1.5)
    return _seamless(out, int(RATE * 0.30))


def amb_magic(seconds=8.0):
    """A shimmering just-intoned cluster — the arcane circle's hum."""
    n = int(RATE * seconds)
    base = 220.0
    # Whole cycles across the buffer keeps every partial loop-safe.
    partials = [(1.0, 0.32), (1.5, 0.20), (2.0, 0.14), (3.0, 0.09), (4.5, 0.05)]
    out = []
    for i in range(n):
        t = i / float(RATE)
        v = 0.0
        for ratio, gain in partials:
            f = base * ratio
            cycles = round(f * seconds)
            v += gain * math.sin(2 * math.pi * (cycles / seconds) * t)
        shimmer = 0.80 + 0.20 * math.sin(2 * math.pi * (2.0 / seconds) * t)
        out.append(v * shimmer * AMP * 0.55)
    return _seamless(out, int(RATE * 0.25))


def sfx_footstep(seconds=0.16):
    """A soft noise thud with a fast decay — grass, not stone."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / float(RATE)
        env = math.exp(-38.0 * t)
        body = random.uniform(-1.0, 1.0) * 0.7 + 0.3 * math.sin(2 * math.pi * 95.0 * t)
        out.append(body * env * AMP)
    return _lowpass(out, 0.28)


def sfx_gate(seconds=1.1):
    """A low rising sweep that opens — the gate acknowledging you."""
    n = int(RATE * seconds)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / float(RATE)
        f = 110.0 + 260.0 * (t / seconds) ** 1.6
        phase += 2 * math.pi * f / RATE
        env = min(1.0, t * 8.0) * math.exp(-2.2 * t)
        out.append((math.sin(phase) * 0.7 + 0.3 * math.sin(phase * 2)) * env * AMP)
    return out


def sfx_verified(seconds=0.7):
    """A two-note rising chime. Verified work should sound like good news."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / float(RATE)
        first = math.sin(2 * math.pi * 659.25 * t) * math.exp(-6.0 * t)
        second = 0.0
        if t > 0.16:
            second = math.sin(2 * math.pi * 987.77 * (t - 0.16)) * math.exp(-5.0 * (t - 0.16))
        out.append((first * 0.55 + second * 0.55) * AMP)
    return out


def sfx_error(seconds=0.55):
    """A short descending buzz. Unpleasant on purpose, never harsh."""
    n = int(RATE * seconds)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / float(RATE)
        f = 300.0 - 140.0 * (t / seconds)
        phase += 2 * math.pi * f / RATE
        square = 1.0 if math.sin(phase) >= 0 else -1.0
        env = math.exp(-5.0 * t)
        out.append(square * env * AMP * 0.42)
    return _lowpass(out, 0.22)


BUILDERS = {
    "amb_wind": amb_wind,
    "amb_water": amb_water,
    "amb_magic": amb_magic,
    "sfx_footstep": sfx_footstep,
    "sfx_gate": sfx_gate,
    "sfx_verified": sfx_verified,
    "sfx_error": sfx_error,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, fn in BUILDERS.items():
        _write(name, fn())
    print("all %d wavs written to %s" % (len(BUILDERS), OUT_DIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())

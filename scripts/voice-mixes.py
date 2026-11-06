#!/usr/bin/env python3
"""Writes the test signals for web/e2e/voice-measure.spec.ts into a directory.

Synthetic speech from macOS `say` plus synthetic fan, drivetrain and breath
noise, so nothing here is anyone's voice and a call is never recorded.

    python3 scripts/voice-mixes.py /tmp/voice
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
LEAD_S, GAP_S = 6.0, 3.0
# A laptop mic at arm's length, before AGC.
SPEECH_DBFS = -26.0
# Soft first sounds on purpose: a gate that opens late eats these.
SENTENCES = [
    "Hold this pace for five more minutes, then we go.",
    "Fifteen seconds left in this block, stay on it.",
    "He said the climb starts after the second bridge.",
    "She has a flat tire, so we will wait a moment.",
    "Sprint now, everyone, as hard as you can go.",
    "Thanks for the ride, that was a good one.",
]


def rms(x):
    return np.sqrt(np.mean(x**2) + 1e-20)


def band(lo, hi, n, rng):
    b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], "band")
    return signal.lfilter(b, a, rng.standard_normal(n))


def at(x, dbfs):
    return x * 10 ** (dbfs / 20) / rms(x)


def say(text, out):
    aiff, wav = os.path.join(out, "tmp.aiff"), os.path.join(out, "tmp.wav")
    subprocess.run(["say", "-v", "Samantha", "-o", aiff, text], check=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ar", str(SR), "-ac", "1", "-c:a", "pcm_f32le", wav],
        check=True,
    )
    x, _ = sf.read(wav)
    os.remove(aiff)
    os.remove(wav)
    on = np.flatnonzero(np.abs(x) > 1e-3)
    return x[on[0] : on[-1] + 1]


def main(out):
    rng = np.random.default_rng(7)
    parts = [say(s, out) for s in SENTENCES]
    n = int(SR * (LEAD_S + sum(len(p) / SR + GAP_S for p in parts)))
    clean, labels, pos = np.zeros(n), [], int(LEAD_S * SR)
    for part, text in zip(parts, SENTENCES):
        clean[pos : pos + len(part)] = part
        labels.append({"start": pos / SR, "end": (pos + len(part)) / SR, "text": text})
        pos += len(part) + int(GAP_S * SR)
    clean *= 10 ** (SPEECH_DBFS / 20) / rms(np.concatenate(parts))

    t = np.arange(n) / SR
    # Fan: pink-ish broadband, blade pass at 87 Hz and its harmonics, a slow wobble.
    white = rng.standard_normal(n)
    b, a = signal.butter(1, 400 / (SR / 2))
    broad = signal.lfilter(b, a, white) * 3 + band(800, 6000, n, rng) * 0.35 + white * 0.05
    blades = sum(np.sin(2 * np.pi * 87 * k * t + k) / k for k in range(1, 7)) * 0.15
    fan = (broad + blades) * (1 + 0.08 * np.sin(2 * np.pi * 0.4 * t))
    # Drivetrain: a whine that drifts with cadence, the pedal stroke's pulse, chain hiss.
    cadence = 1.5 + 0.05 * np.sin(2 * np.pi * 0.1 * t)
    phase = 2 * np.pi * np.cumsum(cadence * 420 / 1.5) / SR
    pulse = 0.65 + 0.35 * np.abs(np.sin(np.pi * np.cumsum(cadence) / SR))
    whine = np.sin(phase) + 0.6 * np.sin(2 * phase) + 0.35 * np.sin(3.1 * phase)
    drive = whine * pulse + band(2000, 7000, n, rng) * pulse * 2
    # Breath: one every 1.7 s or so, heavy, close to the mic.
    breath, air, pos = np.zeros(n), band(350, 3800, n, rng), int(0.3 * SR)
    while pos < n:
        length = int((0.55 + 0.15 * rng.random()) * SR)
        shape = np.sin(np.pi * np.linspace(0, 1, length)) ** 1.5
        end = min(n, pos + length)
        breath[pos:end] = air[pos:end] * shape[: end - pos] * (0.7 if rng.random() < 0.5 else 1.0)
        pos += int((1.7 + 0.2 * rng.random()) * SR)

    scenes = {
        "quiet": [(fan, -62)],
        "fan": [(fan, -41)],
        "bike": [(fan, -40), (drive, -44), (breath, -38)],
        "loud": [(fan, -33), (drive, -38), (breath, -34)],
    }
    meta = {"sr": SR, "labels": labels, "scenes": {}}
    sf.write(f"{out}/clean.wav", clean, SR, subtype="PCM_16")
    for name, spec in scenes.items():
        noise = sum(at(x, db) for x, db in spec)
        sf.write(f"{out}/{name}.wav", np.clip(clean + noise, -1, 1), SR, subtype="PCM_16")
        meta["scenes"][name] = {"snr_db": round(SPEECH_DBFS - 20 * np.log10(rms(noise)), 1)}
    with open(f"{out}/meta.json", "w") as f:
        json.dump(meta, f, indent=1)
    print(meta["scenes"])


if __name__ == "__main__":
    main(sys.argv[1])

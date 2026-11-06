#!/usr/bin/env python3
"""Compares what web/e2e/voice-measure.spec.ts recorded with what went in.

    python3 scripts/voice-measure.py /tmp/voice run bike

The recording is two loops of the mix: the last whole one is scored, once the
AGC and the gate have settled. The receiver stretches time, so each sentence
finds its own place in it.
"""
import json
import sys
from math import gcd

import numpy as np
import soundfile as sf
from pesq import pesq
from pystoi import stoi
from scipy import signal

SILENT = 1e-4  # -80 dBFS: a gate's fade is over, or the room is gone.


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def db(v):
    return float(20 * np.log10(max(float(v), 1e-6)))


def correlate(a, b):
    return signal.fftconvolve(a, b[::-1], mode="full")


def last_loop(y, mix, clean, labels, sr):
    n, step = len(clean), 240
    env = lambda s: signal.lfilter([1], [1, -0.95], np.abs(s))[::step]
    ref, got = env(np.concatenate([mix, mix])), env(y)
    lag = (int(np.argmax(correlate(got - got.mean(), ref - ref.mean()))) - (len(ref) - 1)) * step
    start = lag % n
    start += max(0, (len(y) - start - n) // n) * n
    if start + n > len(y):
        raise SystemExit(f"recording too short: {len(y) / sr:.0f} s for a {n / sr:.0f} s mix")
    seg, near = np.zeros(n), int(0.35 * sr)
    cuts = [0] + [int((a["end"] + b["start"]) / 2 * sr) for a, b in zip(labels, labels[1:])] + [n]
    for i, label in enumerate(labels):
        a, b = int(label["start"] * sr), int(label["end"] * sr)
        lo = max(0, start + a - near)
        hit = correlate(y[lo : start + b + near], clean[a:b])
        off = lo + int(np.argmax(np.abs(hit))) - (b - a - 1) - (start + a)
        part = y[max(0, start + cuts[i] + off) : start + cuts[i + 1] + off]
        seg[cuts[i] : cuts[i] + len(part)] = part[: cuts[i + 1] - cuts[i]]
    return seg


def score(y, clean, labels, sr):
    speech = np.zeros(len(clean), bool)
    gaps, last = [], 0
    for label in labels:
        a, b = int(label["start"] * sr), int(label["end"] * sr)
        speech[a:b] = True
        gaps.append((last, a))
        last = b
    gaps.append((last, len(clean)))
    pauses = np.concatenate([y[a + int(0.1 * sr) : b] for a, b in gaps[1:]])
    frames = pauses[: len(pauses) // 960 * 960].reshape(-1, 960)

    # How much of each word's first 80 ms arrived, against that sentence's own gain.
    first, opened = [], []
    for label in labels:
        a, b = int(label["start"] * sr), int(label["end"] * sr)
        gain = rms(y[a:b]) / max(rms(clean[a:b]), 1e-9)
        w = int(0.08 * sr)
        first.append(rms(y[a : a + w]) / max(gain * rms(clean[a : a + w]), 1e-9))
        lead = int(0.3 * sr)
        on = np.flatnonzero(np.abs(y[a - lead : a + lead]) > SILENT)
        opened.append(round((on[0] / sr - 0.3) * 1000) if len(on) else None)

    a, b = int(labels[0]["start"] * sr) - 4800, int(labels[-1]["end"] * sr) + 4800
    ref16, got16 = signal.resample_poly(clean[a:b], 1, 3), signal.resample_poly(y[a:b], 1, 3)
    return {
        "speech_dbfs": round(db(rms(y[speech])), 1),
        "peak_dbfs": round(db(np.max(np.abs(y))), 1),
        "clipped": int(np.sum(np.abs(y) >= 0.985)),
        "pause_dbfs": round(db(rms(pauses)), 1),
        "pause_open_pct": round(100 * float(np.mean(np.sqrt(np.mean(frames**2, axis=1)) > SILENT))),
        "first_80ms_db": round(db(np.median(first)), 1),
        "opened_ms": opened,
        "pesq_wb": round(float(pesq(16000, ref16, got16, "wb")), 2),
        "stoi": round(float(stoi(ref16, got16, 16000, extended=False)), 3),
    }


def main(directory, label, scene):
    meta = json.load(open(f"{directory}/meta.json"))
    sr, labels = meta["sr"], meta["labels"]
    clean, _ = sf.read(f"{directory}/clean.wav")
    mix, _ = sf.read(f"{directory}/{scene}.wav")
    print("input", score(mix, clean, labels, sr))
    for stage in ("raw", "sent", "heard"):
        y, rate = sf.read(f"{directory}/out-{label}-{scene}-{stage}.wav")
        if rate != sr:
            g = gcd(rate, sr)
            y = signal.resample_poly(y, sr // g, rate // g)
        print(stage, score(last_loop(y, mix, clean, labels, sr), clean, labels, sr))
    gate = json.load(open(f"{directory}/out-{label}-{scene}.json"))["gate"]
    opens = sum(1 for a, b in zip(gate, gate[1:]) if b["open"] and not a["open"])
    closes = sum(1 for a, b in zip(gate, gate[1:]) if a["open"] and not b["open"])
    marks = [g["threshold"] for g in gate]
    print(f"gate: {opens} opens, {closes} closes, mark {min(marks):.4f}..{max(marks):.4f}")


if __name__ == "__main__":
    main(*sys.argv[1:4])

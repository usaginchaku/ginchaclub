"""Render the original POYO POP score. No recordings or downloaded samples.

Requires numpy and FFmpeg. The uncompressed WAV is the exact 32-bar loop;
MP3 is a listening/download version. Reverb/delay tails wrap into the loop.
"""
from pathlib import Path
import json
import math
import subprocess
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio"
SR = 44100
BPM = 128
BEAT = 60 / BPM
BARS = 32
SECONDS = BARS * 4 * BEAT
N = round(SECONDS * SR)
RNG = np.random.default_rng(71017)
mix = np.zeros((N, 2), dtype=np.float64)
note_count = 0


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def timebase(seconds):
    return np.arange(max(1, round(seconds * SR))) / SR


def envelope(t, attack, decay):
    return (1 - np.exp(-t / attack)) * np.exp(-t / decay)


def add(sound, beat, gain=1, pan=0, echo=False):
    global note_count
    note_count += 1
    start = round(beat * BEAT * SR)
    gains = np.array([math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)])
    offsets = [(0, 1, gains)]
    if echo:
        offsets += [(round(BEAT * SR * .75), .20, gains[::-1]),
                    (round(BEAT * SR * 1.5), .075, gains)]
    for offset, level, stereo in offsets:
        idx = (np.arange(len(sound)) + start + offset) % N
        # Every individual sound is shorter than the loop, so indices are unique.
        mix[idx] += sound[:, None] * stereo * gain * level


def pluck(note, length=.38, kind="poyo"):
    t = timebase(length + .18)
    f = hz(note)
    if kind == "poyo":
        # A short pitch scoop and decaying FM give the lead its rubbery vowel.
        phase = 2 * np.pi * f * (t + .0048 * (1 - np.exp(-t / .022)))
        y = np.sin(phase + 1.45 * np.exp(-t / .065) * np.sin(phase * 2))
        y += .12 * np.sin(phase * 2) + .055 * np.sin(phase * 3)
        env = envelope(t, .004, length * .38)
    else:
        phase = 2 * np.pi * f * t
        y = np.sin(phase) + .25 * np.sin(phase * 2.003) + .12 * np.sin(phase * 3.99)
        env = envelope(t, .002, length * .55)
    return y * env * np.minimum(1, (t[-1] - t) / .04)


def chord(notes, duration, airy=False):
    t = timebase(duration + .12)
    y = np.zeros_like(t)
    for note in notes:
        f = hz(note)
        for detune in [-.0018, .0018]:
            phase = 2 * np.pi * f * (1 + detune) * t
            y += np.sin(phase) + .24 * np.sin(phase * 2) + .09 * np.sin(phase * 3)
    env = np.minimum(t / (.055 if airy else .009), 1)
    env *= np.exp(-t / (duration * (.9 if airy else .36)))
    env *= np.minimum(np.maximum((t[-1] - t) / .12, 0), 1)
    return y / len(notes) / 2 * env


def bass(note, duration):
    t = timebase(duration)
    phase = 2 * np.pi * hz(note) * t
    y = np.sin(phase + .55 * np.exp(-t / .09) * np.sin(phase))
    y += .22 * np.sin(phase * 2)
    return y * envelope(t, .006, duration * .6) * np.minimum(1, (t[-1] - t) / .03)


def kick():
    t = timebase(.36)
    phase = 2 * np.pi * (49 * t + 98 * .027 * (1 - np.exp(-t / .027)))
    body = np.sin(phase) * envelope(t, .0007, .095)
    click = RNG.normal(0, 1, len(t)) * np.exp(-t / .002) * .085
    return np.tanh((body + click) * 1.35) * .8


def hat(opened=False):
    t = timebase(.23 if opened else .075)
    noise = RNG.normal(0, 1, len(t))
    noise = np.concatenate(([0], np.diff(noise))) * .4
    return noise * envelope(t, .001, .052 if opened else .016)


def clap():
    t = timebase(.2)
    noise = RNG.normal(0, 1, len(t))
    # Subtract a short moving average to keep the clap clear of the bass.
    noise -= np.convolve(noise, np.ones(12) / 12, mode="same")
    env = np.zeros_like(t)
    for start in [0, .012, .025]:
        d = np.maximum(t - start, 0)
        env += (t >= start) * np.exp(-d / (.038 if start else .009))
    return noise * env * .24


# Fmaj9 / C(add9)/E / Dm9 / Bbmaj9. Two-bar phrases, with a responding hook.
CHORDS = [[65, 69, 72, 76], [64, 67, 72, 74], [62, 65, 69, 72], [62, 65, 69, 70]]
ROOTS = [41, 40, 38, 34]
HOOK = [
    [(0, 77), (.75, 81), (1.5, 84), (2, 81), (2.75, 79), (3.5, 77)],
    [(.25, 81), (1, 84), (1.75, 86), (2.5, 84), (3.25, 81)],
    [(0, 79), (.75, 76), (1.5, 79), (2.25, 84), (3, 81), (3.5, 79)],
    [(.5, 76), (1.25, 79), (2, 74), (3, 76), (3.5, 72)],
    [(0, 77), (.75, 81), (1.5, 86), (2, 84), (2.75, 81), (3.5, 77)],
    [(.25, 81), (1, 84), (1.75, 81), (2.5, 77), (3.25, 76)],
    [(0, 74), (.75, 77), (1.5, 81), (2.25, 84), (3, 81), (3.5, 77)],
    [(0, 79), (.75, 77), (1.5, 74), (2.5, 76), (3.25, 77)],
]


for bar in range(BARS):
    start = bar * 4
    # Intro 4, hook 8, floating break 4, build 4, full hook 8, turnaround 4.
    intro = bar < 4
    main = 4 <= bar < 12
    floating = 12 <= bar < 16
    build = 16 <= bar < 20
    drop = 20 <= bar < 28
    outro = bar >= 28
    phrase = (bar - 4) % 8
    harmony = phrase // 2
    notes = CHORDS[harmony]
    root = ROOTS[harmony]

    if not floating:
        for b in range(4):
            if not (build and bar == 19 and b >= 3):
                add(kick(), start + b, .64 if intro else .78)
            if b % 2 and not intro:
                add(clap(), start + b, .48)
            add(hat(True), start + b + .5, .15 if intro else .23, .22)
            if drop or main:
                add(hat(), start + b + .25, .09, -.32)
                add(hat(), start + b + .75, .075, .32)
        if main or drop or build or outro:
            for step, offset in [(0.5, 0), (1.25, 0), (1.75, 12), (2.5, 0), (3.25, 7), (3.75, 12)]:
                add(bass(root + offset, .21), start + step, .46)
    else:
        add(bass(root, 1.15), start, .25)

    if floating or intro:
        add(chord(notes, BEAT * 3.5, True), start, .28, -.24, echo=True)
        add(chord([n + 12 for n in notes], BEAT * 3, True), start + .5, .10, .3)
    else:
        for b in [.5, 1.5, 2.5, 3.5]:
            add(chord(notes, .26), start + b, .36 if drop else .28, -.20, echo=True)

    if main or drop:
        for step, note in HOOK[phrase]:
            add(pluck(note, .44), start + step, .37 if drop else .34, .06, echo=True)
        if drop:
            for k in [0, 1, 2, 3]:
                add(pluck(notes[k] + 24, .3, "bell"), start + k + .5, .10, (-1) ** k * .5, echo=True)
    elif floating:
        for k in range(8):
            add(pluck(notes[k % 4] + 12, .7, "bell"), start + k * .5, .20, math.sin(k) * .4, echo=True)
    elif build:
        for k in range(8):
            add(pluck(notes[k % 4] + 12, .29), start + k * .5, .17 + .035 * (bar - 16), .15, echo=True)
        rate = .5 if bar < 19 else .25
        for k in np.arange(0, 4, rate):
            add(clap(), start + k, .12 + .025 * (bar - 16))
    else:
        for step, note in HOOK[phrase][::2]:
            add(pluck(note, .5, "bell"), start + step, .22, .2, echo=True)

    if bar in [3, 11, 19, 27, 31]:
        for k, note in enumerate([77, 79, 81, 84]):
            add(pluck(note, .23, "bell"), start + 3 + k * .25, .13, -.35 + k * .2, echo=True)

# Very short stereo ambience adds depth without washing out the rhythm.
dry = mix.copy()
for seconds, level in [(.037, .055), (.071, .045), (.113, .03)]:
    mix += np.roll(dry[:, ::-1], round(seconds * SR), axis=0) * level
mix -= mix.mean(axis=0)
# Gentle peak rounding followed by a fixed master ceiling. No clipped PCM.
mix = np.tanh(mix * 1.15)
mix *= 10 ** (-1.3 / 20) / np.max(np.abs(mix))
OUT.mkdir(parents=True, exist_ok=True)
wav_path = OUT / "poyo-pop.wav"
with wave.open(str(wav_path), "wb") as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes((mix * 32767).astype("<i2").tobytes())
subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav_path),
                "-codec:a", "libmp3lame", "-b:a", "192k", "-metadata", "title=POYO POP",
                str(OUT / "poyo-pop.mp3")], check=True)
stats = {
    "title": "POYO POP", "bpm": BPM, "key": "F major", "bars": BARS,
    "durationSeconds": SECONDS, "sampleRate": SR, "channels": 2,
    "peakDbFS": round(20 * np.log10(np.max(np.abs(mix))), 2),
    "rmsDbFS": round(20 * np.log10(np.sqrt(np.mean(mix ** 2))), 2),
    "scheduledSounds": note_count,
    "loopBoundaryDelta": float(np.max(np.abs(mix[0] - mix[-1]))),
    "samples": "All sounds synthesized by tools/compose.py; no external samples.",
}
(OUT / "audio-check.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
print(json.dumps(stats, indent=2))

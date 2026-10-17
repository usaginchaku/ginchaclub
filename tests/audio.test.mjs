import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine } from '../src/audio.js';
import { BEAT, LOOP_STEPS, STEP_SECONDS } from '../src/rhythm.js';

test('pause after multiple song loops preserves the absolute recording clock', () => {
  const engine = new SoundEngine();
  let stopped = false;
  engine.playing = true;
  engine.startedAt = 10;
  engine.context = { currentTime: 135 };
  engine.buffer = { duration: 60 };
  engine.songGain = { gain: { value: .79, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
  engine.source = { stop() { stopped = true; } };
  engine.pause();
  clearTimeout(engine.suspendTimer);
  assert.equal(engine.offset, 125);
  assert.equal(engine.beat, 125 / (60 / 128));
  assert.equal(engine.playing, false);
  assert.equal(stopped, true);
});

test('a live tap is not echoed in the same quantized slot, but returns next loop', () => {
  const engine = new SoundEngine();
  engine.playing = true;
  engine.loopEnabled = true;
  engine.startedAt = 0;
  engine.context = { currentTime: 0 };
  engine.pattern = [{ step: 0, sound: 2, createdBeat: 0 }];
  const sounds = [];
  engine.voice = (...args) => sounds.push(args);
  engine.nextTick = 0;
  engine.schedule();
  assert.equal(sounds.length, 0);
  engine.context.currentTime = 7.5;
  engine.nextTick = LOOP_STEPS;
  engine.schedule();
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0][0], 2);
});

test('failed audio loading clears the in-flight request so a later tap can retry', async () => {
  const engine = new SoundEngine();
  engine.context = { resume: async () => {} };
  let attempts = 0;
  engine.loadBuffer = async () => {
    attempts++;
    if (attempts === 1) throw new Error('offline');
    return { duration: 60 };
  };
  await assert.rejects(engine.prepare(), /offline/);
  assert.equal(engine.loading, null);
  assert.equal(engine.playing, false);
  await engine.prepare();
  assert.equal(attempts, 2);
  assert.equal(engine.buffer.duration, 60);
});

function clockEngine(now = 0, origin = 0) {
  const engine = new SoundEngine();
  engine.context = { currentTime: now };
  engine.startedAt = origin;
  engine.playing = true;
  engine.nextTick = 0;
  const sounds = [];
  engine.voice = (sound, when, beat) => {
    const voice = {
      when, stopped: false,
      oscillator: { stop() { voice.stopped = true; } },
      gain: { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } },
    };
    engine.voices.add(voice);
    sounds.push({ sound, when, beat, voice });
    return voice;
  };
  return { engine, sounds };
}

test('the very first tap lands exactly on the pending song start', () => {
  const { engine, sounds } = clockEngine(0, .025);
  engine.tap(0, { x: 12, y: 34 });
  assert.equal(sounds[0].when, .025);
  assert.equal(sounds[0].beat, 0);
  assert.deepEqual(engine.visualHits[0].position, { x: 12, y: 34 });
  assert.equal(engine.visualHits[0].when, sounds[0].when);
});

test('irregular taps all use the musical grid, within one subdivision plus lead time', () => {
  const { engine, sounds } = clockEngine(0, .025);
  for (const now of [.031, .257, .732, 4.827, 59.99, 125.21]) {
    engine.context.currentTime = now;
    assert.equal(engine.tap(1), true);
    const hit = sounds.at(-1);
    assert.ok(hit.when >= now + .006 - 1e-9);
    assert.ok(hit.when - now <= STEP_SECONDS + .006 + 1e-9);
    const tick = (hit.when - engine.startedAt) / STEP_SECONDS;
    assert.ok(Math.abs(tick - Math.round(tick)) < 1e-9);
  }
});

test('rapid taps coalesce by sound and subdivision, while chords remain possible', () => {
  const { engine, sounds } = clockEngine(.01);
  assert.equal(engine.tap(0), true);
  engine.context.currentTime = .02;
  assert.equal(engine.tap(0), false);
  assert.equal(engine.tap(1), true);
  assert.equal(sounds.length, 2);
  assert.equal(sounds[0].when, sounds[1].when);
});

test('recording stores the scheduled note and repeats it exactly four bars later', () => {
  const { engine, sounds } = clockEngine(.03);
  engine.setLoopEnabled(true);
  engine.tap(2);
  assert.deepEqual(engine.pattern, [{ step: 1, sound: 2, createdBeat: .25 }]);
  engine.context.currentTime = .05;
  engine.schedule();
  assert.equal(sounds.length, 1);
  engine.context.currentTime = 7.58;
  engine.schedule();
  assert.equal(sounds.length, 2);
  assert.equal(sounds[1].when - sounds[0].when, 16 * BEAT);
});

test('live taps do not double a loop note already queued at the same position', () => {
  const { engine, sounds } = clockEngine(7.56);
  engine.setLoopEnabled(true);
  engine.pattern = [{ step: 1, sound: 2, createdBeat: .25 }];
  engine.schedule();
  engine.tap(2);
  assert.equal(sounds.length, 1);
  assert.equal(engine.visualHits[0].kind, 'live');
});

test('visual events stay in playback order when a live tap is queued further ahead', () => {
  const { engine } = clockEngine();
  engine.scheduleHit(0, 2, 'live');
  engine.scheduleHit(1, 1, 'loop');
  assert.deepEqual(engine.visualHits.map(hit => hit.sound), [1, 0]);
});

for (const action of ['disable', 'clear']) {
  test(action + ' cancels queued loop notes without discarding a live tap', () => {
    const { engine, sounds } = clockEngine(7.56);
    engine.setLoopEnabled(true);
    engine.pattern = [{ step: 1, sound: 2, createdBeat: .25 }];
    engine.schedule();
    engine.tap(1);
    if (action === 'disable') engine.setLoopEnabled(false);
    else engine.clearPattern();
    assert.equal(sounds[0].voice.stopped, true);
    assert.equal(sounds[1].voice.stopped, false);
    assert.deepEqual(engine.visualHits.map(hit => hit.sound), [1]);
    assert.equal(engine.pattern.length, action === 'clear' ? 0 : 2);
  });
}

test('a stalled scheduler skips past notes and keeps the next note on the grid', () => {
  const { engine, sounds } = clockEngine(30.03);
  engine.setLoopEnabled(true);
  engine.pattern = Array.from({ length: LOOP_STEPS }, (_, step) => ({ step, sound: 0, createdBeat: 0 }));
  engine.schedule();
  assert.equal(sounds.length, 0);
  engine.context.currentTime = 30.06;
  engine.schedule();
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].when, 30 + STEP_SECONDS);
});

test('pause cancels a pending live note and its visual reaction', () => {
  const { engine, sounds } = clockEngine(.03);
  engine.tap(0);
  engine.songGain = { gain: { value: .79, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
  engine.source = { stop() {} };
  engine.pause();
  clearTimeout(engine.suspendTimer);
  assert.equal(sounds[0].voice.stopped, true);
  assert.equal(engine.visualHits.length, 0);
  assert.equal(engine.scheduledHits.size, 0);
});

test('invalid or paused taps create no audio nodes', () => {
  const { engine, sounds } = clockEngine();
  for (const value of [-1, 4, NaN, 1.5]) assert.equal(engine.tap(value), false);
  engine.playing = false;
  assert.equal(engine.tap(0), false);
  assert.equal(sounds.length, 0);
});

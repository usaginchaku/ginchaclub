import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine } from '../src/audio.js';
import { BEAT, LOOP_STEPS, STEP_SECONDS } from '../src/rhythm.js';
import { SOUNDS } from '../src/sounds.js';

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
      source: { stop() { voice.stopped = true; } },
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
  for (const now of [.031, .257, .732, 4.827, 59.99, 125.21]) {
    const { engine, sounds } = clockEngine(now, .025);
    assert.equal(engine.tap(1), true);
    const hit = sounds.at(-1);
    assert.ok(hit.when >= now + .006 - 1e-9);
    assert.ok(hit.when - now <= STEP_SECONDS + .006 + 1e-9);
    const tick = (hit.when - engine.startedAt) / STEP_SECONDS;
    assert.ok(Math.abs(tick - Math.round(tick)) < 1e-9);
    assert.ok(Number.isInteger(hit.beat), 'tap must coincide with a kick beat');
  }
});

test('visual clock follows speaker output rather than the rendering clock', () => {
  const { engine } = clockEngine(10, 0);
  engine.context.getOutputTimestamp = () => ({ contextTime: 9.8, performanceTime: performance.now() });
  assert.ok(Math.abs(engine.playbackTime - 9.8) < .01);
  assert.ok(Math.abs(engine.beat - 9.8 / BEAT) < .03);
  delete engine.context.getOutputTimestamp;
  engine.context.outputLatency = .12;
  assert.equal(engine.playbackTime, 9.88);
});

test('all eight sound IDs can be recorded together on the same beat', () => {
  const { engine, sounds } = clockEngine(.13);
  engine.setLoopEnabled(true);
  for (let sound = 0; sound < SOUNDS.length; sound++) assert.equal(engine.tap(sound), true);
  assert.equal(sounds.length, 8);
  assert.equal(new Set(sounds.map(hit => hit.when)).size, 1);
  assert.equal(engine.pattern.length, 8);
});

function synthesisContext() {
  const nodes = [];
  const parameter = () => ({
    value: 0, events: [],
    setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); },
    linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); },
    exponentialRampToValueAtTime(value, time) {
      assert.ok(value > 0, 'exponential ramps must stay positive');
      this.events.push({ type: 'exponential', value, time });
    },
  });
  const node = () => {
    const value = {
      frequency: parameter(), gain: parameter(), pan: parameter(), Q: parameter(),
      connect(destination) { return destination; },
      disconnect() { this.disconnected = true; },
      start(time) { this.started = time; }, stop(time) { this.stopped = time; },
    };
    nodes.push(value);
    return value;
  };
  return {
    currentTime: 0, sampleRate: 8000, nodes,
    createOscillator: node, createBufferSource: node, createGain: node,
    createStereoPanner: node, createBiquadFilter: node,
    createBuffer: (_, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
}

test('every sound schedules finite audio parameters and releases its nodes', () => {
  for (let sound = 0; sound < SOUNDS.length; sound++) {
    const engine = new SoundEngine();
    engine.context = synthesisContext();
    engine.limiter = {};
    const voice = engine.voice(sound, 10, 4);
    assert.equal(voice.source.started, 10);
    assert.ok(voice.source.stopped > 10);
    for (const node of engine.context.nodes) {
      for (const name of ['frequency', 'gain', 'pan', 'Q']) {
        for (const event of node[name].events) {
          assert.ok(Number.isFinite(event.value));
          assert.ok(event.time >= 10 && event.time <= voice.source.stopped);
        }
      }
    }
    voice.source.onended();
    assert.equal(engine.voices.size, 0);
    assert.ok(engine.context.nodes.every(node => node.disconnected));
  }
});

test('tap attacks follow the actual backing source phase after start and resume', () => {
  for (const offset of [0, 28.37, 125.3]) {
    const engine = new SoundEngine();
    engine.context = synthesisContext();
    engine.context.currentTime = 100;
    engine.buffer = { duration: 60 };
    engine.limiter = {};
    engine.offset = offset;
    try {
      engine.start();
      const backingStart = engine.source.started;
      engine.tap(0);
      const hit = engine.visualHits[0];
      const songBeat = (offset + hit.when - backingStart) / BEAT;
      assert.ok(Math.abs(songBeat - Math.round(songBeat)) < 1e-10);
      assert.ok(hit.when >= engine.context.currentTime + .006);
    } finally {
      clearInterval(engine.timer);
    }
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
  assert.deepEqual(engine.pattern, [{ step: 1, sound: 2, createdBeat: 1 }]);
  engine.context.currentTime = .05;
  engine.schedule();
  assert.equal(sounds.length, 1);
  engine.context.currentTime = 16 * BEAT + STEP_SECONDS - .04;
  engine.schedule();
  assert.equal(sounds.length, 2);
  assert.equal(sounds[1].when - sounds[0].when, 16 * BEAT);
});

test('live taps do not double a loop note already queued at the same position', () => {
  const { engine, sounds } = clockEngine(16 * BEAT + STEP_SECONDS - .04);
  engine.setLoopEnabled(true);
  engine.pattern = [{ step: 1, sound: 2, createdBeat: 1 }];
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
    const { engine, sounds } = clockEngine(16 * BEAT + STEP_SECONDS - .04);
    engine.setLoopEnabled(true);
    engine.pattern = [{ step: 1, sound: 2, createdBeat: 1 }];
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
  engine.context.currentTime = 30 + STEP_SECONDS - .04;
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
  for (const value of [-1, SOUNDS.length, NaN, 1.5]) assert.equal(engine.tap(value), false);
  engine.playing = false;
  assert.equal(engine.tap(0), false);
  assert.equal(sounds.length, 0);
});

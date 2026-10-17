import { BEAT, LOOP_BEATS, LOOP_STEPS, SONG_BEATS, STEPS_PER_BEAT, STEP_SECONDS, mod, nextGridTick, recordHit } from './rhythm.js';
import { SOUNDS, ROLL_SOUND } from './sounds.js';

const NOTES = [77, 81, 84, 86, 84, 81, 79, 76];
const frequency = note => 440 * 2 ** ((note - 69) / 12);

export class SoundEngine {
  constructor() {
    this.context = null;
    this.buffer = null;
    this.loading = null;
    this.playing = false;
    this.offset = 0;
    this.volume = .65;
    this.muted = false;
    this.loopEnabled = false;
    this.pattern = [];
    this.visualHits = [];
    this.timer = null;
    this.scheduledHits = new Map();
    this.voices = new Set();
  }

  async prepare() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('このブラウザは音の再生に対応していません。ChromeやSafariで開いてください。');
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 8;
      this.limiter.ratio.value = 6;
      this.limiter.attack.value = .003;
      this.limiter.release.value = .15;
      this.limiter.connect(this.master).connect(this.context.destination);
    }
    // resume must originate from a user gesture, before awaiting the file load.
    await this.context.resume();
    if (!this.buffer) {
      this.loading ??= this.loadBuffer().finally(() => { this.loading = null; });
      this.buffer = await this.loading;
    }
  }

  async loadBuffer() {
    const response = await fetch(new URL('../assets/audio/poyo-pop.wav', import.meta.url), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('曲を読み込めませんでした。もう一度「あそぶ」を押してください。');
    return this.context.decodeAudioData(await response.arrayBuffer());
  }

  start() {
    if (this.playing) return;
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.songGain = this.context.createGain();
    const when = this.context.currentTime + .025;
    this.songGain.gain.setValueAtTime(0, when);
    this.songGain.gain.linearRampToValueAtTime(.79, when + .025);
    this.source.connect(this.songGain).connect(this.limiter);
    this.startedAt = when - this.offset;
    this.source.start(when, mod(this.offset, this.buffer.duration));
    this.playing = true;
    clearTimeout(this.suspendTimer);
    this.nextTick = Math.ceil(this.offset / STEP_SECONDS);
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  pause() {
    if (!this.playing) return;
    // Preserve the absolute musical clock across pauses. Recorded hits refer to
    // this clock even after the backing track has completed several loops.
    this.offset = Math.max(0, this.context.currentTime - this.startedAt);
    this.playing = false;
    clearInterval(this.timer);
    const now = this.context.currentTime;
    const source = this.source;
    const songGain = this.songGain;
    songGain.gain.cancelScheduledValues(now);
    songGain.gain.setValueAtTime(songGain.gain.value, now);
    songGain.gain.linearRampToValueAtTime(0, now + .025);
    source.stop(now + .03);
    source.onended = () => { source.disconnect(); songGain.disconnect(); };
    for (const voice of this.voices) this.stopVoice(voice);
    this.visualHits = [];
    this.scheduledHits.clear();
    // Voices and any scheduled loop taps are suspended together with the song.
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      if (!this.playing) this.context.suspend().catch(() => {});
    }, 160);
  }

  get beat() {
    if (!this.playing) return this.offset / BEAT;
    return Math.max(0, (this.playbackTime - this.startedAt) / BEAT);
  }

  get playbackTime() {
    if (!this.context) return 0;
    const stamp = this.context.getOutputTimestamp?.();
    // Rendering runs ahead of the speakers. Use the output device's timestamp
    // for visuals, while audio scheduling continues to use currentTime.
    if (stamp?.contextTime > 0 && stamp.performanceTime > 0) {
      const elapsed = Math.max(0, (performance.now() - stamp.performanceTime) / 1000);
      return Math.min(this.context.currentTime, stamp.contextTime + elapsed);
    }
    const latency = this.context.outputLatency ?? this.context.baseLatency ?? 0;
    return Math.max(0, this.context.currentTime - latency);
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateGain();
  }

  updateGain() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, .025);
  }

  tap(sound, position) {
    if (!this.playing || !Number.isInteger(sound) || sound < 0 || sound >= SOUNDS.length) return false;
    const tick = nextGridTick(this.context.currentTime, this.startedAt);
    if (this.loopEnabled) recordHit(this.pattern, tick / STEPS_PER_BEAT, sound);
    return this.scheduleHit(sound, tick, 'live', position);
  }

  scheduleHit(sound, tick, kind, position) {
    const key = `${tick}:${sound}`;
    const previous = this.scheduledHits.get(key);
    if (previous) {
      // A tap on a note already queued by the loop should sound only once.
      if (kind === 'live') { previous.kind = kind; previous.position = position; }
      return false;
    }
    const beat = tick / STEPS_PER_BEAT;
    const when = this.startedAt + tick * STEP_SECONDS;
    const voice = this.voice(sound, when, beat);
    const hit = { sound, when, beat, kind, position, voice };
    this.scheduledHits.set(key, hit);
    this.visualHits.push(hit);
    // A live tap can be further ahead than the loop scheduler's lookahead.
    this.visualHits.sort((a, b) => a.when - b.when);
    return true;
  }

  stopVoice(voice) {
    const now = this.context.currentTime;
    const { source, gain, when } = voice;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(when > now ? 0 : gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + .02);
    source.stop(when > now ? now : now + .025);
  }

  cancelLoopHits() {
    const now = this.context?.currentTime ?? 0;
    for (const [key, hit] of this.scheduledHits) {
      if (hit.kind === 'loop' && hit.when > now) {
        this.stopVoice(hit.voice);
        this.scheduledHits.delete(key);
      }
    }
    this.visualHits = this.visualHits.filter(hit => hit.kind !== 'loop' || hit.when <= now);
  }

  setLoopEnabled(enabled) {
    this.loopEnabled = enabled;
    if (!enabled) this.cancelLoopHits();
  }

  clearPattern() {
    this.pattern = [];
    this.cancelLoopHits();
  }

  schedule() {
    if (!this.playing) return;
    const now = this.context.currentTime;
    for (const [key, hit] of this.scheduledHits) {
      if (hit.when < now - .25) this.scheduledHits.delete(key);
    }
    // Skip missed notes after a stall instead of replaying a burst off the beat.
    this.nextTick = Math.max(this.nextTick, nextGridTick(now, this.startedAt, 0));
    while (this.startedAt + this.nextTick * STEP_SECONDS < now + .085) {
      const step = mod(this.nextTick, LOOP_STEPS);
      const beat = this.nextTick / STEPS_PER_BEAT;
      if (this.loopEnabled) {
        for (const hit of this.pattern) {
          if (hit.step === step && beat - hit.createdBeat >= LOOP_BEATS) {
            this.scheduleHit(hit.sound, this.nextTick, 'loop');
          }
        }
      }
      this.nextTick++;
    }
  }

  voice(sound, when, beat) {
    const ctx = this.context;
    const tone = SOUNDS[sound];
    const noisy = tone.type === 'noise';
    const source = noisy ? ctx.createBufferSource() : ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const note = NOTES[Math.floor(mod(beat, SONG_BEATS) / 2) % NOTES.length];
    const f = frequency(note);
    const length = tone.duration;
    let filter;
    if (noisy) {
      if (!this.noiseBuffer) {
        this.noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .65), ctx.sampleRate);
        const samples = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      source.buffer = this.noiseBuffer;
      filter = ctx.createBiquadFilter();
      filter.type = sound === 5 ? 'highpass' : 'bandpass';
      filter.Q.value = .7;
      filter.frequency.setValueAtTime(sound === 5 ? 1700 : 800, when);
      if (sound === 7) filter.frequency.exponentialRampToValueAtTime(6000, when + length);
    } else {
      source.type = tone.type === 'roll' ? 'sine' : tone.type;
      if (sound === ROLL_SOUND) {
        for (let i = 0; i < 3; i++) {
          const time = when + i * BEAT / 4;
          source.frequency.setValueAtTime(280 - i * 35, time);
          source.frequency.exponentialRampToValueAtTime(75, time + .09);
        }
      } else if (sound === 4) {
        for (const [i, interval] of [1, 1.5, 2].entries()) {
          source.frequency.setValueAtTime(f * interval, when + i * BEAT / 8);
        }
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2600;
      } else {
        source.frequency.setValueAtTime(f * tone.pitch[0], when);
        source.frequency.exponentialRampToValueAtTime(f * tone.pitch[1], when + length * .6);
      }
    }
    gain.gain.setValueAtTime(0, when);
    if (sound === ROLL_SOUND) {
      for (let i = 0; i < 3; i++) {
        const time = when + i * BEAT / 4;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(tone.level * (1 - i * .2), time + .004);
        gain.gain.exponentialRampToValueAtTime(.001, time + .09);
      }
    } else {
      gain.gain.linearRampToValueAtTime(tone.level, when + .006);
      gain.gain.exponentialRampToValueAtTime(.001, when + length);
    }
    gain.gain.linearRampToValueAtTime(0, when + length + .01);
    panner.pan.value = tone.pan;
    if (filter) source.connect(filter).connect(gain);
    else source.connect(gain);
    gain.connect(panner).connect(this.limiter);
    source.start(when);
    source.stop(when + length + .02);
    const voice = { source, gain, when };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    return voice;
  }
}

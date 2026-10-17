import { BEAT, LOOP_BEATS, LOOP_STEPS, SONG_BEATS, STEPS_PER_BEAT, STEP_SECONDS, mod, nextGridTick, recordHit } from './rhythm.js';

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
    return Math.max(0, (this.context.currentTime - this.startedAt) / BEAT);
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateGain();
  }

  updateGain() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, .025);
  }

  tap(sound, position) {
    if (!this.playing || !Number.isInteger(sound) || sound < 0 || sound > 3) return false;
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
    const { oscillator, gain, when } = voice;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(when > now ? 0 : gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + .02);
    oscillator.stop(when > now ? now : now + .025);
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
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const note = NOTES[Math.floor(mod(beat, SONG_BEATS) / 2) % NOTES.length];
    const f = frequency(note);
    const length = [.32, .48, .25, .37][sound];
    oscillator.type = sound === 1 ? 'triangle' : 'sine';
    const begin = [f * 1.65, f * 2, f * .7, f * .5][sound];
    const end = [f, f * 2, f * .33, f * 2.5][sound];
    oscillator.frequency.setValueAtTime(begin, when);
    oscillator.frequency.exponentialRampToValueAtTime(end, when + length * .6);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(sound === 1 ? .16 : .28, when + .006);
    gain.gain.exponentialRampToValueAtTime(.001, when + length);
    gain.gain.linearRampToValueAtTime(0, when + length + .01);
    panner.pan.value = [-.13, .2, -.25, .25][sound];
    oscillator.connect(gain).connect(panner).connect(this.limiter);
    oscillator.start(when);
    oscillator.stop(when + length + .02);
    const voice = { oscillator, gain, when };
    this.voices.add(voice);
    oscillator.onended = () => { this.voices.delete(voice); oscillator.disconnect(); gain.disconnect(); panner.disconnect(); };
    return voice;
  }
}

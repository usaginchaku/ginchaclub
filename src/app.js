import { SoundEngine } from './audio.js';
import { UsaginchakuScene } from './scene.js';
import { LOOP_BEATS, STEPS_PER_BEAT, mod } from './rhythm.js';
import { SOUNDS } from './sounds.js';

const $ = selector => document.querySelector(selector);
const engine = new SoundEngine();
const scene = new UsaginchakuScene($('#scene'));
const pads = [...document.querySelectorAll('.pad')];
const dots = [...document.querySelectorAll('.beat-dots i')];
const loopBars = Array.from({ length: LOOP_BEATS }, () => {
  const bar = document.createElement('i');
  bar.setAttribute('aria-hidden', 'true');
  $('#loop-track').append(bar);
  return bar;
});
let selected = 0;
let starting = false;
let noticeTimer;
let lastBeat = -1;
let lifecycleGeneration = 0;

function notify(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 3500);
}

function updateTransport() {
  $('#play-label').textContent = starting ? '準備中…' : engine.playing ? 'ひとやすみ' : engine.offset ? 'つづける' : 'あそぶ';
  $('#play').disabled = starting;
  $('#play').setAttribute('aria-label', starting ? '曲を読み込み中' : engine.playing ? '曲を一時停止' : '曲を再生');
  $('#play-icon').innerHTML = engine.playing ? '<path d="M6 5h4v14H6Zm8 0h4v14h-4Z"/>' : '<path d="m9 5 11 7-11 7Z"/>';
  document.body.classList.toggle('is-playing', engine.playing);
}

async function ensurePlaying() {
  if (engine.playing) return true;
  if (starting) return false;
  const generation = lifecycleGeneration;
  starting = true;
  updateTransport();
  try {
    await engine.prepare();
    // A load may finish after the user has left the page or opened a dialog.
    if (generation !== lifecycleGeneration || document.hidden || $('#about').open) {
      await engine.context.suspend();
      return false;
    }
    engine.start();
    return true;
  } catch (error) {
    console.error('Audio could not start:', error);
    notify(error.name === 'TimeoutError' ? '曲の読み込みに時間がかかっています。もう一度お試しください。' : error.message || '音を再生できませんでした。もう一度お試しください。');
    return false;
  } finally {
    starting = false;
    updateTransport();
  }
}

function updatePattern() {
  for (let i = 0; i < loopBars.length; i++) {
    loopBars[i].classList.toggle('filled', engine.pattern.some(hit => Math.floor(hit.step / STEPS_PER_BEAT) === i));
  }
  $('#clear-loop').disabled = engine.pattern.length === 0;
}

function flashPad(sound) {
  pads[sound].classList.remove('hit');
  requestAnimationFrame(() => pads[sound].classList.add('hit'));
  clearTimeout(pads[sound].hitTimer);
  pads[sound].hitTimer = setTimeout(() => pads[sound].classList.remove('hit'), 130);
}

async function playHit(sound, position) {
  selected = sound;
  pads.forEach((pad, i) => {
    pad.classList.toggle('selected', i === selected);
    pad.setAttribute('aria-pressed', String(i === selected));
  });
  if (!await ensurePlaying()) return;
  engine.tap(sound, position);
  updatePattern();
}

async function togglePlayback() {
  if (starting) return;
  if (engine.playing) {
    engine.pause();
    updateTransport();
  } else await ensurePlaying();
}

$('#play').addEventListener('click', togglePlayback);
$('#stage').addEventListener('click', event => {
  const bounds = $('#stage').getBoundingClientRect();
  const position = event.detail === 0 ? undefined : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  playHit(selected, position);
});
pads.forEach((pad, i) => pad.addEventListener('click', () => playHit(i)));

function updateMute() {
  const silent = engine.muted || engine.volume === 0;
  $('#mute').setAttribute('aria-label', silent ? 'ミュートを解除' : 'ミュート');
  $('#mute').setAttribute('aria-pressed', String(silent));
  $('#mute svg').innerHTML = silent ? '<path d="m11 4-5 5H3v6h3l5 5ZM16 9l6 6m0-6-6 6"/>' : '<path d="m11 4-5 5H3v6h3l5 5ZM16 8q4 4 0 8m3-11q7 7 0 14"/>';
}
$('#volume').addEventListener('input', event => {
  engine.muted = false;
  engine.setVolume(Number(event.target.value) / 100);
  updateMute();
});
$('#mute').addEventListener('click', () => {
  if (engine.volume === 0) {
    engine.setVolume(.65);
    $('#volume').value = 65;
    engine.muted = false;
  } else engine.muted = !engine.muted;
  engine.updateGain();
  updateMute();
});
$('#loop').addEventListener('click', () => {
  engine.setLoopEnabled(!engine.loopEnabled);
  $('#loop').setAttribute('aria-pressed', String(engine.loopEnabled));
  $('#loop-track').classList.toggle('enabled', engine.loopEnabled);
  lastBeat = -1;
});
$('#clear-loop').addEventListener('click', () => {
  engine.clearPattern();
  updatePattern();
  notify('重ねた音を消しました。');
});

$('#about-button').addEventListener('click', () => {
  lifecycleGeneration++;
  $('#about').showModal();
});
$('#close-about').addEventListener('click', () => $('#about').close());
$('#about').addEventListener('click', event => {
  if (event.target !== $('#about')) return;
  const bounds = $('#about').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('#about').close();
});

document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || $('#about').open) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.code === 'Space') {
    // Focused buttons keep their native Space activation; the page shortcut is
    // only used outside controls, avoiding an accidental play+tap double action.
    if (event.target instanceof HTMLElement && event.target.closest('button, a')) return;
    event.preventDefault();
    togglePlayback();
  } else {
    const sound = SOUNDS.findIndex(tone => tone.key === event.code);
    if (sound !== -1) { event.preventDefault(); playHit(sound); }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    lifecycleGeneration++;
    engine.pause();
    updateTransport();
  }
});
window.addEventListener('pagehide', () => { lifecycleGeneration++; engine.pause(); });

function frame(timestamp) {
  const beat = engine.beat;
  const wholeBeat = Math.floor(beat);
  if (wholeBeat !== lastBeat || !engine.playing) {
    dots.forEach((dot, i) => dot.classList.toggle('active', engine.playing && i === mod(wholeBeat, 4)));
    loopBars.forEach((bar, i) => bar.classList.toggle('current', engine.playing && engine.loopEnabled && i === mod(wholeBeat, LOOP_BEATS)));
    lastBeat = wholeBeat;
  }
  if (engine.playing) {
    const audibleTime = engine.playbackTime;
    while (engine.visualHits.length && engine.visualHits[0].when <= audibleTime) {
      const hit = engine.visualHits.shift();
      scene.hit(hit.sound, hit.position?.x, hit.position?.y);
      flashPad(hit.sound);
    }
  }
  pads.forEach((pad, sound) => pad.classList.toggle('queued', engine.visualHits.some(hit => hit.kind === 'live' && hit.sound === sound)));
  scene.draw(beat, engine.playing, timestamp / 1000);
  requestAnimationFrame(frame);
}
updateTransport();
requestAnimationFrame(frame);

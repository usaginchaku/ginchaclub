export const BPM = 128;
export const BEAT = 60 / BPM;
export const SONG_BEATS = 128;
export const LOOP_BEATS = 16;
// Live notes land on the same quarter-note pulse as the backing track's kick.
export const STEPS_PER_BEAT = 1;
export const STEP_SECONDS = BEAT / STEPS_PER_BEAT;
export const LOOP_STEPS = LOOP_BEATS * STEPS_PER_BEAT;
export const mod = (value, length) => ((value % length) + length) % length;

export function loopStep(beat) {
  return mod(Math.round(beat * STEPS_PER_BEAT), LOOP_STEPS);
}

// Schedule ahead on the song's clock, including the very first tap. A small
// lead gives Web Audio time to queue the note without moving it off the grid.
export function nextGridTick(now, origin, lead = .006) {
  return Math.max(0, Math.ceil((now + lead - origin) / STEP_SECONDS - 1e-9));
}

export function sectionAt(beat) {
  const bar = Math.floor(mod(beat, SONG_BEATS) / 4);
  if (bar < 4) return 'INTRO · はじまるよ';
  if (bar < 12) return 'POYO · ぽよぽよ';
  if (bar < 16) return 'FLOAT · ふわふわ';
  if (bar < 20) return 'BUILD · もうすぐ！';
  if (bar < 28) return 'POP! · はじけよう';
  return 'AGAIN · もういっかい';
}

// Keep only the latest hit of each voice in a slot: rapid taps cannot accumulate
// unbounded polyphony, and different voices can still form a chord.
export function recordHit(pattern, beat, sound) {
  const step = loopStep(beat);
  const previous = pattern.findIndex(hit => hit.step === step && hit.sound === sound);
  const hit = { step, sound, createdBeat: beat };
  if (previous < 0) pattern.push(hit);
  else pattern[previous] = hit;
  return hit;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_STEPS, STEP_SECONDS, loopStep, nextGridTick, recordHit, sectionAt } from '../src/rhythm.js';

test('sixteenth-note quantization wraps into the four-bar loop', () => {
  assert.equal(loopStep(0), 0);
  assert.equal(loopStep(.26), 1);
  assert.equal(loopStep(15.9), 0);
  assert.equal(loopStep(16.5), 2);
  assert.equal(loopStep(1000000.5), 2);
});
test('future grid includes the first note and handles exact subdivision boundaries', () => {
  assert.equal(nextGridTick(0, .025), 0);
  assert.equal(nextGridTick(STEP_SECONDS - .006, 0), 1);
  assert.equal(nextGridTick(STEP_SECONDS, 0), 2);
  assert.equal(nextGridTick(STEP_SECONDS, 0, 0), 1);
});
test('rapid overdubs cannot grow beyond four voices per step', () => {
  const pattern = [];
  for (let i = 0; i < 5000; i++) recordHit(pattern, i * .5, i % 4);
  assert.ok(pattern.length <= LOOP_STEPS * 4);
  recordHit(pattern, 0, 0);
  recordHit(pattern, 16, 0);
  assert.equal(pattern.filter(p => p.step === 0 && p.sound === 0).length, 1);
  assert.equal(pattern.find(p => p.step === 0 && p.sound === 0).createdBeat, 16);
});
test('arrangement labels follow the rendered score and wrap after 60 seconds', () => {
  assert.match(sectionAt(0), /INTRO/);
  assert.match(sectionAt(16), /POYO/);
  assert.match(sectionAt(48), /FLOAT/);
  assert.match(sectionAt(64), /BUILD/);
  assert.match(sectionAt(80), /POP!/);
  assert.match(sectionAt(112), /AGAIN/);
  assert.equal(sectionAt(128), sectionAt(0));
});

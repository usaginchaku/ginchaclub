export const ROLL_SOUND = 6;

// Pad order, keyboard shortcuts and visual reactions share the same sound IDs.
export const SOUNDS = [
  { label: 'ぽよ', key: 'KeyA', color: '#ed719c', face: 0, type: 'sine', duration: .32, level: .28, pitch: [1.65, 1], pan: -.13 },
  { label: 'きら', key: 'KeyS', color: '#ba8e43', face: 1, type: 'triangle', duration: .48, level: .16, pitch: [2, 2], pan: .2 },
  { label: 'ぷく', key: 'KeyD', color: '#59a99a', face: 2, type: 'sine', duration: .25, level: .28, pitch: [.7, .33], pan: -.25 },
  { label: 'ぴゅん', key: 'KeyF', color: '#9882bd', face: 3, type: 'sine', duration: .37, level: .25, pitch: [.5, 2.5], pan: .25 },
  { label: 'ぴこ', key: 'KeyG', color: '#6889b8', face: 0, type: 'square', duration: .28, level: .10, pitch: [1, 2], pan: -.1 },
  { label: 'ぱち', key: 'KeyH', color: '#cc8962', face: 1, type: 'noise', duration: .16, level: .30, pan: .03 },
  { label: 'ころころ', key: 'KeyJ', color: '#a57b57', face: 0, type: 'roll', duration: .38, level: .25, pan: 0 },
  { label: 'しゅわ', key: 'KeyK', color: '#69a7b1', face: 2, type: 'noise', duration: .60, level: .13, pan: .15 },
];

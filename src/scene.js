const INK = '#635550';
const WHITE = '#fffdfb';
const RIBBON = '#ed719c';
const COLORS = [RIBBON, '#ba8e43', '#59a99a', '#9882bd'];

// Parts are separate so the pouch, ears and little limbs can follow the beat.
const EAR_LEFT = new Path2D('M-69-88C-83-133-87-190-61-205C-32-222-5-203-3-172L-1-91Z');
const EAR_RIGHT = new Path2D('M0-91L2-172C3-201 26-219 53-204C79-189 78-134 66-88Z');
const BAG = new Path2D('M-91-68C-118-82-126-113-106-120C-89-126-77-110-68-102C-41-123-17-126-3-107C20-126 42-118 51-102C75-115 99-116 106-101C113-86 106-74 94-67C116-48 132-18 128 18C123 64 85 81 2 82C-80 84-122 64-129 24C-135-13-116-47-91-68Z');
const HAND = new Path2D('M0-12C-24-38-42-26-40-6C-36 12-22 20 0 17Z');
const FOOT = new Path2D('M-21-9C-27 18-18 35 0 34C19 34 25 17 22-10Z');

export class UsaginchakuScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.particles = [];
    this.impulseAt = -100;
    this.impulseSound = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  hit(sound, x = this.width / 2, y = this.height * .55) {
    const now = performance.now() / 1000;
    this.impulseAt = now;
    this.impulseSound = sound;
    if (!this.reduced.matches) {
      for (let i = 0; i < 10; i++) {
        const angle = Math.PI * 2 * i / 10;
        this.particles.push({
          x, y, vx: Math.cos(angle) * (70 + Math.random() * 55),
          vy: Math.sin(angle) * 90 - 50, born: now, sound, r: 2 + Math.random() * 4,
        });
      }
      this.particles = this.particles.slice(-80);
    }
  }

  star(x, y, radius, color, rotation = 0) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    c.fillStyle = color;
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const r = i % 2 ? radius * .28 : radius;
      if (!i) c.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else c.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    c.closePath();
    c.fill();
    c.restore();
  }

  part(path, x = 0, y = 0, rotation = 0, mirror = 1) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    c.scale(mirror, 1);
    c.fill(path);
    c.stroke(path);
    c.restore();
  }

  ribbon(sway) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = RIBBON;
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(-78, -76); c.quadraticCurveTo(-69, -72, -60, -73);
    c.moveTo(-42, -70); c.quadraticCurveTo(-34, -68, -27, -69);
    c.moveTo(-9, -69); c.quadraticCurveTo(0, -67, 9, -70);
    c.stroke();
    c.translate(68, -66);
    c.rotate(.12 + sway);
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(-14, -40, -43, -34, -33, -12);
    c.bezierCurveTo(-27, 2, -9, 6, 0, 0);
    c.bezierCurveTo(19, -28, 44, -17, 32, -3);
    c.bezierCurveTo(24, 5, 10, 7, 0, 0);
    c.moveTo(-1, 3); c.quadraticCurveTo(-5, 25, -23, 25);
    c.moveTo(2, 3); c.quadraticCurveTo(12, 27, 29, 24);
    c.stroke();
    c.restore();
  }

  face(expression, blink) {
    const c = this.ctx;
    c.save();
    c.translate(0, -9);
    c.scale(1.15, .95);
    c.fillStyle = '#f6b7cb';
    c.beginPath();
    c.ellipse(-62, 33, 13, 8, -.1, 0, Math.PI * 2);
    c.ellipse(62, 33, 13, 8, .1, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 7;
    c.beginPath();
    if (expression === 0) {
      c.moveTo(-47, -5); c.lineTo(-28, 5); c.lineTo(-46, 16);
      c.moveTo(47, -5); c.lineTo(28, 5); c.lineTo(46, 16);
    } else if (expression === 3) {
      for (const x of [-38, 38]) {
        c.moveTo(x + 15, 5);
        for (let a = 0; a <= Math.PI * 3.5; a += .12) {
          const r = 15 * (1 - a / (Math.PI * 4));
          c.lineTo(x + Math.cos(a) * r, 5 + Math.sin(a) * r);
        }
      }
    } else {
      if (blink) { c.moveTo(-46, 5); c.lineTo(-30, 5); }
      else { c.moveTo(-38, -4); c.lineTo(-38, 13); }
      if (expression === 1) {
        c.moveTo(29, 6); c.quadraticCurveTo(38, -7, 48, 6);
      } else if (blink) { c.moveTo(30, 5); c.lineTo(46, 5); }
      else { c.moveTo(38, -4); c.lineTo(38, 13); }
    }
    c.stroke();
    c.beginPath();
    if (expression === 0) {
      c.moveTo(-21, 32);
      c.quadraticCurveTo(0, 30, 21, 32);
      c.quadraticCurveTo(14, 64, 0, 62);
      c.quadraticCurveTo(-15, 60, -21, 32);
      c.fillStyle = RIBBON; c.fill(); c.stroke();
    } else if (expression === 2) {
      c.ellipse(0, 39, 10, 13, 0, 0, Math.PI * 2);
      c.fillStyle = RIBBON; c.fill(); c.stroke();
    } else {
      c.moveTo(-17, 33);
      c.quadraticCurveTo(0, 53, 18, 33);
      c.stroke();
    }
    c.restore();
  }

  mascot(cx, cy, scale, beat, playing, now) {
    const c = this.ctx;
    const reduced = this.reduced.matches;
    const age = now - this.impulseAt;
    const reacting = age >= 0 && age < .55;
    const impulse = reacting && !reduced ? Math.sin(age / .55 * Math.PI) * Math.exp(-age * 3) : 0;
    const phase = beat % 1;
    const bounce = playing && !reduced ? Math.sin(phase * Math.PI) : 0;
    const sway = reduced ? 0 : playing ? Math.sin(beat * Math.PI) : Math.sin(now * 1.5) * .22;
    const squash = reduced ? 0 : playing ? Math.cos(phase * Math.PI * 2) * .035 - impulse * .07 : sway * .018;
    c.fillStyle = '#8e62721b';
    c.beginPath();
    c.ellipse(cx, cy + 113 * scale, (101 - bounce * 9) * scale, 13 * scale, 0, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(cx, cy - (bounce * 13 + impulse * 28) * scale);
    c.scale(scale, scale);
    c.rotate(sway * .035 + impulse * (this.impulseSound % 2 ? -.07 : .07));
    c.scale(1 + squash, 1 - squash);
    c.fillStyle = WHITE;
    c.strokeStyle = INK;
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // Sway the ears together so the close inner edges stay joined while dancing.
    c.save();
    c.rotate(sway * .012);
    this.part(EAR_LEFT);
    this.part(EAR_RIGHT);
    c.restore();
    this.part(FOOT, -43, 76, sway * .08);
    this.part(FOOT, 41, 76, -sway * .08);
    this.part(HAND, -116, 18, .18 + bounce * .18 + impulse * .8);
    this.part(HAND, 116, 20, -.18 - bounce * .18 - impulse * .8, -1);
    this.part(BAG);
    this.ribbon(sway * .025 + impulse * .1);
    this.face(reacting ? this.impulseSound : -1, Math.sin(now * .73) > .997);
    c.restore();
  }

  draw(beat, playing, now) {
    const c = this.ctx, w = this.width, h = this.height;
    c.clearRect(0, 0, w, h);
    const scale = Math.min(w / 380, h / 470, 1.45);
    const cx = w / 2, cy = h / 2 + 42 * scale;
    c.fillStyle = '#fff5f5';
    c.beginPath();
    c.ellipse(cx, h / 2, 172 * scale, 180 * scale, 0, 0, Math.PI * 2);
    c.fill();
    const drift = this.reduced.matches ? 0 : Math.sin(now * .8) * 3;
    this.star(cx - 153 * scale, cy - 100 * scale + drift, 9 * scale, '#cc91a6', .15);
    this.star(cx + 147 * scale, cy - 164 * scale - drift, 12 * scale, '#c58aa2', -.15);
    this.star(cx + 156 * scale, cy + 43 * scale, 5 * scale, '#c58aa2');
    this.mascot(cx, cy, scale, beat, playing, now);
    this.particles = this.particles.filter(p => now - p.born < .7);
    for (const p of this.particles) {
      const age = now - p.born;
      c.globalAlpha = Math.max(0, 1 - age / .7);
      const x = p.x + p.vx * age, y = p.y + p.vy * age + 90 * age * age;
      if (p.sound === 1) this.star(x, y, p.r * 1.7, COLORS[p.sound], age * 2);
      else {
        c.fillStyle = COLORS[p.sound]; c.beginPath();
        c.arc(x, y, p.r, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1;
  }
}

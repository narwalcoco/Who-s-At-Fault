'use strict';

/* ================= Ultimate Spinner =================
   100% legitimate random spin…
   until it isn't. 😈 */

// ---------- Element refs ----------
const $ = (id) => document.getElementById(id);
const namesInput = $('namesInput');
const spinBtn = $('spinBtn');
const countLabel = $('countLabel');
const wheelCanvas = $('wheel');
const wheelWrap = $('wheelWrap');
const pointer = $('pointer');
const muteBtn = $('muteBtn');
const resultOverlay = $('resultOverlay');
const resultEmoji = $('resultEmoji');
const resultTitle = $('resultTitle');
const resultSubtitle = $('resultSubtitle');
const againBtn = $('againBtn');
const closeResultBtn = $('closeResultBtn');
const customOverlay = $('customOverlay');
const customNameInput = $('customNameInput');
const saveCustomBtn = $('saveCustomBtn');
const resetCustomBtn = $('resetCustomBtn');
const closeCustomBtn = $('closeCustomBtn');
const toastEl = $('toast');
const confettiCanvas = $('confettiCanvas');

const ctx = wheelCanvas.getContext('2d');
const confettiCtx = confettiCanvas.getContext('2d');

// ---------- Constants ----------
const POINTER_ANGLE = -Math.PI / 2;          // pointer sits at the top (12 o'clock)
const PALETTE = [
  '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#14b8a6', '#a855f7', '#f97316', '#22c55e',
  '#eab308', '#06b6d4', '#f43f5e', '#84cc16', '#d946ef',
  '#0ea5e9'
];

// ---------- State ----------
let segments = [];        // [{ label, color, start, end }] — angles in wheel-local space
let currentRotation = 0;  // radians applied to the wheel
let isSpinning = false;
let muted = false;

// ---------- Utilities ----------
const rand = (min, max) => Math.random() * (max - min) + min;
const mod2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents (Aáhil -> aahil)
    .replace(/[^a-z0-9]/g, '');       // strip spaces, hyphens, digits-ish noise
}

const isRiggedName = (label) => normalize(label) === normalize(riggedName);
const isRiggedNameLoose = (label) => {
  const n = normalize(label);
  return n.startsWith(normalize(riggedName)) || normalize(riggedName).startsWith(n);
};

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------- Sound engine (WebAudio — no files needed) ----------
let audioCtx = null;
function ac() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone({ freq = 440, dur = 0.1, type = 'sine', vol = 0.2, delay = 0, sweepTo = null }) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const sfx = {
  tick() { tone({ freq: 1900, dur: 0.035, type: 'square', vol: 0.05 }); },
  whoosh() { tone({ freq: 160, dur: 0.5, type: 'sawtooth', vol: 0.06, sweepTo: 520 }); },
  slowTick() { tone({ freq: 1300, dur: 0.05, type: 'square', vol: 0.07 }); },
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.16, delay: i * 0.09 }));
  },
  evil() {
    [392.0, 369.99, 349.23, 329.63].forEach((f, i) =>
      tone({ freq: f, dur: 0.34, type: 'sawtooth', vol: 0.12, delay: i * 0.16 }));
    tone({ freq: 110, dur: 1.4, type: 'sawtooth', vol: 0.1, delay: 0.62, sweepTo: 55 });
  }
};

// ---------- Wheel drawing ----------
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  // Use layout size (offsetWidth/Height): getBoundingClientRect is affected by
  // the spin rotation, which would corrupt the buffer size mid-spin.
  const w = wheelCanvas.offsetWidth || 300;
  const h = wheelCanvas.offsetHeight || 300;
  wheelCanvas.width = Math.round(w * dpr);
  wheelCanvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const crect = confettiCanvas.getBoundingClientRect();
  confettiCanvas.width = Math.round(crect.width * dpr);
  confettiCanvas.height = Math.round(crect.height * dpr);
  confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawWheel();
}

function drawWheel() {
  const W = wheelCanvas.offsetWidth;
  const H = wheelCanvas.offsetHeight;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 4;

  ctx.clearRect(0, 0, W, H);
  if (!segments.length) return;

  const n = segments.length;
  const step = (2 * Math.PI) / n;
  const fontSize = n <= 4 ? 18 : n <= 8 ? 15 : n <= 14 ? 12 : 10;

  segments.forEach((seg, i) => {
    const a0 = i * step - Math.PI / 2; // wheel-local: slice 0 starts at top
    const a1 = a0 + step;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10, 6, 20, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    const mid = a0 + step / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontSize}px Fredoka, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 4;
    const label = seg.label.length > 14 ? seg.label.slice(0, 13) + '…' : seg.label;
    ctx.fillText(label, R - 14, 0);
    ctx.restore();
  });

  // Hub
  const hub = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  hub.addColorStop(0, '#fdf6e3');
  hub.addColorStop(1, '#c9b98a');
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, 2 * Math.PI);
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function buildSegments() {
  const raw = namesInput.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  segments = raw.map((label, i) => ({ label, color: PALETTE[i % PALETTE.length] }));
  currentRotation = mod2pi(currentRotation); // keep rotation, remap to new layout
  drawWheel();
  updateCountLabel();
}

function updateCountLabel() {
  const n = segments.length;
  countLabel.classList.remove('warn');
  if (!n) {
    countLabel.textContent = 'Add some names to get started!';
    countLabel.classList.add('warn');
  } else if (n === 1) {
    countLabel.textContent = '1 name on the wheel. This one’s easy!';
  } else {
    countLabel.textContent = `${n} slices, evenly spaced. Good luck!`;
  }
}

// ---------- Spin mechanics ----------
// index of the slice currently under the pointer (top), given wheel rotation
function indexAtPointer() {
  const n = segments.length;
  if (!n) return -1;
  const local = mod2pi(POINTER_ANGLE - currentRotation); // wheel-local angle at pointer
  const step = (2 * Math.PI) / n;
  return Math.floor(mod2pi(local + Math.PI / 2) / step) % n;
}

function angleForIndex(i) {
  // rotation that puts slice i's center under the top pointer
  const n = segments.length;
  const step = (2 * Math.PI) / n;
  return mod2pi(POINTER_ANGLE - (i * step + step / 2 - Math.PI / 2));
}

function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

function animateRotation(from, to, dur, onTick, onDone) {
  const t0 = performance.now();
  let lastIdx = indexAtPointer();
  let lastTickT = -1;

  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    currentRotation = from + (to - from) * easeOutQuart(t);
    wheelCanvas.style.transform = `rotate(${currentRotation}rad)`;

    onTick && onTick(t);

    const idx = indexAtPointer();
    if (idx !== lastIdx && !muted) {
      if (t < 0.75) sfx.tick();
      else if (t - lastTickT > 0.02) sfx.slowTick();
      lastTickT = t;
      pointer.style.transform = `translateX(-50%) rotate(${rand(-16, -4)}deg)`;
      setTimeout(() => { pointer.style.transform = 'translateX(-50%)'; }, 55);
    }
    lastIdx = idx;

    if (t < 1) requestAnimationFrame(frame);
    else { pointer.style.transform = 'translateX(-50%)'; onDone && onDone(); }
  }
  requestAnimationFrame(frame);
}

function setSpinningUI(on) {
  isSpinning = on;
  spinBtn.disabled = on;
  spinBtn.textContent = on ? '💫 Spinning…' : '🎲 Spin';
  wheelWrap.classList.toggle('spinning', on);
}

function spin() {
  if (isSpinning) return;
  ac(); // unlock audio on user gesture

  // No names? The wheel provides. One slice — and you already know whose. 😈
  if (!segments.length) {
    segments = [{ label: riggedName, color: PALETTE[0] }];
    drawWheel();
    updateCountLabel();
    setSpinningUI(true);
    if (!muted) sfx.whoosh();
    const rotations = rand(4, 10) * 2 * Math.PI;
    const target = currentRotation + rotations + mod2pi(angleForIndex(0) - currentRotation);
    animateRotation(currentRotation, target, rand(3800, 4800), null, () => {
      setSpinningUI(false);
      showResult(riggedName, true);
    });
    return;
  }

  setSpinningUI(true);
  if (!muted) sfx.whoosh();

  // --- The honest part: a truly random result, 4–10 full rotations ---
  const n = segments.length;
  const legitIndex = Math.floor(Math.random() * n);
  const base = angleForIndex(legitIndex);
  const jitter = rand(-0.25, 0.25) * ((2 * Math.PI) / n); // lands near the slice's center
  const rotations = rand(4, 10) * 2 * Math.PI;            // 4–10 full turns
  const target = currentRotation + rotations + mod2pi(base + jitter - currentRotation);
  const duration = rand(5200, 6800);

  animateRotation(currentRotation, target, duration, null, () => {
    // Linger on the "winner" for a suspenseful beat — no popup, no hints —
    // then the wheel remembers what it's really here for. 😈
    setTimeout(() => {
      let riggedIndex = segments.findIndex((s) => isRiggedNameLoose(s.label));
      if (riggedIndex === -1) {
        // Name not on the wheel? The wheel quietly adds it, in a totally ordinary color.
        segments = [...segments, { label: riggedName, color: PALETTE[segments.length % PALETTE.length] }];
        riggedIndex = segments.length - 1;
        updateCountLabel();
        drawWheel();
      }

      const rBase = angleForIndex(riggedIndex);
      // Snap: shortest forward path to the chosen slice — no extra full turns,
      // same easing/ticks as a normal spin, just quicker.
      const forward = mod2pi(rBase - currentRotation);
      const rTarget = currentRotation + forward;
      const rDur = 650 + (forward / (2 * Math.PI)) * 750; // ~0.65–1.4s, scales with distance
      if (!muted) sfx.whoosh();
      animateRotation(currentRotation, rTarget, rDur, null, () => {
        setSpinningUI(false);
        showResult(segments[riggedIndex].label, true);
      });
    }, 0);
  });
}

// ---------- Result popup ----------
let resultTimer = null;
function showResult(label, rigged, autoCloseMs = 0) {
  clearTimeout(resultTimer);
  if (rigged) {
    resultEmoji.textContent = '😈';
    resultTitle.textContent = `It was ${label}'s fault!`;
    resultTitle.classList.add('rigged');
    resultTitle.classList.remove('fair');
    resultSubtitle.textContent = 'The wheel has spoken. The wheel is never wrong.';
    if (!muted) sfx.evil();
    launchConfetti(['#ff2d78', '#ec4899', '#a855f7', '#fbbf24']);
  } else {
    resultEmoji.textContent = '🎉';
    resultTitle.textContent = `${label} wins!`;
    resultTitle.classList.add('fair');
    resultTitle.classList.remove('rigged');
    resultSubtitle.textContent = 'Congratulations!';
    if (!muted) sfx.win();
    launchConfetti(['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa']);
  }
  resultOverlay.classList.add('show');
  if (autoCloseMs) resultTimer = setTimeout(hideResult, autoCloseMs);
}

function hideResult() { resultOverlay.classList.remove('show'); }

// ---------- Confetti ----------
let confettiPieces = [];
let confettiRunning = false;

function launchConfetti(colors) {
  const W = confettiCanvas.width / (window.devicePixelRatio || 1);
  const H = confettiCanvas.height / (window.devicePixelRatio || 1);
  for (let i = 0; i < 90; i++) {
    confettiPieces.push({
      x: rand(0, W),
      y: rand(-H * 0.4, 0),
      w: rand(5, 10),
      h: rand(8, 15),
      vy: rand(1.6, 4.2),
      vx: rand(-1.1, 1.1),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.14, 0.14),
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }
  if (!confettiRunning) {
    confettiRunning = true;
    requestAnimationFrame(confettiFrame);
  }
}

function confettiFrame() {
  const W = confettiCanvas.width / (window.devicePixelRatio || 1);
  const H = confettiCanvas.height / (window.devicePixelRatio || 1);
  confettiCtx.clearRect(0, 0, W, H);
  confettiPieces = confettiPieces.filter((p) => p.y < H + 20);
  confettiPieces.forEach((p) => {
    p.y += p.vy;
    p.x += p.vx;
    p.rot += p.vr;
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rot);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    confettiCtx.restore();
  });
  if (confettiPieces.length) {
    requestAnimationFrame(confettiFrame);
  } else {
    confettiRunning = false;
    confettiCtx.clearRect(0, 0, W, H);
  }
}

// ---------- Secret "custom" code ----------
const TRIGGER = 'custom';
let keyBuffer = '';
// Keys whose keydown already fed the buffer, so keyup doesn't double-count
// (fast/rollover typing would otherwise break the sequence).
const pendingKeys = new Map();

const DEFAULT_NAME = 'Aahil';
let riggedName = DEFAULT_NAME; // reset to Aahil on every page load / refresh

function openCustomModal() {
  customNameInput.value = riggedName;
  customOverlay.classList.add('show');
  setTimeout(() => customNameInput.focus(), 120);
}

function saveCustom() {
  const val = customNameInput.value.trim();
  riggedName = val || DEFAULT_NAME;
  customOverlay.classList.remove('show');
  toast(`🤫 The wheel now blames ${riggedName}. Our secret.`);
}

document.addEventListener('keydown', (e) => {
  const target = e.target;
  const inTextField =
    (target.tagName === 'INPUT' && target.type !== 'checkbox' && target.type !== 'radio') ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable;

  if (inTextField) return; // typing "custom" in the box does NOT trigger it
  if (customOverlay.classList.contains('show')) {
    if (e.key === 'Escape') customOverlay.classList.remove('show');
    return;
  }
  if (resultOverlay.classList.contains('show')) {
    if (e.key === 'Enter') { hideResult(); if (segments.length) spin(); }
    else if (e.key === 'Escape') hideResult();
    return;
  }

  if (e.key === 'Escape') return;
  if (e.key.length !== 1 || e.repeat) return;

  pendingKeys.set(e.key, (pendingKeys.get(e.key) || 0) + 1);
  keyBuffer = (keyBuffer + e.key.toLowerCase()).slice(-TRIGGER.length);
  if (keyBuffer === TRIGGER) {
    keyBuffer = '';
    e.preventDefault();
    openCustomModal();
  }
});

// Mobile fallback: some keyboards only report real characters on keyup.
// Keys already counted by keydown are skipped, so nothing is doubled.
document.addEventListener('keyup', (e) => {
  const target = e.target;
  const inTextField =
    (target.tagName === 'INPUT' && target.type !== 'checkbox' && target.type !== 'radio') ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable;
  if (inTextField) return;
  if (customOverlay.classList.contains('show') || resultOverlay.classList.contains('show')) return;
  if (e.key.length !== 1) return;
  const pending = pendingKeys.get(e.key) || 0;
  if (pending > 0) {
    pendingKeys.set(e.key, pending - 1);
    return; // keydown already counted this key
  }
  keyBuffer = (keyBuffer + e.key.toLowerCase()).slice(-TRIGGER.length);
  if (keyBuffer === TRIGGER) {
    keyBuffer = '';
    openCustomModal();
  }
});

// ---------- Events ----------
namesInput.addEventListener('input', buildSegments);
spinBtn.addEventListener('click', spin);
namesInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') spin(); });
againBtn.addEventListener('click', () => { hideResult(); spin(); });
closeResultBtn.addEventListener('click', hideResult);
resultOverlay.addEventListener('click', (e) => { if (e.target === resultOverlay) hideResult(); });
saveCustomBtn.addEventListener('click', saveCustom);
customNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCustom(); });
resetCustomBtn.addEventListener('click', () => {
  customNameInput.value = DEFAULT_NAME;
  riggedName = DEFAULT_NAME;
  toast('Reset to Aahil. As it should be. 😌');
});
closeCustomBtn.addEventListener('click', () => customOverlay.classList.remove('show'));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-pressed', String(muted));
  if (!muted) { ac(); tone({ freq: 880, dur: 0.08, vol: 0.1 }); }
});
window.addEventListener('resize', sizeCanvas);

// ---------- Boot ----------
sizeCanvas();
buildSegments();
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(drawWheel); // redraw labels once Fredoka is loaded
}

// PIVOT — Manage your founding team through every pivot.
// Joystick L/R: navigate chars  B1: select/transfer  B2: discard  B3: expand  B4: compress  START: restart

const W = 800, H = 600;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;
canvas.style.display = 'block';
canvas.style.position = 'absolute';
canvas.style.left = '50%';
canvas.style.top = '50%';
canvas.style.transformOrigin = 'center';
(document.getElementById('game-root') || document.body || document.documentElement).appendChild(canvas);

function scaleCanvas() {
  const scaleX = (window.innerWidth || 800) / W;
  const scaleY = (window.innerHeight || 600) / H;
  const s = Math.min(scaleX, scaleY);
  canvas.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
}
scaleCanvas();
window.addEventListener('resize', scaleCanvas);

// ─── ELEMENT SCALE (B5=larger, B6=smaller, persists across levels) ────────────
let elemScale = 2.0; // default: 2x current. range 1.0–3.0, step 0.5

// ─── CABINET KEYS ─────────────────────────────────────────────────────────────
// DO NOT replace existing keys — they match the physical arcade cabinet wiring.
const CABINET_KEYS = {
  P1_U: ['w'], P1_D: ['s'], P1_L: ['a'], P1_R: ['d'],
  P1_1: ['u'], P1_2: ['i'], P1_3: ['o'], P1_4: ['j'], P1_5: ['k'], P1_6: ['l'],
  P2_U: ['ArrowUp'], P2_D: ['ArrowDown'], P2_L: ['ArrowLeft'], P2_R: ['ArrowRight'],
  P2_1: ['r'], P2_2: ['t'], P2_3: ['y'], P2_4: ['f'], P2_5: ['g'], P2_6: ['h'],
  START1: ['Enter'], START2: ['2'],
};
const KEY_TO_ARC = {};
for (const [code, keys] of Object.entries(CABINET_KEYS))
  for (const k of keys) KEY_TO_ARC[k] = code;

const keyQueue = [];
const keysDown = new Set();
window.addEventListener('keydown', e => {
  const c = KEY_TO_ARC[e.key] || KEY_TO_ARC[e.key.toLowerCase()];
  if (!c) return;
  e.preventDefault();
  if (!keysDown.has(c)) { keysDown.add(c); keyQueue.push(c); }
});
window.addEventListener('keyup', e => {
  const c = KEY_TO_ARC[e.key] || KEY_TO_ARC[e.key.toLowerCase()];
  if (c) keysDown.delete(c);
});

let navRepeatTimer = 0;
let navRepeatDir = null;
const NAV_INITIAL = 18, NAV_REPEAT = 7;

function drainKeys() {
  const q = [...keyQueue]; keyQueue.length = 0;
  const dir = keysDown.has('P1_L') ? 'P1_L' : keysDown.has('P1_R') ? 'P1_R' : null;
  if (dir) {
    if (dir !== navRepeatDir) { navRepeatDir = dir; navRepeatTimer = 0; }
    navRepeatTimer++;
    if (navRepeatTimer === NAV_INITIAL ||
        (navRepeatTimer > NAV_INITIAL && (navRepeatTimer - NAV_INITIAL) % NAV_REPEAT === 0))
      q.push(dir);
  } else {
    navRepeatDir = null;
    navRepeatTimer = 0;
  }
  return q;
}

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const C = {
  bg:       '#0a0a0a',
  lane:     '#111111',
  laneEdge: '#1e1e1e',
  dim:      '#222222',
  mid:      '#444444',
  bright:   '#cccccc',
  white:    '#f0f0f0',
  accent:   '#e8c547',
  danger:   '#e84747',
  ok:       '#47e8a0',
  pieces:   ['#5b9bd5', '#e8944a', '#a47de8', '#e85b8a'],
};

const SHAPES = [
  [[0,1,0],[1,1,1],[0,1,0]],
  [[1,1,0],[1,1,0],[0,0,0]],
  [[1,0,0],[1,1,0],[0,1,0]],
  [[0,1,0],[1,1,0],[1,0,0]],
  [[0,0,1],[1,1,1],[0,0,0]],
];

const ROLES = ['CTO', 'DSN', 'FND', 'SLS'];
const ROLE_SYMBOLS = ['\u2b21', '\u25c8', '\u25b2', '\u25c9'];

let state;

function assignNeededPieces() {
  const subdiv = state.form[state.currentSubdiv];
  if (!subdiv) return;
  state.chars.forEach((c, i) => {
    if (c.collapseLevel < 2) c.slotNeeded = subdiv.pieces[i];
    else c.slotNeeded = null;
    c.slot = null;
  });
}

const LEVELS = [
  { subdivs: 3, timerSecs: 25, pieceInterval: 160, fallSpeed: [0.7, 1.1], label: 'WARMUP'   },
  { subdivs: 4, timerSecs: 22, pieceInterval: 140, fallSpeed: [0.9, 1.3], label: 'FORMING'  },
  { subdivs: 4, timerSecs: 18, pieceInterval: 110, fallSpeed: [1.1, 1.6], label: 'PRESSURE' },
  { subdivs: 5, timerSecs: 16, pieceInterval:  90, fallSpeed: [1.3, 1.9], label: 'CRITICAL' },
  { subdivs: 5, timerSecs: 14, pieceInterval:  75, fallSpeed: [1.5, 2.2], label: 'COLLAPSE' },
];
const FPS = 60;
let currentLevel = 0;

function getLaneX(i, sep) {
  const spacing = 120 * sep;
  const startX = W / 2 - (spacing * 3) / 2;
  return startX + i * spacing;
}

function initState(lvl) {
  lvl = lvl !== undefined ? lvl : currentLevel;
  currentLevel = lvl;
  const cfg = LEVELS[Math.min(lvl, LEVELS.length - 1)];
  const timerMax = cfg.timerSecs * FPS;

  state = {
    phase: 'playing',
    tick: 0,
    level: lvl + 1,
    levelLabel: cfg.label,

    chars: ROLES.map((role, i) => ({
      id: i, role, symbol: ROLE_SYMBOLS[i], color: C.pieces[i],
      x: getLaneX(i, 1.0), y: H * 0.62,
      targetX: getLaneX(i, 1.0),
      bobPhase: i * Math.PI * 0.5,
      slot: null, slotNeeded: null,
      selected: false, transferTarget: false, transferAnim: 0,
      collapseLevel: 0,
    })),

    cursor: 0,
    laneSeparation: 1.0, laneTargetSep: 1.0,
    fallingPieces: [],
    nextPieceTimer: cfg.pieceInterval,
    pieceInterval: cfg.pieceInterval,
    fallSpeed: cfg.fallSpeed,
    transferFrom: null, transferParticles: [],
    form: generateForm(cfg.subdivs),
    currentSubdiv: 0,
    subdivTimer: timerMax, subdivTimerMax: timerMax,
    firstPieceLanded: false,
    formFill: 0, formFillTarget: 0,
    collapseFlash: 0,
    completedSubdivs: 0,
    score: 0, levelScore: 0,
    lastSubdivScore: 0, scoreFlash: 0,
    teamBonus: 0,
    particles: [],
    levelAnnounce: 90,
  };
  assignNeededPieces();
}

function generateForm(numSubdivs) {
  const subdivs = [];
  for (let s = 0; s < numSubdivs; s++)
    subdivs.push({ pieces: [0,1,2,3].sort(() => Math.random() - 0.5), done: false });
  return subdivs;
}

// ─── PHYSICS / GAME LOGIC ─────────────────────────────────────────────────────
function spawnPiece() {
  const needy = state.chars.filter(c => c.collapseLevel < 2 && c.slot === null && c.slotNeeded !== null);
  let type, x;
  if (needy.length > 0) {
    const target = needy[Math.floor(Math.random() * needy.length)];
    type = target.slotNeeded;
    x = target.x + (Math.random() - 0.5) * 60;
  } else {
    type = Math.floor(Math.random() * 4);
    x = 80 + Math.random() * (W - 160);
  }
  state.fallingPieces.push({
    x, y: -20,
    vy: state.fallSpeed[0] + Math.random() * (state.fallSpeed[1] - state.fallSpeed[0]),
    type, shape: SHAPES[type % SHAPES.length],
    landed: false,
  });
}

function initiateTransfer(fromId, toId) {
  const from = state.chars[fromId];
  const to   = state.chars[toId];
  if (from.slot === null || from.slot === -1) return;
  if (to.slot !== null || to.collapseLevel !== 0) return;
  if (from.slot !== to.slotNeeded) return;

  const pieceType = from.slot;
  const subdivAtStart = state.currentSubdiv;

  for (let i = 0; i < 12; i++) {
    state.transferParticles.push({
      x: from.x, y: from.y - 30, tx: to.x, ty: to.y - 30,
      t: 0, speed: 0.04 + Math.random() * 0.03, color: C.accent,
    });
  }

  from.slot = -1;
  setTimeout(() => {
    if (state.currentSubdiv !== subdivAtStart || state.phase !== 'playing') {
      from.slot = null; return;
    }
    from.slot = null;
    to.slot = pieceType;
    to.transferAnim = 1;
    checkSubdivComplete();
  }, 400);
}

function getPivotThreshold() {
  const active = state.chars.filter(c => c.collapseLevel < 2).length;
  return Math.ceil(state.form.length * (active / 4) * 0.6);
}

function isPivot() { return state.completedSubdivs >= getPivotThreshold(); }

function checkSubdivComplete() {
  const active = state.chars.filter(c => c.slotNeeded !== null);
  if (!active.length) return;
  if (!active.every(c => c.slot !== null && c.slot !== -1 && c.slot === c.slotNeeded)) return;

  state.form[state.currentSubdiv].done = true;
  state.completedSubdivs++;
  state.formFillTarget = state.completedSubdivs / state.form.length;
  state.subdivTimer = state.subdivTimerMax;

  const timeBonus = Math.floor((state.subdivTimer / state.subdivTimerMax) * 100);
  const points = 100 + timeBonus + (state.completedSubdivs > getPivotThreshold() ? 50 : 0);
  state.score += points; state.levelScore += points;
  state.lastSubdivScore = points; state.scoreFlash = 1;

  spawnParticles(W / 2, H * 0.35, C.ok, 40);

  if (state.currentSubdiv === state.form.length - 1) {
    applyLevelEndBonus();
    state.phase = isPivot() ? 'win' : 'gameover';
  } else {
    state.currentSubdiv++;
    state.firstPieceLanded = false;
    assignNeededPieces();
  }
}

function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, spd = 1 + Math.random() * 3;
    state.particles.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      life: 1, decay: 0.02 + Math.random() * 0.02,
      color, size: 2 + Math.random() * 3,
    });
  }
}

function triggerCollapse() {
  state.collapseFlash = 1;
  spawnParticles(W / 2, H * 0.3, C.danger, 25);
  state.form[state.currentSubdiv].failed = true;

  const worst = state.chars
    .filter(c => c.collapseLevel < 2)
    .sort((a, b) => (a.slot === a.slotNeeded ? 1 : 0) - (b.slot === b.slotNeeded ? 1 : 0))[0];
  if (worst) { worst.collapseLevel++; worst.slot = null; }

  if (state.chars.filter(c => c.collapseLevel < 2).length < 1) {
    applyLevelEndBonus(); state.phase = 'gameover'; return;
  }

  if (state.currentSubdiv < state.form.length - 1) {
    state.currentSubdiv++;
    state.firstPieceLanded = false;
    state.subdivTimer = Math.max(
      state.subdivTimerMax * 0.6,
      state.subdivTimerMax - state.currentSubdiv * FPS * 2
    );
    assignNeededPieces();
  } else {
    applyLevelEndBonus();
    state.phase = isPivot() ? 'win' : 'gameover';
  }
}

function applyLevelEndBonus() {
  const bonus = state.chars.filter(c => c.collapseLevel === 0).length * 75;
  state.score += bonus; state.levelScore += bonus; state.teamBonus = bonus;
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function handleInput() {
  const pressed = drainKeys();
  for (const code of pressed) {
    if (state.phase === 'gameover' || state.phase === 'win') {
      if (code === 'START1' || code === 'P1_1') {
        if (state.phase === 'win') {
          const carryScore = state.score;
          initState(currentLevel + 1);
          state.score = carryScore;
        } else {
          currentLevel = 0; initState(0);
        }
      }
      continue;
    }
    if (state.phase !== 'playing') continue;

    if (code === 'P1_L') {
      state.cursor = (state.cursor - 1 + 4) % 4;
    } else if (code === 'P1_R') {
      state.cursor = (state.cursor + 1) % 4;
    } else if (code === 'P1_3') {
      state.laneTargetSep = Math.min(1.6, state.laneTargetSep + 0.15);
    } else if (code === 'P1_4') {
      state.laneTargetSep = Math.max(0.4, state.laneTargetSep - 0.15);
    } else if (code === 'P1_1') {
      handleSelect();
    } else if (code === 'P1_2') {
      handleDiscard();
    } else if (code === 'P1_5') {
      elemScale = Math.min(3.0, elemScale + 0.5);
    } else if (code === 'P1_6') {
      elemScale = Math.max(1.0, elemScale - 0.5);
    }
  }
}

function handleSelect() {
  const cur = state.chars[state.cursor];
  if (cur.collapseLevel >= 2) return;

  if (state.transferFrom === null) {
    if (cur.slot !== null && cur.slot !== -1) {
      state.transferFrom = cur.id;
      state.chars.forEach(c => {
        c.selected = c.id === cur.id;
        c.transferTarget = c.id !== cur.id && c.collapseLevel === 0 && c.slot === null;
      });
    }
  } else if (cur.id === state.transferFrom) {
    cancelTransfer();
  } else {
    const from = state.chars[state.transferFrom];
    if (cur.slot === null && from.slot !== null && from.slot !== -1 && from.slot === cur.slotNeeded)
      initiateTransfer(state.transferFrom, cur.id);
    cancelTransfer();
  }
}

function handleDiscard() {
  const cur = state.chars[state.cursor];
  if (cur.collapseLevel >= 2) return;
  if (cur.slot !== null && cur.slot !== -1) {
    cur.slot = null;
    if (state.transferFrom === cur.id) cancelTransfer();
  }
}

function cancelTransfer() {
  state.transferFrom = null;
  state.chars.forEach(c => { c.selected = false; c.transferTarget = false; });
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  handleInput();
  if (state.phase !== 'playing') return;
  state.tick++;

  state.laneSeparation += (state.laneTargetSep - state.laneSeparation) * 0.05;

  state.chars.forEach((c, i) => {
    c.targetX = getLaneX(i, state.laneSeparation);
    c.x += (c.targetX - c.x) * 0.08;
    c.bobPhase += 0.06;
    c.y = H * 0.62 + Math.sin(c.bobPhase) * 4;
    if (c.transferAnim > 0) c.transferAnim = Math.max(0, c.transferAnim - 0.05);
  });

  state.nextPieceTimer--;
  if (state.nextPieceTimer <= 0) { spawnPiece(); state.nextPieceTimer = state.pieceInterval; }

  state.fallingPieces.forEach(p => {
    p.y += p.vy;
    if (!p.landed) {
      state.chars.forEach(c => {
        if (c.collapseLevel >= 2 || c.slot !== null) return;
        const hitR = Math.round(25 * elemScale), hitOY = Math.round(30 * elemScale);
        if (Math.abs(p.x - c.x) < hitR && Math.abs(p.y - (c.y - hitOY)) < hitR) {
          c.slot = p.type; p.landed = true;
          state.firstPieceLanded = true;
          spawnParticles(c.x, c.y - 30, C.pieces[p.type], 8);
          checkSubdivComplete();
        }
      });
    }
  });
  state.fallingPieces = state.fallingPieces.filter(p => !p.landed && p.y < H + 40);

  state.transferParticles.forEach(p => { p.t += p.speed; });
  state.transferParticles = state.transferParticles.filter(p => p.t < 1);

  state.particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= p.decay;
  });
  state.particles = state.particles.filter(p => p.life > 0);

  const active = state.chars.filter(c => c.slotNeeded !== null);
  const solved = active.length > 0 && active.every(c => c.slot !== null && c.slot !== -1 && c.slot === c.slotNeeded);
  if (!solved && state.firstPieceLanded) {
    if (--state.subdivTimer <= 0) triggerCollapse();
  }

  state.formFill += (state.formFillTarget - state.formFill) * 0.06;
  if (state.scoreFlash > 0) state.scoreFlash = Math.max(0, state.scoreFlash - 0.03);
  if (state.collapseFlash > 0) state.collapseFlash = Math.max(0, state.collapseFlash - 0.04);
  if (state.levelAnnounce > 0) state.levelAnnounce--;
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
function draw() {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  if (state.collapseFlash > 0) {
    ctx.fillStyle = `rgba(232,71,71,${state.collapseFlash * 0.15})`;
    ctx.fillRect(0, 0, W, H);
  }

  drawLane(); drawForm(); drawTimer();
  drawFallingPieces(); drawTransferParticles(); drawParticles();
  drawCharacters(); drawUI();

  drawLevelAnnounce();
  if (state.phase === 'gameover') drawGameOver();
  if (state.phase === 'win') drawWin();
}

function drawLane() {
  ctx.fillStyle = C.lane;
  ctx.fillRect(0, H * 0.55, W, H * 0.25);
  ctx.strokeStyle = C.laneEdge; ctx.lineWidth = 1;
  [H * 0.55, H * 0.80].forEach(y => {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });
  ctx.strokeStyle = '#181818'; ctx.lineWidth = 1;
  const off = (state.tick * 2) % 40;
  for (let x = -40 + off; x < W + 40; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, H * 0.55); ctx.lineTo(x - 20, H * 0.80); ctx.stroke();
  }
}

function drawForm() {
  const BX = 40, BY = 22, BW = W - 80, BH = 6;
  ctx.fillStyle = '#111'; ctx.fillRect(BX, BY, BW, BH);

  const fillW = BW * state.formFill;
  if (fillW > 0) {
    ctx.fillStyle = C.ok; ctx.shadowColor = C.ok; ctx.shadowBlur = 8;
    ctx.fillRect(BX, BY, fillW, BH); ctx.shadowBlur = 0;
  }

  const active = state.chars.filter(c => c.slotNeeded !== null);
  const doneIn = active.filter(c => c.slot !== null && c.slot !== -1 && c.slot === c.slotNeeded).length;
  const subW = active.length > 0 ? (BW / state.form.length) * (doneIn / active.length) : 0;
  if (subW > 0) {
    ctx.globalAlpha = 0.3 + Math.sin(state.tick * 0.08) * 0.1;
    ctx.fillStyle = C.ok; ctx.fillRect(BX + fillW, BY, subW, BH);
    ctx.globalAlpha = 1;
  }

  const thresh = getPivotThreshold();
  const tx = BX + BW * (thresh / state.form.length);
  ctx.strokeStyle = state.formFill >= thresh / state.form.length ? C.ok : C.accent;
  ctx.lineWidth = 1.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(tx, BY - 4); ctx.lineTo(tx, BY + BH + 4); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 0.5; ctx.strokeRect(BX, BY, BW, BH);
}

function drawTimer() {
  const cx = W - 50, cy = 50, r = 28;
  const pct = state.subdivTimer / state.subdivTimerMax;
  const color = pct > 0.4 ? C.accent : C.danger;
  ctx.save();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * pct); ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 12px Courier New';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.ceil(state.subdivTimer / 60), cx, cy);
  ctx.restore();
}

function drawFallingPieces() {
  const sz = Math.max(4, Math.round(6 * elemScale));
  state.fallingPieces.forEach(p => {
    if (p.landed) return;
    ctx.save(); ctx.globalAlpha = 0.85;
    p.shape.forEach((row, ry) => row.forEach((cell, rx) => {
      if (!cell) return;
      ctx.fillStyle = C.pieces[p.type];
      ctx.fillRect(p.x + rx * sz - sz, p.y + ry * sz - sz, sz - 1, sz - 1);
    }));
    ctx.shadowColor = C.pieces[p.type]; ctx.shadowBlur = 6;
    ctx.restore();
  });
}

function drawTransferParticles() {
  state.transferParticles.forEach(p => {
    const x = p.x + (p.tx - p.x) * p.t;
    const y = p.y + (p.ty - p.y) * p.t - Math.sin(p.t * Math.PI) * 30;
    ctx.save(); ctx.globalAlpha = 1 - p.t;
    ctx.fillStyle = C.accent; ctx.shadowColor = C.accent; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

function drawParticles() {
  state.particles.forEach(p => {
    ctx.save(); ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

function drawCharacters() {
  state.chars.forEach((c, i) => {
    const collapsed = c.collapseLevel >= 2;
    const reduced   = c.collapseLevel === 1;
    const isCursor  = i === state.cursor;
    ctx.save();
    ctx.globalAlpha = collapsed ? 0.15 : 1;

    if (isCursor && !collapsed) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.4 + Math.sin(state.tick * 0.12) * 0.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.round(32 * elemScale), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = collapsed ? 0.15 : 1;
    }

    if (c.selected) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
      ctx.shadowColor = C.accent; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.round(24 * elemScale), 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (c.transferTarget) {
      ctx.strokeStyle = C.ok; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.round(26 * elemScale), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    const r = Math.round((reduced ? 13 : 16) * elemScale);
    const symFont = Math.round((reduced ? 9 : 11) * elemScale);
    if (reduced) {
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5;
      ctx.shadowColor = '#333'; ctx.shadowBlur = 4;
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2 - Math.PI / 2;
        const mx = c.x + Math.cos(ang) * r, my = c.y + Math.sin(ang) * r;
        a === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
      }
      ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#444'; ctx.font = 'bold ' + symFont + 'px Courier New';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.symbol, c.x, c.y);
    } else {
      const col = collapsed ? C.dim : c.color;
      ctx.fillStyle = col; ctx.shadowColor = col;
      ctx.shadowBlur = c.selected ? 20 : 8;
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2 - Math.PI / 2;
        const mx = c.x + Math.cos(ang) * r, my = c.y + Math.sin(ang) * r;
        a === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
      }
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = collapsed ? C.dim : C.bg;
      ctx.font = 'bold ' + symFont + 'px Courier New';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.symbol, c.x, c.y);
    }

    if (!collapsed) drawSlot(c);
    ctx.restore();
  });
}

function drawSlot(c) {
  const sc = elemScale;
  const sy = c.y - Math.round(52 * sc);
  const reduced = c.collapseLevel === 1;
  const slotFont = Math.min(14, Math.round(7 * sc)) + 'px Courier New';
  const bw = Math.round(28 * sc), bh = Math.round(16 * sc);

  if (c.slotNeeded !== null) {
    ctx.fillStyle = reduced ? '#2a2a2a' : C.mid;
    ctx.font = slotFont; ctx.textAlign = 'center';
    ctx.fillText(reduced ? '\u00b7\u00b7\u00b7' : 'NEED', c.x, sy - Math.round(22 * sc));
    ctx.globalAlpha = reduced ? 0.12 : 0.3;
    ctx.strokeStyle = reduced ? '#444' : C.pieces[c.slotNeeded];
    ctx.lineWidth = 1;
    ctx.strokeRect(c.x - bw / 2, sy - Math.round(18 * sc), bw, bh);
    drawMiniShape(c.x, sy - Math.round(10 * sc), c.slotNeeded, sc);
    ctx.globalAlpha = 1;
  }

  if (c.slot !== null && c.slot !== -1) {
    const isOk = c.slot === c.slotNeeded;
    const hy = sy - Math.round(42 * sc);
    ctx.fillStyle = reduced ? '#555' : (isOk ? C.ok : C.accent);
    ctx.font = slotFont; ctx.textAlign = 'center';
    ctx.fillText(isOk ? 'OK' : 'HAS', c.x, hy - Math.round(4 * sc));
    ctx.strokeStyle = reduced ? '#555' : (isOk ? C.ok : C.accent);
    ctx.lineWidth = 1;
    ctx.shadowColor = reduced ? 'transparent' : (isOk ? C.ok : C.accent);
    ctx.shadowBlur = reduced ? 0 : (isOk ? 8 : 4);
    ctx.strokeRect(c.x - bw / 2, hy, bw, bh); ctx.shadowBlur = 0;
    ctx.globalAlpha = reduced ? 0.5 : 1;
    drawMiniShape(c.x, hy + Math.round(8 * sc), c.slot, sc);
    ctx.globalAlpha = 1;
  }

  if (c.slot === -1) {
    ctx.fillStyle = C.accent;
    ctx.globalAlpha = 0.5 + Math.sin(state.tick * 0.2) * 0.3;
    ctx.beginPath(); ctx.arc(c.x, sy - Math.round(32 * sc), Math.round(5 * sc), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = reduced ? '#333' : C.mid;
  ctx.font = slotFont; ctx.textAlign = 'center';
  ctx.fillText(c.role, c.x, c.y + Math.round(26 * sc));
}

function drawMiniShape(cx, cy, type, sc) {
  sc = sc || 1;
  const s = SHAPES[type % SHAPES.length], sz = Math.max(3, Math.round(5 * sc));
  s.forEach((row, ry) => row.forEach((cell, rx) => {
    if (!cell) return;
    ctx.fillStyle = C.pieces[type];
    ctx.fillRect(cx + rx * sz - sz, cy + ry * sz - sz, sz - 1, sz - 1);
  }));
}

function drawUI() {
  ctx.fillStyle = C.mid; ctx.font = '10px Courier New'; ctx.textAlign = 'left';
  ctx.fillText('LVL ' + state.level + '  \u00b7  ' + state.levelLabel, 14, 18);

  ctx.save();
  ctx.globalAlpha = 0.4 + state.scoreFlash * 0.6;
  ctx.fillStyle = state.scoreFlash > 0.1 ? C.ok : C.mid;
  ctx.font = state.scoreFlash > 0.1 ? 'bold 13px Courier New' : '11px Courier New';
  ctx.textAlign = 'right';
  ctx.fillText(state.score.toString().padStart(6, '0'), W - 14, 18);
  ctx.restore();

  if (state.scoreFlash > 0.3) {
    ctx.save(); ctx.globalAlpha = (state.scoreFlash - 0.3) / 0.7;
    ctx.fillStyle = C.ok; ctx.font = '9px Courier New'; ctx.textAlign = 'right';
    ctx.fillText('+' + state.lastSubdivScore, W - 14, 32);
    ctx.restore();
  }

  const sepPct = Math.max(0, Math.min(1, (state.laneSeparation - 0.4) / 1.2));
  const bw = 80, bh = 3, bx = W - 14 - bw, by = H - 22;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = C.accent; ctx.fillRect(bx, by, bw * sepPct, bh);
  ctx.fillStyle = C.dim; ctx.font = '8px Courier New'; ctx.textAlign = 'right';
  ctx.fillText('\u2190 spread \u2192', W - 14, H - 14);

  // Size indicator (B5/B6)
  ctx.fillStyle = C.dim; ctx.font = '8px Courier New'; ctx.textAlign = 'left';
  ctx.fillText('SZ ' + elemScale.toFixed(1) + '  B5\u25b2 B6\u25bc', 14, H - 14);

  if (state.tick < 420) {
    const alpha = Math.min(1, (420 - state.tick) / 90) * 0.65;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = C.white; ctx.font = '9px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('L/R: navigate  \u00b7  B1: select/transfer  \u00b7  B2: discard', W/2, H - 40);
    ctx.fillText('B3: expand  \u00b7  B4: compress  \u00b7  START: restart', W/2, H - 28);
    ctx.restore();
  }
}

function drawLevelAnnounce() {
  if (state.levelAnnounce <= 0) return;
  const alpha = state.levelAnnounce > 60 ? 1 : state.levelAnnounce / 60;
  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.fillStyle = 'rgba(10,10,10,0.88)';
  ctx.fillRect(W / 2 - 220, H / 2 - 70, 440, 140);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
  ctx.strokeRect(W / 2 - 220, H / 2 - 70, 440, 140);

  ctx.globalAlpha = alpha;
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 56px Courier New';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = C.accent; ctx.shadowBlur = 24;
  ctx.fillText('LEVEL ' + state.level, W / 2, H / 2 - 18);
  ctx.shadowBlur = 0;

  ctx.fillStyle = C.mid;
  ctx.font = '18px Courier New';
  ctx.fillText(state.levelLabel, W / 2, H / 2 + 28);
  ctx.restore();
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = 'rgba(10,10,10,0.88)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.danger; ctx.font = 'bold 28px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('FORM COLLAPSED', W/2, H/2 - 40);
  ctx.fillStyle = C.white; ctx.font = 'bold 36px Courier New';
  ctx.fillText(state.score.toString().padStart(6, '0'), W/2, H/2 + 2);
  ctx.fillStyle = C.mid; ctx.font = '10px Courier New';
  ctx.fillText(state.completedSubdivs + ' held  \u00b7  needed ' + getPivotThreshold() + '  \u00b7  team bonus +' + state.teamBonus, W/2, H/2 + 22);
  ctx.fillStyle = C.dim;
  ctx.fillText('B1 OR START TO RESTART', W/2, H/2 + 44);
  ctx.restore();
}

function drawWin() {
  ctx.save();
  ctx.fillStyle = 'rgba(10,10,10,0.88)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.ok; ctx.font = 'bold 28px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('PIVOT COMPLETE', W/2, H/2 - 40);
  ctx.fillStyle = C.white; ctx.font = 'bold 36px Courier New';
  ctx.fillText(state.score.toString().padStart(6, '0'), W/2, H/2 + 2);
  ctx.fillStyle = C.mid; ctx.font = '10px Courier New';
  ctx.fillText('LVL ' + state.level + '  \u00b7  ' + state.levelLabel + '  \u00b7  team bonus +' + state.teamBonus, W/2, H/2 + 22);
  ctx.fillStyle = C.dim;
  ctx.fillText(
    currentLevel >= LEVELS.length - 1 ? 'B1 OR START TO PLAY AGAIN' : 'B1 OR START FOR LEVEL ' + (state.level + 1),
    W/2, H/2 + 44
  );
  ctx.restore();
}

// ─── MOUSE / SCROLL (desktop bonus) ──────────────────────────────────────────
canvas.addEventListener('click', e => {
  if (state.phase === 'gameover' || state.phase === 'win') {
    if (state.phase === 'win') { const s = state.score; initState(currentLevel + 1); state.score = s; }
    else { currentLevel = 0; initState(0); }
    return;
  }
  if (state.phase !== 'playing') return;
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (W / r.width);
  const my = (e.clientY - r.top) * (H / r.height);
  const clicked = state.chars.find(c => {
    const dx = mx - c.x, dy = my - c.y;
    return Math.sqrt(dx*dx + dy*dy) < 28 && c.collapseLevel < 2;
  });
  if (!clicked) { cancelTransfer(); return; }
  state.cursor = clicked.id;
  handleSelect();
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  state.laneTargetSep = Math.max(0.4, Math.min(1.6, state.laneTargetSep - e.deltaY * 0.002));
}, { passive: false });

// ─── LOOP ─────────────────────────────────────────────────────────────────────
function loop() { update(); draw(); requestAnimationFrame(loop); }
initState(0);
loop();

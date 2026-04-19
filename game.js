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
  // Base 1 — standard
  { subdivs: 3, timerSecs: 25, pieceInterval: 160, fallSpeed: [0.7, 1.1], label: 'WARMUP',    edgeBias: false, burnoutInterval: 0 },
  { subdivs: 4, timerSecs: 22, pieceInterval: 140, fallSpeed: [0.9, 1.3], label: 'FORMING',   edgeBias: false, burnoutInterval: 0 },
  // Base 2 — edge pressure
  { subdivs: 4, timerSecs: 20, pieceInterval: 115, fallSpeed: [1.1, 1.6], label: 'SCATTERED', edgeBias: true,  burnoutInterval: 0 },
  { subdivs: 5, timerSecs: 17, pieceInterval:  90, fallSpeed: [1.3, 1.9], label: 'STRETCH',   edgeBias: true,  burnoutInterval: 0 },
  // Base 3 — burnout
  { subdivs: 5, timerSecs: 16, pieceInterval:  85, fallSpeed: [1.4, 2.0], label: 'OVERLOAD',  edgeBias: false, burnoutInterval: 420 },
  { subdivs: 6, timerSecs: 13, pieceInterval:  70, fallSpeed: [1.6, 2.3], label: 'COLLAPSE',  edgeBias: true,  burnoutInterval: 280 },
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
    phase: lvl === 0 ? 'waiting_for_movement' : 'playing',
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
      collapseLevel: 0, burnout: 0,
    })),

    cursor: 0,
    laneSeparation: 1.0, laneTargetSep: 1.0,
    fallingPieces: [],
    nextPieceTimer: cfg.pieceInterval,
    pieceInterval: cfg.pieceInterval,
    fallSpeed: cfg.fallSpeed,
    burnoutInterval: cfg.burnoutInterval,
    nextBurnoutTimer: cfg.burnoutInterval || 0,
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
    levelAnnounce: lvl === 0 ? 0 : 90,
    transitionTimer: 0,
    onboardExpanded: false, onboardCompressed: false,
    onboardNavLeft: false, onboardNavRight: false,
    skipAll: false,
    onboardActionDone: false,
    onboardAimed: false, onboardActionTaken: false, onboardActionUsed: null,
    onboardAimFade: -1,
    onboardWrongCharId: -1,
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
  const cfg = LEVELS[Math.min(currentLevel, LEVELS.length - 1)];
  const needy = state.chars.filter(c => c.collapseLevel < 2 && c.slot === null && c.slotNeeded !== null);
  let type, x;
  if (needy.length > 0) {
    let target;
    if (cfg.edgeBias && Math.random() < 0.7) {
      const sorted = [...needy].sort((a, b) => Math.abs(b.x - W / 2) - Math.abs(a.x - W / 2));
      target = sorted[0];
    } else {
      target = needy[Math.floor(Math.random() * needy.length)];
    }
    type = target.slotNeeded;
    x = target.x + (Math.random() - 0.5) * 60;
  } else {
    type = Math.floor(Math.random() * 4);
    if (cfg.edgeBias) {
      x = Math.random() < 0.5 ? 40 + Math.random() * 120 : W - 160 + Math.random() * 120;
    } else {
      x = 80 + Math.random() * (W - 160);
    }
  }
  state.fallingPieces.push({
    x, y: -20,
    vy: state.fallSpeed[0] + Math.random() * (state.fallSpeed[1] - state.fallSpeed[0]),
    type, shape: SHAPES[type % SHAPES.length],
    landed: false, isBurnout: false,
  });
}

function spawnBurnout() {
  const cfg = LEVELS[Math.min(currentLevel, LEVELS.length - 1)];
  const vy = cfg.fallSpeed[1] * 1.8;
  state.fallingPieces.push({ x: 80 + Math.random() * (W - 160), y: -20, vy, type: -1, shape: null, landed: false, isBurnout: true });
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
  audioOnSubdivComplete();

  if (state.currentSubdiv === state.form.length - 1) {
    applyLevelEndBonus();
    const endPhase = isPivot() ? 'win' : 'gameover';
    state.phase = endPhase;
    if (endPhase === 'win') audioOnWin(); else audioOnGameOver();
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
  audioOnCollapse();
  spawnParticles(W / 2, H * 0.3, C.danger, 25);
  state.form[state.currentSubdiv].failed = true;

  const worst = state.chars
    .filter(c => c.collapseLevel < 2)
    .sort((a, b) => (a.slot === a.slotNeeded ? 1 : 0) - (b.slot === b.slotNeeded ? 1 : 0))[0];
  if (worst) { worst.collapseLevel++; worst.slot = null; }

  if (state.chars.filter(c => c.collapseLevel < 2).length < 1) {
    applyLevelEndBonus(); state.phase = 'gameover'; audioOnGameOver(); return;
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
    const endPhase2 = isPivot() ? 'win' : 'gameover';
    state.phase = endPhase2;
    if (endPhase2 === 'win') audioOnWin(); else audioOnGameOver();
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
          const carrySkip = state.skipAll;
          initState(currentLevel + 1);
          state.score = carryScore;
          state.skipAll = carrySkip;
        } else {
          currentLevel = 0; initState(0);
        }
      }
      continue;
    }
    if (state.phase === 'waiting_for_movement') {
      if (state.transitionTimer === 0) {
        if (code === 'P1_U') { state.transitionTimer = 20; }
        else if (code === 'P1_D') { state.skipAll = true; state.transitionTimer = 20; }
        else if (code === 'P1_3') { state.laneTargetSep = Math.min(1.6, state.laneTargetSep + 0.15); state.onboardExpanded = true; }
        else if (code === 'P1_4') { state.laneTargetSep = Math.max(0.4, state.laneTargetSep - 0.15); state.onboardCompressed = true; }
        if (state.onboardExpanded && state.onboardCompressed) state.transitionTimer = 60;
      }
      continue;
    }
    if (state.phase === 'waiting_for_navigation') {
      if (state.transitionTimer > 0) { continue; }
      if (code === 'P1_U') { state.transitionTimer = 20; continue; }
      if (code === 'P1_D') { state.skipAll = true; state.transitionTimer = 20; continue; }
      if (code === 'P1_L') { state.cursor = (state.cursor - 1 + 4) % 4; state.onboardNavLeft = true; }
      if (code === 'P1_R') { state.cursor = (state.cursor + 1) % 4; state.onboardNavRight = true; }
      if (state.onboardNavLeft && state.onboardNavRight) state.transitionTimer = 40;
      continue;
    }
    if (state.phase === 'waiting_for_action') {
      if (state.transitionTimer > 0) { continue; }
      if (code === 'P1_U') { state.onboardActionDone = true; state.transitionTimer = 20; continue; }
      if (code === 'P1_D') { state.onboardActionDone = true; state.skipAll = true; state.transitionTimer = 20; continue; }
      if (code === 'P1_3') { state.laneTargetSep = Math.min(1.6, state.laneTargetSep + 0.15); continue; }
      if (code === 'P1_4') { state.laneTargetSep = Math.max(0.4, state.laneTargetSep - 0.15); continue; }
      if (code === 'P1_L') { state.cursor = (state.cursor - 1 + 4) % 4; continue; }
      if (code === 'P1_R') { state.cursor = (state.cursor + 1) % 4; continue; }
      const onWrong = state.cursor === state.onboardWrongCharId;
      const holding = state.transferFrom === state.onboardWrongCharId;
      if (onWrong || holding) {
        if (code === 'P1_1') {
          const wrongChar = state.chars[state.onboardWrongCharId];
          const cursorChar = state.chars[state.cursor];
          const wasOnValidTarget = holding && wrongChar && cursorChar &&
            cursorChar.id !== wrongChar.id && cursorChar.slot === null &&
            cursorChar.collapseLevel === 0 && cursorChar.slotNeeded === wrongChar.slot;
          handleSelect();
          if (holding && wasOnValidTarget) {
            state.onboardActionTaken = true; state.onboardActionUsed = 'P1_1'; state.onboardActionDone = true; state.transitionTimer = 60;
          }
        } else if (code === 'P1_2') {
          const wc = state.chars[state.onboardWrongCharId];
          if (holding) { cancelTransfer(); wc.slot = null; } else { handleDiscard(); }
          state.onboardActionTaken = true; state.onboardActionUsed = 'P1_2'; state.onboardActionDone = true; state.transitionTimer = 60;
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
        c.transferTarget = c.id !== cur.id && c.collapseLevel === 0 && c.slot === null && c.slotNeeded === cur.slot;
      });
    }
  } else if (cur.id === state.transferFrom) {
    cancelTransfer();
  } else {
    const from = state.chars[state.transferFrom];
    if (cur.slot === null && from.slot !== null && from.slot !== -1 && from.slot === cur.slotNeeded)
      initiateTransfer(state.transferFrom, cur.id);
      audioOnTransfer();
    cancelTransfer();
  }
}

function handleDiscard() {
  const cur = state.chars[state.cursor];
  if (cur.collapseLevel >= 2) return;
  if (cur.burnout > 0) { cur.burnout = 0; return; }
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

  if (state.phase === 'waiting_for_movement') {
    state.tick++;
    state.laneSeparation += (state.laneTargetSep - state.laneSeparation) * 0.05;
    state.chars.forEach(c => {
      c.targetX = getLaneX(c.id, state.laneSeparation);
      c.x += (c.targetX - c.x) * 0.08;
      c.bobPhase += 0.06;
      c.y = H * 0.62 + Math.sin(c.bobPhase) * 4;
    });
    if (state.transitionTimer > 0 && --state.transitionTimer === 0) {
      state.phase = state.skipAll ? 'playing' : 'waiting_for_navigation';
      if (state.skipAll) state.levelAnnounce = 90;
      else state.cursor = 1;
    }
    return;
  }

  if (state.phase === 'waiting_for_navigation') {
    state.tick++;
    state.laneSeparation += (state.laneTargetSep - state.laneSeparation) * 0.05;
    state.chars.forEach(c => {
      c.targetX = getLaneX(c.id, state.laneSeparation);
      c.x += (c.targetX - c.x) * 0.08;
      c.bobPhase += 0.06;
      c.y = H * 0.62 + Math.sin(c.bobPhase) * 4;
    });
    if (state.transitionTimer > 0 && --state.transitionTimer === 0) {
      state.phase = 'playing';
      state.levelAnnounce = 90;
    }
    return;
  }

  if (state.phase === 'waiting_for_action') {
    state.tick++;
    state.laneSeparation += (state.laneTargetSep - state.laneSeparation) * 0.05;
    state.chars.forEach(c => {
      c.targetX = getLaneX(c.id, state.laneSeparation);
      c.x += (c.targetX - c.x) * 0.08;
      c.bobPhase += 0.06;
      c.y = H * 0.62 + Math.sin(c.bobPhase) * 4;
      if (c.transferAnim > 0) c.transferAnim = Math.max(0, c.transferAnim - 0.05);
    });
    state.transferParticles.forEach(p => { p.t += p.speed; });
    state.transferParticles = state.transferParticles.filter(p => p.t < 1);
    state.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= p.decay; });
    state.particles = state.particles.filter(p => p.life > 0);
    if (state.scoreFlash > 0) state.scoreFlash = Math.max(0, state.scoreFlash - 0.03);
    if (state.onboardAimFade > 0) state.onboardAimFade--;
    if (state.transitionTimer > 0 && --state.transitionTimer === 0) state.phase = 'playing';
    return;
  }

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

  if (state.burnoutInterval > 0) {
    state.nextBurnoutTimer--;
    if (state.nextBurnoutTimer <= 0) { spawnBurnout(); state.nextBurnoutTimer = state.burnoutInterval; }
  }

  state.chars.forEach(c => {
    if (c.burnout > 0) {
      c.burnout--;
      if (c.burnout === 0) {
        c.collapseLevel = Math.min(2, c.collapseLevel + 1);
        c.slot = null;
        state.collapseFlash = 1;
        if (state.transferFrom === c.id) cancelTransfer();
        if (state.chars.filter(x => x.collapseLevel < 2).length < 1) {
          applyLevelEndBonus(); state.phase = 'gameover'; audioOnGameOver();
        }
      }
    }
  });

  state.fallingPieces.forEach(p => {
    p.y += p.vy;
    if (!p.landed) {
      const hitR = Math.round(25 * elemScale), hitOY = Math.round(30 * elemScale);
      if (p.isBurnout) {
        state.chars.forEach(c => {
          if (c.collapseLevel >= 2 || c.burnout > 0) return;
          if (Math.abs(p.x - c.x) < hitR && Math.abs(p.y - (c.y - hitOY)) < hitR) {
            c.burnout = 240; p.landed = true;
            spawnParticles(c.x, c.y - 30, C.danger, 10);
          }
        });
        return;
      }
      state.chars.forEach(c => {
        if (c.collapseLevel >= 2 || c.slot !== null) return;
        if (Math.abs(p.x - c.x) < hitR && Math.abs(p.y - (c.y - hitOY)) < hitR) {
          c.slot = p.type; p.landed = true;
          state.firstPieceLanded = true;
          spawnParticles(c.x, c.y - 30, C.pieces[p.type], 8);
          checkSubdivComplete();
          if (currentLevel === 0 && !state.onboardActionDone && !state.skipAll && state.phase === 'playing'
              && c.slot !== null && c.slot !== -1 && c.slot !== c.slotNeeded && c.collapseLevel === 0) {
            const hasTarget = state.chars.some(o =>
              o.id !== c.id && o.slot === null && o.collapseLevel === 0 && o.slotNeeded === c.slot);
            if (hasTarget) {
              state.phase = 'waiting_for_action';
              state.onboardWrongCharId = c.id;
              state.cursor = c.id;
            }
          }
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

  if (state.phase === 'waiting_for_movement') {
    drawLane();
    drawCharacters(true);
    drawOnboarding();
    return;
  }

  if (state.phase === 'waiting_for_navigation') {
    drawLane();
    drawCharacters(true);
    drawWaitingNavigation();
    return;
  }

  if (state.phase === 'waiting_for_action') {
    drawLane();
    ctx.save(); ctx.globalAlpha = 0.3;
    drawForm(); drawTimer(); drawUI();
    ctx.restore();
    drawFallingPieces(); drawTransferParticles(); drawParticles();
    drawCharacters();
    drawWaitingAction();
    return;
  }

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
    if (p.isBurnout) {
      ctx.fillStyle = C.danger;
      ctx.shadowColor = C.danger; ctx.shadowBlur = 14;
      ctx.font = 'bold ' + Math.round(sz * 4) + 'px Courier New';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u2620', p.x, p.y);
    } else {
      p.shape.forEach((row, ry) => row.forEach((cell, rx) => {
        if (!cell) return;
        ctx.fillStyle = C.pieces[p.type];
        ctx.fillRect(p.x + rx * sz - sz, p.y + ry * sz - sz, sz - 1, sz - 1);
      }));
      ctx.shadowColor = C.pieces[p.type]; ctx.shadowBlur = 6;
    }
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

function drawCharacters(skipSlots = false) {
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
      ctx.globalAlpha = 0.4 + Math.sin(state.tick * 0.12) * 0.25;
      ctx.fillStyle = C.bright;
      ctx.font = 'bold ' + Math.round(21 * elemScale) + 'px Courier New';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000000'; ctx.shadowBlur = 10;
      ctx.fillText(c.role, c.x, c.y + Math.round(60 * elemScale));
      ctx.shadowBlur = 0;
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

    if (!collapsed && !skipSlots) drawSlot(c);

    if (c.burnout > 0 && !collapsed) {
      const ratio = c.burnout / 240;
      const flash = (state.tick % 20) < 10 ? 1 : 0.4;
      const sc = elemScale;
      ctx.globalAlpha = flash;
      ctx.fillStyle = C.danger;
      ctx.font = 'bold ' + Math.round(13 * sc) + 'px Courier New';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = C.danger; ctx.shadowBlur = 8;
      ctx.fillText('\u2620', c.x + Math.round(22 * sc), c.y - Math.round(62 * sc));
      ctx.shadowBlur = 0;
      const bw = Math.round(38 * sc), bh = 3, bx = c.x - bw / 2, by = c.y - Math.round(72 * sc);
      ctx.globalAlpha = 0.4; ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = flash; ctx.fillStyle = C.danger;
      ctx.fillRect(bx, by, bw * ratio, bh);
    }

    ctx.restore();
  });
}

function drawOnboarding() {
  const bothDone = state.onboardExpanded && state.onboardCompressed;
  const fadeAlpha = state.transitionTimer === 0 ? 1 : Math.max(0, (state.transitionTimer - 30) / 30);
  const pulse = 0.5 + Math.sin(state.tick * 0.06) * 0.4;

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // Central text
  ctx.globalAlpha = fadeAlpha * (bothDone ? 0.6 : pulse);
  ctx.fillStyle = bothDone ? C.ok : C.accent;
  ctx.font = 'bold 32px Courier New';
  ctx.fillText('MOVE YOUR TEAM', W / 2, H * 0.38);

  function drawIndicator(x, y, label, arrowDir, done) {
    const r = 22;
    const color = done ? C.ok : C.accent;
    const alpha = done ? 0.6 : pulse;
    ctx.globalAlpha = fadeAlpha * alpha;
    ctx.fillStyle = 'rgba(10,10,10,0.6)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 18px Courier New';
    ctx.fillText(label, x, y);
    const ax = arrowDir > 0 ? x + r : x - r;
    const bx = ax + arrowDir * 16;
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(bx, y); ctx.stroke();
    const hs = 5;
    ctx.beginPath();
    ctx.moveTo(bx, y); ctx.lineTo(bx - arrowDir * hs, y - hs);
    ctx.moveTo(bx, y); ctx.lineTo(bx - arrowDir * hs, y + hs);
    ctx.stroke();
  }

  drawIndicator(W / 2 + 60, H - 90, '3', 1,  state.onboardExpanded);
  drawIndicator(W / 2 - 60, H - 50, '4', -1, state.onboardCompressed);

  // Skip hint — above title
  ctx.globalAlpha = fadeAlpha * 0.7;
  ctx.fillStyle = C.accent; ctx.font = '24px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u2191 SKIP PRACTICE   \u00b7   \u2193 SKIP ALL', W / 2, H * 0.38 - 60);


  ctx.restore();
}

function drawWaitingNavigation() {
  const pulse = 0.5 + Math.sin(state.tick * 0.06) * 0.4;
  const done = state.transitionTimer > 0;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  ctx.globalAlpha = done ? 0.6 : pulse;
  ctx.fillStyle = done ? C.ok : C.accent;
  ctx.font = 'bold 32px Courier New';
  ctx.fillText(done ? 'NICE' : 'MOVE THE FOCUS', W / 2, H * 0.38);

  if (!done) {
    const drawDir = (label, isDone, x) => {
      ctx.globalAlpha = isDone ? 0.9 : pulse * 0.4;
      ctx.fillStyle = isDone ? C.ok : C.accent;
      ctx.font = 'bold 108px Courier New';
      ctx.fillText(label, x, H - 90);
      if (isDone) {
        ctx.font = '14px Courier New';
        ctx.fillText('DONE', x, H - 30);
      }
    };
    drawDir('\u2190', state.onboardNavLeft,  W / 2 - 120);
    drawDir('\u2192', state.onboardNavRight, W / 2 + 120);
  }

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = C.accent; ctx.font = '24px Courier New';
  ctx.fillText('\u2191 SKIP PRACTICE   \u00b7   \u2193 SKIP ALL', W / 2, H * 0.38 - 60);

  ctx.restore();
}

function drawWaitingAction() {
  const fadeAlpha = state.transitionTimer === 0 ? 1 : Math.max(0, (state.transitionTimer - 30) / 30);
  const pulse = 0.5 + Math.sin(state.tick * 0.06) * 0.4;
  const wrongChar = state.chars[state.onboardWrongCharId];
  const holding = state.transferFrom === state.onboardWrongCharId;
  const onWrong = state.cursor === state.onboardWrongCharId;

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // Fast white flicker on held piece (after SELECT — breaks the usual pattern)
  if (holding && !state.onboardActionTaken && wrongChar && wrongChar.slot !== null && wrongChar.slot !== -1) {
    const sc = elemScale;
    const sy = wrongChar.y - Math.round(52 * sc);
    const hy = sy - Math.round(42 * sc);
    if ((state.tick % 6) < 3) {
      const s = SHAPES[wrongChar.slot % SHAPES.length];
      const sz = Math.max(3, Math.round(5 * sc));
      const cx = wrongChar.x, cy = hy + Math.round(8 * sc);
      ctx.globalAlpha = fadeAlpha * 0.9;
      ctx.fillStyle = '#ffffff';
      s.forEach((row, ry) => row.forEach((cell, rx) => {
        if (!cell) return;
        ctx.fillRect(cx + rx * sz - sz, cy + ry * sz - sz, sz - 1, sz - 1);
      }));
    }
  }

  // Central instruction text — three states
  let text, textColor;
  if (state.onboardActionTaken) {
    text = 'DONE'; textColor = C.ok;
  } else if (holding) {
    text = 'PASS IT OR DROP IT'; textColor = C.accent;
  } else if (onWrong) {
    text = 'SELECT OR DROP'; textColor = C.accent;
  } else {
    text = '\u2190 ' + (ROLES[state.onboardWrongCharId] || '?') + ' \u2192'; textColor = C.bright;
  }
  ctx.globalAlpha = fadeAlpha * (state.onboardActionTaken ? 0.6 : pulse);
  ctx.fillStyle = textColor;
  ctx.font = 'bold 32px Courier New';
  ctx.fillText(text, W / 2, H * 0.38);

  // B1 / B2 indicators — only when onWrong or holding
  if ((onWrong || holding) && !state.onboardActionTaken) {
    const cursorChar = state.chars[state.cursor];
    const passActive = holding && wrongChar && cursorChar &&
      cursorChar.id !== wrongChar.id &&
      cursorChar.slot === null &&
      cursorChar.collapseLevel === 0 &&
      cursorChar.slotNeeded === wrongChar.slot;

    const drawBtn = (x, y, num, actionCode, label, color, active) => {
      const r = 24;
      const isUsed = state.onboardActionTaken && state.onboardActionUsed === actionCode;
      if (state.onboardActionTaken && !isUsed) return;
      ctx.globalAlpha = fadeAlpha * (isUsed ? 0.6 : (active ? pulse : 0.25));
      const c = isUsed ? C.ok : (active ? color : C.mid);
      ctx.fillStyle = 'rgba(10,10,10,0.6)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = active && !isUsed ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = c; ctx.font = 'bold 54px Courier New'; ctx.fillText(num, x, y);
      ctx.font = '11px Courier New'; ctx.fillText(label, x, y + r + 12);
    };

    if (holding) {
      drawBtn(W / 2 - 80, H - 60, '1', 'P1_1', 'PASS', C.ok, passActive);
      drawBtn(W / 2 + 80, H - 60, '2', 'P1_2', 'DROP', C.danger, true);
    } else {
      drawBtn(W / 2 - 80, H - 60, '1', 'P1_1', 'SELECT', C.ok, true);
      drawBtn(W / 2 + 80, H - 60, '2', 'P1_2', 'DROP', C.danger, true);
    }
  }

  // Skip hint
  ctx.globalAlpha = fadeAlpha * 0.7;
  ctx.fillStyle = C.accent; ctx.font = '24px Courier New'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u2191 SKIP PRACTICE   \u00b7   \u2193 SKIP ALL', W / 2, H * 0.38 - 60);

  ctx.restore();
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

  if (c.id !== state.cursor) {
    ctx.fillStyle = reduced ? '#333' : C.mid;
    ctx.font = slotFont; ctx.textAlign = 'center';
    ctx.fillText(c.role, c.x, c.y + Math.round(26 * sc));
  }
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

  // ── CONTROL HINTS ──────────────────────────────────────────────────────────
  function drawSegs(segs, y) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let tw = 0; for (const [t] of segs) tw += ctx.measureText(t).width;
    let cx = W / 2 - tw / 2;
    for (const [t, col] of segs) { ctx.fillStyle = col; ctx.fillText(t, cx, y); cx += ctx.measureText(t).width; }
  }

  if (state.phase !== 'playing') return; // no hints during onboarding phases

  if (state.transferFrom !== null) {
    // Contextual: piece in hand — tell player what to do
    ctx.save();
    ctx.fillStyle = 'rgba(10,10,10,0.88)'; ctx.fillRect(W/2 - 300, H - 58, 600, 42);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.strokeRect(W/2 - 300, H - 58, 600, 42);
    ctx.font = 'bold 22px Courier New';
    drawSegs([
      ['\u2190 \u2192 ', C.accent], ['SELECT TEAMMATE', C.white],
      ['   ', C.mid], ['B1 ', C.accent], ['PASS', C.ok],
      ['   ', C.mid], ['B2 ', C.accent], ['CANCEL', C.white],
    ], H - 37);
    ctx.restore();
  } else if (state.tick < 660) {
    const alpha = Math.min(1, (660 - state.tick) / 90) * 0.82;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(10,10,10,0.78)'; ctx.fillRect(W/2 - 350, H - 72, 700, 60);
    ctx.font = '22px Courier New';
    drawSegs([
      ['\u2190 \u2192 ', C.accent], ['AIM', C.white],
      ['   ', C.mid], ['B1 ', C.accent], ['ASSIGN PIECE', C.white],
      ['   ', C.mid], ['B2 ', C.accent], ['REJECT', C.white],
    ], H - 52);
    drawSegs([
      ['TRANSFER: ', C.ok], ['B1 ', C.accent], ['lift', C.white],
      [' \u2192 aim \u2192 ', C.mid], ['B1 ', C.accent], ['pass', C.white],
      ['      ', C.mid], ['B3/B4 ', C.accent], ['spread team', C.white],
    ], H - 26);
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

// ─── AUDIO SYSTEM ─────────────────────────────────────────────────────────────
const ARP_HZ   = [146.83, 174.61, 220.00, 261.63]; // D3 F3 A3 C4
const BEAT_S   = 60 / 124;                          // 0.484s @ 124 BPM

let audioCtx   = null;
let A          = null;  // audio nodes bundle
let arpIdx     = 0;
let nextBeat   = 0;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();

  // Reverb impulse (white noise × exponential decay)
  const reverb  = audioCtx.createConvolver();
  const rlen    = Math.floor(audioCtx.sampleRate * 1.2);
  const rbuf    = audioCtx.createBuffer(2, rlen, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = rbuf.getChannelData(ch);
    for (let i = 0; i < rlen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rlen, 2.5);
  }
  reverb.buffer = rbuf;

  const masterGain = audioCtx.createGain(); masterGain.gain.value = 0.001;
  const reverbGain = audioCtx.createGain(); reverbGain.gain.value = 0.28;
  reverb.connect(reverbGain); reverbGain.connect(masterGain);
  masterGain.connect(audioCtx.destination);

  // Bass — sine, D1
  const bassOsc = audioCtx.createOscillator();
  bassOsc.type = 'sine'; bassOsc.frequency.value = 36.71;
  const bassGain = audioCtx.createGain(); bassGain.gain.value = 0.001;
  bassOsc.connect(bassGain); bassGain.connect(masterGain); bassOsc.start();

  // Arp — sawtooth + lowpass, D3
  const arpOsc = audioCtx.createOscillator();
  arpOsc.type = 'sawtooth'; arpOsc.frequency.value = ARP_HZ[0];
  const arpFilter = audioCtx.createBiquadFilter();
  arpFilter.type = 'lowpass'; arpFilter.frequency.value = 700; arpFilter.Q.value = 1.0;
  const arpGain = audioCtx.createGain(); arpGain.gain.value = 0.001;
  arpOsc.connect(arpFilter); arpFilter.connect(arpGain);
  arpGain.connect(reverb); arpGain.connect(masterGain); arpOsc.start();

  // Pad — sine, D2
  const padOsc = audioCtx.createOscillator();
  padOsc.type = 'sine'; padOsc.frequency.value = 73.42; padOsc.detune.value = 7;
  const padFilter = audioCtx.createBiquadFilter();
  padFilter.type = 'lowpass'; padFilter.frequency.value = 400;
  const padGain = audioCtx.createGain(); padGain.gain.value = 0.001;
  padOsc.connect(padFilter); padFilter.connect(padGain);
  padGain.connect(reverb); padOsc.start();

  A = { masterGain, bassOsc, bassGain, arpOsc, arpFilter, arpGain, padOsc, padGain, beatActive: false, arpSpeed: 1.0, ending: false };
  nextBeat = audioCtx.currentTime;

  setInterval(scheduleBeat, 50);
  scheduleArp();
  setInterval(updateAudio, 100);
}

function scheduleBeat() {
  if (!A || !audioCtx) return;
  const now = audioCtx.currentTime;
  while (nextBeat < now + 0.15) {
    if (A.beatActive && !A.ending) {
      const on = Math.max(nextBeat, now);
      A.bassGain.gain.setTargetAtTime(0.45, on, 0.01);
      A.bassGain.gain.setTargetAtTime(0.001, on + BEAT_S * 0.5, 0.05);
    } else {
      A.bassGain.gain.setTargetAtTime(0.001, now, 0.1);
    }
    nextBeat += BEAT_S;
  }
}

function scheduleArp() {
  if (!A || !audioCtx) return;
  if (!A.ending) {
    A.arpOsc.frequency.setTargetAtTime(ARP_HZ[arpIdx], audioCtx.currentTime, 0.02);
    arpIdx = (arpIdx + 1) % ARP_HZ.length;
  }
  setTimeout(scheduleArp, (BEAT_S / 2 / (A ? A.arpSpeed : 1)) * 1000);
}

function updateAudio() {
  if (!A || !audioCtx || !state || A.ending) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const { phase, subdivTimer, subdivTimerMax, chars, firstPieceLanded } = state;
  const now = audioCtx.currentTime, ramp = 0.3;

  let targetMaster = 1.0;
  if (phase === 'waiting_for_movement' || phase === 'waiting_for_navigation') targetMaster = 0.04;
  else if (phase === 'waiting_for_action') targetMaster = 0.4;
  else if (phase === 'win' || phase === 'gameover') return;
  A.masterGain.gain.linearRampToValueAtTime(targetMaster, now + ramp);
  A.beatActive = firstPieceLanded && phase === 'playing';

  const ratio = subdivTimerMax > 0 ? subdivTimer / subdivTimerMax : 1;
  A.bassOsc.frequency.linearRampToValueAtTime(ratio > 0.6 ? 36.71 : ratio > 0.3 ? 41.20 : 46.25, now + ramp);
  A.arpFilter.frequency.linearRampToValueAtTime(ratio > 0.6 ? 700 : ratio > 0.3 ? 1200 : 2200, now + ramp);
  A.arpOsc.detune.linearRampToValueAtTime(ratio < 0.3 ? 100 : 0, now + ramp);
  A.arpSpeed = ratio > 0.6 ? 1.0 : 1.5;

  const h = Math.min(Math.max(chars.filter(c => c.collapseLevel === 0).length, 1), 4) - 1;
  A.padGain.gain.linearRampToValueAtTime([0.0, 0.08, 0.3, 0.6][h], now + ramp);
  A.arpGain.gain.linearRampToValueAtTime([0.15, 0.28, 0.5, 0.5][h], now + ramp);
}

function audioOnTransfer() {
  if (!A || !audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
  osc.type = 'sine'; osc.frequency.value = 880;
  g.gain.setValueAtTime(0.25, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(g); g.connect(A.masterGain); osc.start(now); osc.stop(now + 0.09);
}

function audioOnSubdivComplete() {
  if (!A || !audioCtx) return;
  const now = audioCtx.currentTime;
  [261.63, 329.63, 392.00].forEach((freq, i) => {
    const t = now + i * 0.1;
    const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g); g.connect(A.masterGain); osc.start(t); osc.stop(t + 0.16);
  });
}

function audioOnCollapse() {
  if (!A || !audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
  osc.type = 'sine'; osc.frequency.value = 55;
  g.gain.setValueAtTime(0.55, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(g); g.connect(audioCtx.destination); osc.start(now); osc.stop(now + 0.21);
}

function audioOnWin() {
  if (!A || !audioCtx) return;
  A.ending = true;
  const now = audioCtx.currentTime;
  A.arpOsc.frequency.linearRampToValueAtTime(146.83, now + 0.5);
  A.bassOsc.frequency.linearRampToValueAtTime(36.71, now + 0.5);
  A.masterGain.gain.linearRampToValueAtTime(0.7, now + 0.5);
  A.masterGain.gain.linearRampToValueAtTime(0.001, now + 2.2);
  setTimeout(() => { if (A) A.ending = false; }, 2400);
}

function audioOnGameOver() {
  if (!A || !audioCtx) return;
  A.ending = true;
  const now = audioCtx.currentTime;
  A.bassOsc.detune.linearRampToValueAtTime(-120, now + 2.0);
  A.arpOsc.detune.linearRampToValueAtTime(-120, now + 2.0);
  A.padOsc.detune.linearRampToValueAtTime(-120, now + 2.0);
  A.masterGain.gain.linearRampToValueAtTime(0.001, now + 2.0);
  setTimeout(() => {
    if (!A) return;
    A.ending = false;
    A.bassOsc.detune.value = 0; A.arpOsc.detune.value = 0; A.padOsc.detune.value = 7;
  }, 2400);
}

window.addEventListener('keydown', initAudio, { once: true });

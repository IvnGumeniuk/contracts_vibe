/* ТИХИЙ КОНТРАКТ — оригинальная стелс-игра для мобильного браузера.
   Ванильный JS, canvas, без библиотек. Вид сверху с плавной следящей камерой. */
'use strict';

/* ═════════════ УТИЛИТЫ ═════════════ */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
function angDiff(a, b) { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

const TILE = { WALL: 0, FLOOR: 1, OUT: 2 };
const CLR = { PUBLIC: 0, STAFF: 1, SECURE: 2 };
const DISGUISE = {
  suit:  { name: 'Костюм гостя', prof: 'guest', clr: CLR.PUBLIC },
  staff: { name: 'Форма персонала', prof: 'staff', clr: CLR.STAFF },
  guard: { name: 'Форма охраны', prof: 'guard', clr: CLR.SECURE }
};
const STATE = ['спокоен', 'заинтересован', 'проверяет', 'подозревает', 'ищет', 'тревога', 'бой'];

/* ═════════════ АУДИО ═════════════ */
class Audio2 {
  constructor() { this.ok = false; }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nb = b;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 44; g.gain.value = .012;
      f.type = 'lowpass'; f.frequency.value = 150;
      o.connect(f); f.connect(g); g.connect(this.ctx.destination); o.start();
      this.hum = g;
      this.ok = true;
    } catch (e) { }
  }
  tone(fq, dur, gain, type, pan) {
    if (!this.ok) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(fq, c.currentTime);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
    let node = g;
    if (pan !== undefined && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); node = p; }
    o.connect(g); node.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  }
  noise(dur, gain, fq, q, pan) {
    if (!this.ok) return;
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nb; f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q || 1;
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
    let node = g;
    if (pan !== undefined && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); node = p; }
    s.connect(f); f.connect(g); node.connect(c.destination); s.start(); s.stop(c.currentTime + dur);
  }
  step(pan, hard) { this.noise(.06, hard ? .05 : .03, hard ? 1800 : 900, 1.2, pan); }
  shot(sil, pan) { sil ? this.noise(.09, .12, 1400, .8, pan) : (this.noise(.22, .35, 700, .5, pan), this.tone(90, .3, .25, 'square', pan)); }
  door(pan) { this.noise(.2, .07, 380, .9, pan); }
  hit(pan) { this.noise(.13, .16, 260, .7, pan); this.tone(70, .18, .12, 'sine', pan); }
  alert() { this.tone(880, .18, .1, 'square'); setTimeout(() => this.tone(660, .3, .09, 'square'), 150); }
  pickup() { this.tone(720, .1, .06, 'triangle'); this.tone(1080, .14, .04, 'sine'); }
  alarm() { this.tone(520, .5, .08, 'square'); setTimeout(() => this.tone(400, .5, .08, 'square'), 320); }
}

/* ═════════════ УРОВЕНЬ ═════════════ */
class Level {
  constructor() {
    this.W = 62; this.H = 34;
    this.grid = new Uint8Array(this.W * this.H);
    this.zones = []; this.doors = []; this.props = []; this.lights = [];
    this.build();
    this.lightGrid = new Float32Array(this.W * this.H);
    this.bake();
  }
  at(x, y) { return (x < 0 || y < 0 || x >= this.W || y >= this.H) ? TILE.WALL : this.grid[y * this.W + x]; }
  set(x, y, v) { if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.grid[y * this.W + x] = v; }
  rect(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }

  build() {
    this.grid.fill(TILE.WALL);
    const R = (x, y, w, h, name, clr, out) => {
      this.rect(x, y, w, h, out ? TILE.OUT : TILE.FLOOR);
      this.zones.push({ x, y, w, h, name, clr: clr, out: !!out });
    };
    // ── верхний ярус
    R(2, 2, 14, 10, 'Парковка', CLR.PUBLIC, true);
    R(21, 2, 13, 10, 'Холл', CLR.PUBLIC);
    R(35, 2, 8, 5, 'Ресепшн', CLR.PUBLIC);
    R(35, 8, 8, 4, 'Уборные', CLR.PUBLIC);
    R(48, 2, 12, 10, 'Ресторан', CLR.PUBLIC);
    // ── коридоры
    R(17, 2, 3, 30, 'Лестничный холл', CLR.PUBLIC);
    R(44, 2, 3, 30, 'Служебный проход', CLR.STAFF);
    R(17, 13, 43, 2, 'Коридор', CLR.STAFF);
    R(17, 23, 43, 2, 'Коридор', CLR.STAFF);
    // ── средний ярус
    R(2, 16, 14, 6, 'Генераторная', CLR.STAFF);
    R(21, 16, 13, 6, 'Кабинеты', CLR.STAFF);
    R(35, 16, 8, 6, 'Кабинет цели', CLR.SECURE);
    R(48, 16, 12, 6, 'Кухня', CLR.STAFF);
    // ── нижний ярус
    R(2, 26, 14, 6, 'Прачечная', CLR.STAFF);
    R(21, 26, 13, 6, 'Пост охраны', CLR.SECURE);
    R(35, 26, 8, 6, 'Серверная', CLR.SECURE);
    R(48, 26, 12, 6, 'Склад', CLR.STAFF);

    // ── двери
    const D = (x, y, lock) => { this.doors.push({ x, y, open: false, locked: lock || 0, t: 0 }); this.set(x, y, TILE.FLOOR); };
    D(16, 7); D(20, 7); D(34, 4); D(38, 7); D(43, 4); D(47, 6);
    D(26, 12); D(38, 12); D(53, 12);
    D(16, 18); D(16, 28);
    D(26, 15); D(38, 15, 2); D(53, 15);
    D(26, 22); D(38, 22, 2); D(53, 22);
    D(26, 25, 1); D(38, 25, 1); D(53, 25);

    // ── объекты
    const P = (t, x, y, o) => this.props.push(Object.assign({ t, x, y, used: false }, o || {}));
    P('exit', 2, 7, { label: 'Выход через парковку' });
    P('exit', 59, 29, { label: 'Чёрный ход' });
    P('docs', 38, 29, { label: 'Папка: схемы объекта', id: 'd1' });
    P('docs', 24, 18, { label: 'Папка: переписка цели', id: 'd2' });
    P('keycard', 25, 29, { label: 'Пропуск охраны' });
    P('locker', 4, 4, {}); P('locker', 4, 29, {}); P('locker', 50, 18, {}); P('locker', 50, 29, {});
    P('generator', 4, 18, {});
    P('terminal', 29, 29, { label: 'Пульт видеонаблюдения' });
    P('food', 51, 17, { label: 'Поднос с ужином цели' });
    P('vent', 50, 30, { link: [41, 20] }); P('vent', 41, 20, { link: [50, 30] });
    P('switch', 27, 17, { room: 'Кабинеты' });
    P('switch', 39, 17, { room: 'Кабинет цели' });
    P('switch', 52, 24, { room: 'Коридор' });
    // камеры
    P('camera', 24, 13, { dir: 0.6, alive: true });
    P('camera', 39, 16, { dir: 1.9, alive: true });
    P('camera', 51, 23, { dir: 3.5, alive: true });

    // ── источники света (группы: 0 общие, 1 служебные — гаснут от генератора)
    const L = (x, y, r, g) => this.lights.push({ x, y, r, g: g || 0, on: true });
    L(27, 6, 9); L(38, 4, 7); L(38, 10, 6); L(53, 6, 9); L(9, 6, 8);
    L(18, 8, 7); L(18, 20, 7); L(18, 28, 7);
    L(24, 14, 8, 1); L(34, 14, 8, 1); L(44, 14, 8, 1); L(54, 14, 8, 1);
    L(24, 24, 8, 1); L(34, 24, 8, 1); L(44, 24, 8, 1); L(54, 24, 8, 1);
    L(8, 19, 8, 1); L(27, 19, 8, 1); L(38, 19, 7, 1); L(53, 19, 8, 1);
    L(8, 29, 8, 1); L(27, 29, 8, 1); L(38, 29, 7, 1); L(53, 29, 8, 1);
  }
  zoneAt(x, y) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h) return z;
    }
    return { name: '—', clr: CLR.PUBLIC, out: false };
  }
  doorAt(x, y) { return this.doors.find(d => d.x === (x | 0) && d.y === (y | 0)); }
  blocked(x, y) {
    if (this.at(x | 0, y | 0) === TILE.WALL) return true;
    const d = this.doorAt(x, y);
    return !!(d && !d.open);
  }
  /* мягкий свет: волновой расчёт по проходимым клеткам */
  bake() {
    const W = this.W, H = this.H, g = this.lightGrid;
    g.fill(0.06);
    for (const L of this.lights) {
      if (!L.on) continue;
      const seen = new Float32Array(W * H);
      const q = [[L.x, L.y, 1]];
      seen[L.y * W + L.x] = 1;
      while (q.length) {
        const [x, y, v] = q.shift();
        const i = y * W + x;
        if (g[i] < v) g[i] = Math.min(1, g[i] + v * .9);
        const nv = v - 1 / L.r;
        if (nv <= .05) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, ni = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (this.at(nx, ny) === TILE.WALL) continue;
          if (seen[ni] >= nv) continue;
          seen[ni] = nv; q.push([nx, ny, nv]);
        }
      }
    }
  }
  light(x, y) {
    const i = (y | 0) * this.W + (x | 0);
    return (i >= 0 && i < this.lightGrid.length) ? this.lightGrid[i] : .06;
  }
  los(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by), n = Math.ceil(d * 3);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.blocked(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }
}

/* ═════════════ НАВИГАЦИЯ ═════════════ */
class Nav {
  constructor(lv) { this.lv = lv; }
  path(sx, sy, tx, ty) {
    const lv = this.lv, W = lv.W, H = lv.H;
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    if (sx === tx && sy === ty) return [];
    const prev = new Int32Array(W * H).fill(-1);
    const q = [sy * W + sx]; prev[sy * W + sx] = sy * W + sx;
    const goal = ty * W + tx;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === goal) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -1) continue;
        if (lv.at(nx, ny) === TILE.WALL) continue;
        prev[ni] = cur; q.push(ni);
      }
    }
    if (prev[goal] === -1) return [];
    const out = []; let c = goal;
    while (c !== sy * W + sx) { out.push([(c % W) + .5, ((c / W) | 0) + .5]); c = prev[c]; if (out.length > 900) break; }
    return out.reverse();
  }
}

/* ═════════════ ЧАСТИЦЫ И СЛЕДЫ ═════════════ */
class Particles {
  constructor() { this.p = []; this.decals = []; }
  spawn(x, y, n, col, spd, life, size) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), s = rnd(spd * .3, spd);
      this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, l: life, m: life, c: col, r: size || .06 });
    }
  }
  decal(x, y, type, a) {
    this.decals.push({ x, y, type, a: (a === undefined ? rnd(0, 6.283) : a), r: rnd(.18, .34), seen: false });
    if (this.decals.length > 160) this.decals.shift();
  }
  update(dt) {
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .92; q.vy *= .92; q.l -= dt;
      if (q.l <= 0) this.p.splice(i, 1);
    }
  }
}

/* ═════════════ ИНВЕНТАРЬ ═════════════ */
const ITEMS = [
  { id: 'fist', n: 'Голыми руками', d: 'Оглушение со спины. Тихо, если никто не смотрит.', q: -1, kind: 'melee', lethal: 0, noise: 1.5 },
  { id: 'wire', n: 'Струна', d: 'Бесшумное летальное устранение со спины.', q: -1, kind: 'melee', lethal: 1, noise: 0 },
  { id: 'knife', n: 'Нож', d: 'Летально, оставляет кровь. Можно метнуть — не советую.', q: 1, kind: 'melee', lethal: 1, noise: 2, blood: 1 },
  { id: 'syringe', n: 'Шприц со снотворным', d: 'Тихо усыпляет цель со спины.', q: 2, kind: 'melee', lethal: 0, noise: 0 },
  { id: 'silenced', n: 'Пистолет с глушителем', d: 'Тихий выстрел, но труп остаётся.', q: 9, kind: 'gun', sil: 1, dmg: 100, noise: 3.5 },
  { id: 'pistol', n: 'Пистолет', d: 'Громко. Очень громко.', q: 12, kind: 'gun', sil: 0, dmg: 100, noise: 22 },
  { id: 'coin', n: 'Монеты', d: 'Бросок: шум в стороне, отвлекает.', q: 6, kind: 'throw', noise: 7 },
  { id: 'bottle', n: 'Бутылка', d: 'Бросок: громче монеты, разбивается.', q: 2, kind: 'throw', noise: 11 },
  { id: 'poison', n: 'Яд', d: 'Отравить еду или напиток. Смерть выглядит естественной.', q: 1, kind: 'use' },
  { id: 'pick', n: 'Отмычка', d: 'Вскрывает простые замки. Требует времени.', q: -1, kind: 'tool' },
  { id: 'keycard', n: 'Пропуск охраны', d: 'Открывает охраняемые двери.', q: 0, kind: 'tool' }
];
class Inventory {
  constructor(diff) {
    this.items = ITEMS.map(i => Object.assign({}, i));
    const mul = [1.3, 1, .7, .5][diff];
    this.items.forEach(i => { if (i.q > 0) i.q = Math.max(1, Math.round(i.q * mul)); });
    this.sel = 0;
    this.docs = [];
  }
  get cur() { return this.items[this.sel]; }
  get(id) { return this.items.find(i => i.id === id); }
  has(id) { const i = this.get(id); return i && i.q !== 0; }
  use(id) { const i = this.get(id); if (i && i.q > 0) i.q--; }
}

/* ═════════════ ПЕРСОНАЖИ ═════════════ */
class Actor {
  constructor(x, y) {
    this.x = x; this.y = y; this.a = 0; this.vx = 0; this.vy = 0; this.r = .32;
    this.hp = 100; this.dead = false; this.down = false;
  }
  move(lv, dx, dy, dt) {
    const nx = this.x + dx * dt, ny = this.y + dy * dt;
    if (!this.hits(lv, nx, this.y)) this.x = nx;
    if (!this.hits(lv, this.x, ny)) this.y = ny;
  }
  hits(lv, x, y) {
    const r = this.r;
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]])
      if (lv.blocked(x + ox, y + oy)) return true;
    return false;
  }
}

class Player extends Actor {
  constructor(x, y, inv) {
    super(x, y);
    this.inv = inv; this.disguise = 'suit';
    this.crouch = false; this.run = false;
    this.noise = 0; this.dragging = null;
    this.stepT = 0; this.actT = 0; this.spotted = false;
  }
  get speed() { return this.dragging ? 1.25 : this.crouch ? 1.5 : this.run ? 4.4 : 2.7; }
  get noiseR() { return this.dragging ? 3 : this.crouch ? 0.4 : this.run ? 6.5 : 2.4; }
  get clr() { return DISGUISE[this.disguise].clr; }
  get prof() { return DISGUISE[this.disguise].prof; }
}

class NPC extends Actor {
  constructor(x, y, kind, opt) {
    super(x, y);
    this.kind = kind;                 // guard | staff | civilian | target
    this.prof = kind === 'guard' ? 'guard' : kind === 'staff' ? 'staff' : 'guest';
    this.name = (opt && opt.name) || (kind === 'guard' ? 'Охранник' : kind === 'staff' ? 'Персонал' : 'Гость');
    this.route = (opt && opt.route) || [[x, y]];
    this.ri = 0; this.path = []; this.wait = 0;
    this.susp = 0; this.state = 0; this.lastSeen = null;
    this.searchT = 0; this.repathT = 0; this.talkT = 0;
    this.baseFov = kind === 'guard' ? 1.0 : .8;
    this.baseRange = kind === 'guard' ? 10 : 7.5;
    this.armed = kind === 'guard';
    this.shootT = 0; this.hidden = false; this.found = false; this.poisoned = 0;
  }
}

/* ═════════════ МИССИЯ ═════════════ */
class Mission {
  constructor() {
    this.obj = [
      { id: 'docs', t: 'Найти две папки документов (0/2)', done: false },
      { id: 'kill', t: 'Устранить цель', done: false },
      { id: 'exit', t: 'Покинуть объект', done: false }
    ];
    this.stats = { alarm: false, spotted: false, kills: 0, bodiesFound: 0, witnessed: false, natural: false, time: 0 };
  }
  set(id, txt, done) { const o = this.obj.find(o => o.id === id); if (o) { if (txt) o.t = txt; if (done !== undefined) o.done = done; } }
  rank() {
    const s = this.stats;
    if (!s.alarm && !s.spotted && s.kills <= 1 && s.bodiesFound === 0 && !s.witnessed)
      return { t: s.natural ? 'ТЕНЬ · НЕСЧАСТНЫЙ СЛУЧАЙ' : 'ТЕНЬ', d: 'Никто не понял, что кто-то приходил.' };
    if (!s.alarm && s.kills <= 3) return { t: 'ПРОФЕССИОНАЛ', d: 'Шумно местами, но чисто.' };
    if (!s.alarm) return { t: 'ИСПОЛНИТЕЛЬ', d: 'Работа сделана. Красоты не было.' };
    return { t: 'МЯСНИК', d: 'Объект стоял на ушах. Контракт закрыт, репутация — нет.' };
  }
}

/* ═════════════ СОХРАНЕНИЯ ═════════════ */
const SaveManager = {
  key: 'quiet_contract_v1',
  save(g) {
    try {
      localStorage.setItem(this.key, JSON.stringify({
        diff: g.diff, t: g.time, px: g.player.x, py: g.player.y,
        dis: g.player.disguise, docs: g.player.inv.docs,
        obj: g.mission.obj, stats: g.mission.stats,
        inv: g.player.inv.items.map(i => i.q), targetDead: g.target.dead
      }));
      return true;
    } catch (e) { return false; }
  },
  load() { try { return JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(this.key); } catch (e) { } }
};

/* ═════════════ ВВОД ═════════════ */
class Input {
  constructor() {
    this.dx = 0; this.dy = 0; this.active = false; this.id = null;
    this.ox = 0; this.oy = 0; this.keys = {};
    const zone = $('stickzone'), base = $('stickbase'), knob = $('stickknob');
    const start = (x, y, id) => {
      this.active = true; this.id = id; this.ox = x; this.oy = y; this.dx = this.dy = 0;
      base.style.left = (x - 53) + 'px'; base.style.top = (y - 53) + 'px';
      base.classList.add('on'); knob.style.transform = 'translate(0,0)';
    };
    const move = (x, y) => {
      let dx = x - this.ox, dy = y - this.oy, d = Math.hypot(dx, dy), m = 48;
      if (d > m) { this.ox += dx * (1 - m / d); this.oy += dy * (1 - m / d); dx *= m / d; dy *= m / d; d = m; }
      base.style.left = (this.ox - 53) + 'px'; base.style.top = (this.oy - 53) + 'px';
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.dx = dx / m; this.dy = dy / m;
    };
    const end = () => { this.active = false; this.dx = this.dy = 0; base.classList.remove('on'); };
    zone.addEventListener('touchstart', e => { const t = e.changedTouches[0]; start(t.clientX, t.clientY, t.identifier); e.preventDefault(); }, { passive: false });
    zone.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === this.id) move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    zone.addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === this.id) end(); });
    zone.addEventListener('touchcancel', end);
    zone.addEventListener('mousedown', e => start(e.clientX, e.clientY, 'm'));
    window.addEventListener('mousemove', e => { if (this.active && this.id === 'm') move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (this.id === 'm') end(); });
    window.addEventListener('keydown', e => this.keys[e.key.toLowerCase()] = 1);
    window.addEventListener('keyup', e => this.keys[e.key.toLowerCase()] = 0);
  }
  get vec() {
    let x = this.dx, y = this.dy;
    if (this.keys['a'] || this.keys['arrowleft']) x = -1;
    if (this.keys['d'] || this.keys['arrowright']) x = 1;
    if (this.keys['w'] || this.keys['arrowup']) y = -1;
    if (this.keys['s'] || this.keys['arrowdown']) y = 1;
    const m = Math.hypot(x, y);
    return m > 1 ? [x / m, y / m, 1] : [x, y, m];
  }
}

/* ═════════════ ИГРА ═════════════ */
class Game {
  constructor() {
    this.cv = $('game'); this.cx = this.cv.getContext('2d');
    this.mm = $('map'); this.mx = this.mm.getContext('2d');
    this.audio = new Audio2(); this.input = new Input(); this.fx = new Particles();
    this.diff = 1; this.time = 0; this.cam = { x: 0, y: 0 }; this.msgs = [];
    this.noises = []; this.shots = []; this.alarmT = 0; this.state = 'menu';
    this.shake = 0; this.hudT = 0;
    this.resize(); window.addEventListener('resize', () => this.resize());
    this.bindUI();
    requestAnimationFrame(t => this.loop(t));
  }
  resize() {
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = this.cv.clientWidth || window.innerWidth;
    this.H = this.cv.clientHeight || window.innerHeight;
    this.cv.width = this.W * d; this.cv.height = this.H * d;
    this.cx.setTransform(d, 0, 0, d, 0, 0);
    this.ts = Math.max(26, this.W / 17);
  }

  /* ─── старт ─── */
  start(loaded) {
    this.lv = new Level(); this.nav = new Nav(this.lv);
    const inv = new Inventory(this.diff);
    this.player = new Player(9, 7, inv);
    this.mission = new Mission();
    this.npcs = []; this.bodies = []; this.time = 0; this.alarmT = 0;
    this.fx.p.length = 0; this.fx.decals.length = 0; this.msgs.length = 0;
    this.spawnNPCs();
    if (loaded) this.applySave(loaded);
    this.state = 'play';
    this.log('Вы на парковке. Ночная смена уже началась.');
    this.audio.init();
    this.updateObjectives();
  }
  applySave(s) {
    this.diff = s.diff; this.time = s.t || 0;
    this.player.x = s.px; this.player.y = s.py; this.player.disguise = s.dis || 'suit';
    this.player.inv.docs = s.docs || [];
    if (s.inv) s.inv.forEach((q, i) => { if (this.player.inv.items[i]) this.player.inv.items[i].q = q; });
    if (s.obj) s.obj.forEach(o => this.mission.set(o.id, o.t, o.done));
    if (s.stats) Object.assign(this.mission.stats, s.stats);
    if (s.targetDead) { this.target.dead = true; this.target.down = true; }
    this.player.inv.docs.forEach(id => { const p = this.lv.props.find(p => p.id === id); if (p) p.used = true; });
  }
  spawnNPCs() {
    const G = (x, y, route, name) => this.npcs.push(new NPC(x, y, 'guard', { route, name }));
    const S = (x, y, route, name) => this.npcs.push(new NPC(x, y, 'staff', { route, name }));
    const C = (x, y, route, name) => this.npcs.push(new NPC(x, y, 'civilian', { route, name }));
    G(18, 8, [[18, 6], [18, 20], [18, 29], [18, 12], [26, 13], [40, 13], [26, 13]], 'Охранник смены');
    G(45, 13, [[45, 13], [45, 24], [53, 24], [30, 24], [45, 24]], 'Патруль коридора');
    G(27, 29, [[27, 29], [24, 28], [30, 30], [27, 24], [27, 29]], 'Пост охраны');
    G(39, 19, [[39, 19], [36, 17], [41, 20], [39, 14]], 'Личная охрана');
    S(51, 18, [[51, 18], [55, 20], [51, 17], [53, 21]], 'Повар');
    S(6, 29, [[6, 29], [12, 28], [6, 30], [10, 30]], 'Прачка');
    S(52, 6, [[52, 6], [56, 9], [50, 4], [53, 12], [53, 8]], 'Официант');
    S(24, 19, [[24, 19], [31, 20], [26, 15], [24, 19]], 'Ночной клерк');
    C(27, 7, [[27, 7], [23, 4], [31, 9], [26, 12], [27, 7]], 'Гость отеля');
    C(38, 4, [[38, 4], [40, 5], [36, 3]], 'Портье');
    C(55, 5, [[55, 5], [50, 8], [57, 9], [52, 4]], 'Поздний посетитель');
    this.target = new NPC(38, 18, 'target', {
      name: 'Аркадий Вельш',
      route: [[38, 18], [40, 20], [38, 18], [38, 14], [53, 13], [53, 7], [52, 5], [53, 13], [38, 14]]
    });
    this.target.prof = 'guest'; this.target.baseRange = 8;
    this.npcs.push(this.target);
  }

  /* ─── интерфейс ─── */
  bindUI() {
    const names = ['ЛЕГКО', 'НОРМА', 'ПРОФИ', 'МАСТЕР'];
    const box = $('diffs');
    names.forEach((n, i) => {
      const b = document.createElement('button'); b.textContent = n;
      if (i === 1) b.classList.add('on');
      b.onclick = () => { this.diff = i; [...box.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); };
      box.appendChild(b);
    });
    $('bStart').onclick = () => { this.audio.init(); $('menu').classList.remove('on'); $('brief').classList.add('on'); };
    $('bGo').onclick = () => { $('brief').classList.remove('on'); this.start(null); };
    $('bLoad').onclick = () => {
      const s = SaveManager.load();
      if (!s) { $('bLoad').textContent = 'СОХРАНЕНИЙ НЕТ'; return; }
      this.diff = s.diff; $('menu').classList.remove('on'); this.start(s);
    };
    $('bAgain').onclick = () => { $('fin').classList.remove('on'); $('menu').classList.add('on'); this.state = 'menu'; };
    $('bBag').onclick = () => { this.openBag(); };
    $('bClose').onclick = () => { $('bag').classList.remove('on'); this.state = 'play'; };
    $('bCrouch').onclick = () => { const p = this.player; if (!p) return; p.crouch = !p.crouch; if (p.crouch) p.run = false; this.syncBtns(); };
    $('bRun').onclick = () => { const p = this.player; if (!p) return; p.run = !p.run; if (p.run) p.crouch = false; this.syncBtns(); };
    $('bAct').onclick = () => this.doAction();
    $('bUse').onclick = () => this.doUse();
  }
  syncBtns() {
    $('bCrouch').classList.toggle('on', !!(this.player && this.player.crouch));
    $('bRun').classList.toggle('on', !!(this.player && this.player.run));
  }
  openBag() {
    if (this.state !== 'play') return;
    this.state = 'bag';
    const box = $('bagList'); box.innerHTML = '';
    this.player.inv.items.forEach((it, i) => {
      if (it.q === 0) return;
      const el = document.createElement('div');
      el.className = 'item' + (i === this.player.inv.sel ? ' on' : '');
      el.innerHTML = `<div><b>${it.n}</b><p>${it.d}</p></div><div class="q">${it.q < 0 ? '∞' : it.q}</div>`;
      el.onclick = () => { this.player.inv.sel = i; this.openBag(); };
      box.appendChild(el);
    });
    this.player.inv.docs.forEach(d => {
      const el = document.createElement('div'); el.className = 'item';
      el.innerHTML = `<div><b>Документы</b><p>Собранная папка (${d})</p></div>`;
      box.appendChild(el);
    });
    $('bag').classList.add('on');
  }
  log(t) { this.msgs.push({ t, l: 5 }); if (this.msgs.length > 3) this.msgs.shift(); }

  /* ─── контекстные действия ─── */
  nearProp() {
    const p = this.player; let best = null, bd = 1.35;
    for (const pr of this.lv.props) {
      const d = dist(p.x, p.y, pr.x + .5, pr.y + .5);
      if (d < bd) { bd = d; best = pr; }
    }
    return best;
  }
  nearDoor() {
    const p = this.player;
    return this.lv.doors.find(d => dist(p.x, p.y, d.x + .5, d.y + .5) < 1.15);
  }
  nearBody() {
    const p = this.player; let best = null, bd = 1.2;
    for (const b of this.npcs) {
      if (!b.down || b.hidden) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  nearVictim() {
    const p = this.player; let best = null, bd = 1.25;
    for (const n of this.npcs) {
      if (n.down) continue;
      const d = dist(p.x, p.y, n.x, n.y);
      if (d > bd) continue;
      const toP = Math.atan2(p.y - n.y, p.x - n.x);
      if (Math.abs(angDiff(toP, n.a)) < 1.5) continue;   // смотрит на вас — не выйдет
      bd = d; best = n;
    }
    return best;
  }
  promptText() {
    const p = this.player;
    if (p.dragging) {
      const pr = this.nearProp();
      if (pr && pr.t === 'locker') return 'ДЕЙСТВИЕ · спрятать тело в шкаф';
      return 'ДЕЙСТВИЕ · бросить тело';
    }
    const v = this.nearVictim();
    if (v) {
      const it = p.inv.cur;
      return 'ДЕЙСТВИЕ · ' + (it.kind === 'melee'
        ? (it.lethal ? 'устранить: ' + it.n : 'оглушить: ' + it.n)
        : 'оглушить со спины');
    }
    const b = this.nearBody();
    if (b) return b.prof !== 'guest' && b.prof !== p.prof ? 'ДЕЙСТВИЕ · тащить тело · ПРИМЕНИТЬ · переодеться' : 'ДЕЙСТВИЕ · тащить тело';
    const pr = this.nearProp();
    if (pr) {
      if (pr.t === 'exit') return this.canExit() ? 'ДЕЙСТВИЕ · уйти с объекта' : 'Задание не выполнено';
      if (pr.t === 'docs' && !pr.used) return 'ДЕЙСТВИЕ · забрать: ' + pr.label;
      if (pr.t === 'keycard' && !pr.used) return 'ДЕЙСТВИЕ · забрать пропуск';
      if (pr.t === 'generator') return pr.used ? 'Генератор выведен из строя' : 'ДЕЙСТВИЕ · вывести генератор из строя';
      if (pr.t === 'terminal') return pr.used ? 'Камеры отключены' : 'ДЕЙСТВИЕ · отключить камеры';
      if (pr.t === 'switch') return 'ДЕЙСТВИЕ · щёлкнуть выключателем';
      if (pr.t === 'vent') return 'ДЕЙСТВИЕ · пролезть по вентиляции';
      if (pr.t === 'food') return pr.used ? 'Еда отравлена' : (p.inv.cur.id === 'poison' ? 'ПРИМЕНИТЬ · отравить еду' : 'Поднос с ужином');
      if (pr.t === 'locker') return 'Шкаф';
    }
    const d = this.nearDoor();
    if (d) {
      if (d.locked === 2 && !p.inv.has('keycard')) return 'Закрыто на пропуск охраны';
      if (d.locked === 1 && !d.open) return 'ДЕЙСТВИЕ · вскрыть замок отмычкой';
      return 'ДЕЙСТВИЕ · ' + (d.open ? 'закрыть дверь' : 'открыть дверь');
    }
    return '';
  }
  doAction() {
    if (this.state !== 'play') return;
    const p = this.player, lv = this.lv;
    if (p.actT > 0) return;
    if (p.dragging) {
      const pr = this.nearProp();
      const b = p.dragging;
      if (pr && pr.t === 'locker') {
        b.hidden = true; b.x = pr.x + .5; b.y = pr.y + .5;
        this.log('Тело спрятано в шкафу.'); this.audio.door();
      } else this.log('Тело брошено на пол.');
      p.dragging = null; return;
    }
    const v = this.nearVictim();
    if (v) return this.takedown(v);
    const b = this.nearBody();
    if (b) { p.dragging = b; this.log('Вы тащите тело. Двигаетесь медленно.'); return; }
    const pr = this.nearProp();
    if (pr) return this.useProp(pr);
    const d = this.nearDoor();
    if (d) {
      if (d.locked === 2) {
        if (!p.inv.has('keycard')) { this.log('Нужен пропуск охраны.'); return; }
        d.locked = 0; this.log('Пропуск подошёл.'); this.audio.pickup();
      }
      if (d.locked === 1) {
        p.actT = [1.4, 2, 2.8, 3.4][this.diff];
        p.actTarget = d; this.log('Вскрываете замок…'); return;
      }
      d.open = !d.open; this.audio.door(this.pan(d.x, d.y));
      this.noise(d.x + .5, d.y + .5, 3);
      return;
    }
  }
  doUse() {
    if (this.state !== 'play') return;
    const p = this.player, it = p.inv.cur;
    const pr = this.nearProp();
    if (pr && pr.t === 'food' && it.id === 'poison' && !pr.used) {
      pr.used = true; p.inv.use('poison'); this.mission.stats.natural = true;
      this.log('Яд в ужине. Официант отнесёт поднос в ресторан — цель придёт туда сама.'); this.audio.pickup(); return;
    }
    const b = this.nearBody();
    if (b && !p.dragging && b.prof !== 'guest' && b.prof !== p.prof) {
      p.disguise = b.prof === 'guard' ? 'guard' : 'staff';
      this.log('Вы переоделись: ' + DISGUISE[p.disguise].name + '.'); this.audio.pickup(); return;
    }
    if (it.kind === 'gun') {
      if (it.q <= 0) { this.log('Патроны кончились.'); return; }
      it.q--; this.shoot(it); return;
    }
    if (it.kind === 'throw') {
      if (it.q <= 0) { this.log('Кидать нечего.'); return; }
      it.q--; this.throwItem(it); return;
    }
    this.log('Здесь это не применить.');
  }
  useProp(pr) {
    const p = this.player;
    if (pr.t === 'exit') {
      if (this.canExit()) return this.finish();
      this.log('Сначала — документы и цель.'); return;
    }
    if (pr.t === 'docs' && !pr.used) {
      pr.used = true; p.inv.docs.push(pr.id); this.audio.pickup();
      this.log('Забрано: ' + pr.label); this.updateObjectives(); SaveManager.save(this); return;
    }
    if (pr.t === 'keycard' && !pr.used) {
      pr.used = true; p.inv.get('keycard').q = 1; this.audio.pickup();
      this.log('Пропуск охраны у вас.'); return;
    }
    if (pr.t === 'generator' && !pr.used) {
      pr.used = true;
      this.lv.lights.forEach(l => { if (l.g === 1) l.on = false; });
      this.lv.bake(); this.audio.noise(.6, .2, 220, .6);
      this.log('Свет в служебных зонах погас. Кто-то пойдёт проверять.');
      this.noise(pr.x, pr.y, 9);
      this.npcs.forEach(n => { if (n.kind === 'staff' && !n.down) this.alertTo(n, pr.x, pr.y, 45); });
      return;
    }
    if (pr.t === 'terminal' && !pr.used) {
      pr.used = true;
      this.lv.props.forEach(c => { if (c.t === 'camera') c.alive = false; });
      this.audio.pickup(); this.log('Камеры отключены. Записи стёрты.'); return;
    }
    if (pr.t === 'switch') {
      const near = this.lv.lights.filter(l => dist(l.x, l.y, pr.x, pr.y) < 7);
      const st = !near[0] || !near[0].on;
      near.forEach(l => l.on = st); this.lv.bake();
      this.audio.tone(300, .08, .05, 'square');
      this.log(st ? 'Свет включён.' : 'Свет выключен.');
      this.noise(pr.x, pr.y, 2.5); return;
    }
    if (pr.t === 'vent') {
      p.x = pr.link[0] + .5; p.y = pr.link[1] + .5;
      this.audio.noise(.35, .06, 500, 1);
      this.log('Вы пролезли по вентиляции.'); return;
    }
  }
  takedown(v) {
    const p = this.player, it = p.inv.cur;
    const lethal = it.kind === 'melee' ? it.lethal : 0;
    const noise = it.kind === 'melee' ? it.noise : 1.5;
    if (it.kind === 'melee' && it.q === 0) { this.log('Расходник кончился.'); return; }
    if (it.kind === 'melee' && it.q > 0) it.q--;
    v.down = true; v.dead = !!lethal; v.hp = 0; v.path = [];
    if (lethal) {
      this.mission.stats.kills++;
      if (it.blood) { this.fx.decal(v.x, v.y, 'blood'); this.fx.spawn(v.x, v.y, 12, '#7d1f18', 2.5, .5); }
      if (v === this.target) this.onTargetDown();
    }
    this.audio.hit(this.pan(v.x, v.y));
    this.noise(v.x, v.y, noise);
    this.log((lethal ? 'Устранён: ' : 'Оглушён: ') + v.name);
    // свидетели
    for (const n of this.npcs) {
      if (n === v || n.down) continue;
      if (dist(n.x, n.y, v.x, v.y) < 9 && this.canSee(n, v.x, v.y)) {
        this.mission.stats.witnessed = true;
        this.alertTo(n, v.x, v.y, 100);
      }
    }
    p.actT = .5;
  }
  onTargetDown() {
    this.mission.set('kill', 'Цель устранена', true);
    this.log('Цель устранена.');
    this.updateObjectives(); SaveManager.save(this);
  }
  shoot(it) {
    const p = this.player;
    const spread = (this.diff >= 2 ? .09 : .05) * (p.run ? 2.2 : p.crouch ? .5 : 1);
    const a = p.a + rnd(-spread, spread);
    const dx = Math.cos(a), dy = Math.sin(a);
    let hit = null, hx = p.x, hy = p.y;
    for (let d = .5; d < 16; d += .2) {
      const x = p.x + dx * d, y = p.y + dy * d;
      if (this.lv.blocked(x, y)) { hx = x; hy = y; break; }
      const n = this.npcs.find(n => !n.down && dist(n.x, n.y, x, y) < .45);
      if (n) { hit = n; hx = x; hy = y; break; }
      hx = x; hy = y;
    }
    this.shots.push({ x1: p.x, y1: p.y, x2: hx, y2: hy, l: .08 });
    this.fx.spawn(p.x + dx * .5, p.y + dy * .5, 5, '#e8c98a', 3, .16, .05);
    this.fx.decal(p.x - dx * .3, p.y - dy * .3, 'shell');
    this.audio.shot(it.sil, this.pan(p.x, p.y));
    this.shake = it.sil ? 2 : 6;
    this.noise(p.x, p.y, it.noise);
    if (hit) {
      hit.down = true; hit.dead = true; hit.hp = 0;
      this.mission.stats.kills++;
      this.fx.decal(hit.x, hit.y, 'blood');
      this.fx.spawn(hit.x, hit.y, 14, '#7d1f18', 3, .55);
      if (hit === this.target) this.onTargetDown();
      else this.log('Убит: ' + hit.name);
      for (const n of this.npcs) {
        if (n === hit || n.down) continue;
        if (dist(n.x, n.y, hit.x, hit.y) < 10 && this.canSee(n, hit.x, hit.y)) {
          this.mission.stats.witnessed = true; this.alertTo(n, hit.x, hit.y, 100);
        }
      }
    }
    if (!it.sil) { this.raiseAlarm(p.x, p.y); }
  }
  throwItem(it) {
    const p = this.player;
    const d = 6 + Math.random() * 2;
    const tx = clamp(p.x + Math.cos(p.a) * d, 1, this.lv.W - 2);
    const ty = clamp(p.y + Math.sin(p.a) * d, 1, this.lv.H - 2);
    this.fx.spawn(tx, ty, 6, '#b9b19a', 1.6, .4, .05);
    this.audio.noise(.16, .1, it.id === 'bottle' ? 2600 : 1600, 1.4, this.pan(tx, ty));
    this.noise(tx, ty, it.noise);
    this.log(it.id === 'bottle' ? 'Бутылка разбилась поодаль.' : 'Монета звякнула в стороне.');
  }

  /* ─── шум и тревога ─── */
  pan(x, y) { return clamp((x - this.player.x) / 12, -1, 1); }
  noise(x, y, r) {
    if (r <= 0) return;
    this.noises.push({ x, y, r, l: .35 });
    if (r < 3) return;                       // обычные шаги не тревожат
    for (const n of this.npcs) {
      if (n.down) continue;
      const d = dist(n.x, n.y, x, y);
      const hear = r * [.8, 1, 1.25, 1.5][this.diff];
      if (d < hear && n.state < 5) this.alertTo(n, x, y, 40 * (1 - d / hear) + 15);
    }
  }
  alertTo(n, x, y, amount) {
    n.susp = clamp(n.susp + amount, 0, 100);
    n.lastSeen = { x, y };
    n.path = []; n.searchT = 6;
  }
  raiseAlarm(x, y) {
    if (!this.mission.stats.alarm) { this.audio.alarm(); this.log('ТРЕВОГА. Охрана поднята.'); }
    this.mission.stats.alarm = true; this.alarmT = 30;
    for (const n of this.npcs) {
      if (n.down || n.kind === 'target') continue;
      n.susp = 100; n.lastSeen = { x, y }; n.path = []; n.searchT = 20;
    }
  }

  /* ─── зрение ─── */
  canSee(n, x, y) {
    const d = dist(n.x, n.y, x, y);
    if (d > n.baseRange * 1.4) return false;
    const a = Math.atan2(y - n.y, x - n.x);
    if (Math.abs(angDiff(a, n.a)) > n.baseFov) return false;
    return this.lv.los(n.x, n.y, x, y);
  }
  visibility() {
    const p = this.player;
    const l = clamp(this.lv.light(p.x, p.y), .06, 1);
    let v = .35 + l * .8;
    if (p.crouch) v *= .6;
    if (p.run) v *= 1.3;
    if (p.dragging) v *= 1.25;
    return clamp(v, .15, 1.5);
  }

  /* ─── обновление ─── */
  update(dt) {
    if (this.state !== 'play') return;
    this.time += dt;
    const p = this.player, lv = this.lv;

    if (p.actT > 0) {
      p.actT -= dt;
      if (p.actT <= 0 && p.actTarget) {
        p.actTarget.locked = 0; p.actTarget.open = true;
        this.log('Замок вскрыт.'); this.audio.door(); this.noise(p.x, p.y, 2);
        p.actTarget = null;
      }
    } else {
      const [ix, iy, mag] = this.input.vec;
      const sp = p.speed * (mag > .1 ? 1 : 0);
      p.move(lv, ix * sp, iy * sp, dt);
      if (mag > .12) {
        p.a = Math.atan2(iy, ix);
        p.stepT -= dt * (p.run ? 2.6 : p.crouch ? .9 : 1.6);
        if (p.stepT <= 0) {
          p.stepT = 1;
          this.audio.step(0, !lv.zoneAt(p.x | 0, p.y | 0).out);
          if (!p.crouch) this.fx.decal(p.x, p.y, 'step', p.a);
          this.noise(p.x, p.y, p.noiseR);
        }
      }
    }
    p.noise = lerp(p.noise, this.input.vec[2] > .1 ? p.noiseR / 7 : 0, dt * 6);
    if (p.dragging) { const b = p.dragging; b.x = lerp(b.x, p.x - Math.cos(p.a) * .7, dt * 8); b.y = lerp(b.y, p.y - Math.sin(p.a) * .7, dt * 8); }

    // камеры наблюдения
    for (const c of lv.props) {
      if (c.t !== 'camera' || !c.alive) continue;
      c.dir += dt * .35;
      const a = Math.atan2(p.y - (c.y + .5), p.x - (c.x + .5));
      const sweep = Math.sin(c.dir) * .9;
      if (dist(p.x, p.y, c.x + .5, c.y + .5) < 8 && Math.abs(angDiff(a, sweep)) < .6 && lv.los(c.x + .5, c.y + .5, p.x, p.y)) {
        const z = lv.zoneAt(p.x | 0, p.y | 0);
        if (z.clr > p.clr) { this.raiseAlarm(p.x, p.y); this.log('Вас засекла камера.'); }
      }
    }

    for (const n of this.npcs) this.updateNPC(n, dt);
    if (this.alarmT > 0) this.alarmT -= dt;

    this.fx.update(dt);
    for (let i = this.noises.length - 1; i >= 0; i--) { this.noises[i].l -= dt; if (this.noises[i].l <= 0) this.noises.splice(i, 1); }
    for (let i = this.shots.length - 1; i >= 0; i--) { this.shots[i].l -= dt; if (this.shots[i].l <= 0) this.shots.splice(i, 1); }
    for (let i = this.msgs.length - 1; i >= 0; i--) { this.msgs[i].l -= dt; if (this.msgs[i].l <= 0) this.msgs.splice(i, 1); }
    if (this.shake > 0) this.shake *= .88;

    // камера
    const target = { x: p.x + Math.cos(p.a) * 1.2, y: p.y + Math.sin(p.a) * 1.2 };
    this.cam.x = lerp(this.cam.x, target.x, clamp(dt * 5, 0, 1));
    this.cam.y = lerp(this.cam.y, target.y, clamp(dt * 5, 0, 1));

    if (p.hp <= 0) this.finish(true);
  }

  updateNPC(n, dt) {
    if (n.down) {
      // обнаружение тел
      if (!n.hidden && !n.found) {
        for (const o of this.npcs) {
          if (o === n || o.down) continue;
          if (dist(o.x, o.y, n.x, n.y) < 6 && this.canSee(o, n.x, n.y)) {
            n.found = true; this.mission.stats.bodiesFound++;
            this.log(o.name + ' нашёл тело.');
            this.raiseAlarm(n.x, n.y);
          }
        }
      }
      return;
    }
    const p = this.player, lv = this.lv;
    const dm = [.75, 1, 1.25, 1.45][this.diff];

    // яд
    if (n === this.target) {
      const food = lv.props.find(f => f.t === 'food');
      if (food && food.used && dist(n.x, n.y, 52.5, 5.5) < 2.6) {
        n.down = true; n.dead = true; this.mission.stats.kills++;
        this.mission.stats.natural = true;
        this.log('Цель поужинала. Сердце, наверное.');
        this.onTargetDown(); return;
      }
    }

    // ── восприятие игрока
    const d = dist(n.x, n.y, p.x, p.y);
    const range = n.baseRange * dm * this.visibility();
    let sees = false;
    if (d < range) {
      const a = Math.atan2(p.y - n.y, p.x - n.x);
      if (Math.abs(angDiff(a, n.a)) < n.baseFov || d < 1.6) {
        if (lv.los(n.x, n.y, p.x, p.y)) sees = true;
      }
    }
    if (sees) {
      const z = lv.zoneAt(p.x | 0, p.y | 0);
      let rate = 0;
      if (z.clr > p.clr) rate = 34 * dm;                       // не по форме в зоне
      if (p.dragging) rate = Math.max(rate, 80);               // тащит тело
      if (n.prof === p.prof && n.prof !== 'guest' && d < 4) rate = Math.max(rate, 26 * dm); // «своих» узнают
      if (p.run && z.clr > 0) rate = Math.max(rate, 20);
      if (this.mission.stats.alarm) rate = Math.max(rate, 70);
      if (rate > 0) {
        n.susp = clamp(n.susp + rate * dt, 0, 100);
        n.lastSeen = { x: p.x, y: p.y };
        if (n.susp > 55) this.mission.stats.spotted = true;
      } else if (n.susp > 0) n.susp = clamp(n.susp - 12 * dt, 0, 100);
    } else if (n.susp > 0 && n.searchT <= 0) {
      n.susp = clamp(n.susp - 9 * dt, 0, 100);
    }

    // кровь на полу
    if (n.susp < 60) {
      for (const dc of this.fx.decals) {
        if (dc.type !== 'blood' || dc.seen) continue;
        if (dist(n.x, n.y, dc.x, dc.y) < 2.5 && this.canSee(n, dc.x, dc.y)) {
          dc.seen = true; this.alertTo(n, dc.x, dc.y, 55);
          this.log(n.name + ' заметил кровь.');
        }
      }
    }

    // ── состояние
    n.state = n.susp >= 100 ? 6 : n.susp >= 80 ? 5 : n.susp >= 55 ? 4 : n.susp >= 35 ? 3 : n.susp >= 18 ? 2 : n.susp > 5 ? 1 : 0;
    if (n.susp >= 100 && n.kind === 'guard' && !this.mission.stats.alarm) this.raiseAlarm(p.x, p.y);
    if (n.susp >= 100 && n.kind !== 'guard' && n.kind !== 'target' && !n.called) {
      n.called = true;                       // персонал не дерётся — он зовёт охрану
      this.log(n.name + ' побежал звать охрану.');
      for (const q of this.npcs)
        if (q.kind === 'guard' && !q.down && dist(q.x, q.y, n.x, n.y) < 26) this.alertTo(q, n.lastSeen ? n.lastSeen.x : n.x, n.lastSeen ? n.lastSeen.y : n.y, 78);
    }
    if (n.susp < 40) n.called = false;
    if (n.searchT > 0) n.searchT -= dt;

    // ── поведение
    let goal = null, speed = 1.5;
    if (n.state >= 5) {
      goal = n.lastSeen || { x: p.x, y: p.y };
      speed = n.kind === 'guard' ? 3.6 : 3.2;
      if (n.armed && d < 9 && this.canSee(n, p.x, p.y)) {
        n.shootT -= dt;
        if (n.shootT <= 0) {
          n.shootT = [1.5, 1.1, .8, .6][this.diff];
          this.audio.shot(false, this.pan(n.x, n.y));
          this.shots.push({ x1: n.x, y1: n.y, x2: p.x, y2: p.y, l: .08 });
          p.hp -= [7, 11, 16, 22][this.diff];
          this.shake = 7;
          this.fx.decal(p.x, p.y, 'blood');
          if (p.hp <= 0) return;
        }
      }
      if (goal && dist(n.x, n.y, goal.x, goal.y) < 1.2) {
        if (n.searchT <= 0) { n.susp = clamp(n.susp - 22 * dt, 0, 100); }
        goal = null;
      }
    } else if (n.state >= 2 && n.lastSeen) {
      goal = n.lastSeen; speed = 2.4;
      if (dist(n.x, n.y, goal.x, goal.y) < 1.1) {
        n.wait -= dt;
        if (n.wait <= 0) { n.lastSeen = null; n.wait = 2; n.susp = clamp(n.susp - 30, 0, 100); }
        goal = null;
      }
    } else {
      // рутина
      const wp = n.route[n.ri % n.route.length];
      goal = { x: wp[0] + .5, y: wp[1] + .5 };
      speed = n.kind === 'guard' ? 1.9 : 1.6;
      if (dist(n.x, n.y, goal.x, goal.y) < .8) {
        n.wait -= dt;
        if (n.wait <= 0) { n.ri++; n.wait = rnd(.6, 2.4); n.path = []; }
        goal = null;
      }
    }

    if (goal) {
      n.repathT -= dt;
      if (!n.path.length || n.repathT <= 0) {
        n.path = this.nav.path(n.x, n.y, goal.x, goal.y);
        n.repathT = 1.1;
      }
      if (n.path.length) {
        const [tx, ty] = n.path[0];
        const a = Math.atan2(ty - n.y, tx - n.x);
        n.a = a;
        n.move(lv, Math.cos(a) * speed, Math.sin(a) * speed, dt);
        if (dist(n.x, n.y, tx, ty) < .3) n.path.shift();
        // открывает двери
        const canUnlock = n.kind === 'guard' || n.kind === 'target';
        const dr = lv.doors.find(q => !q.open && (!q.locked || canUnlock) && dist(n.x, n.y, q.x + .5, q.y + .5) < 1.2);
        if (dr) { dr.open = true; if (dr.locked) dr.locked = 0; this.audio.door(this.pan(dr.x, dr.y)); }
      }
      n.talkT = 0;
    }
  }

  canExit() {
    return this.player.inv.docs.length >= 2 && this.target.down;
  }
  updateObjectives() {
    const m = this.mission;
    m.set('docs', `Найти две папки документов (${this.player.inv.docs.length}/2)`, this.player.inv.docs.length >= 2);
    if (this.target.down) m.set('kill', 'Цель устранена', true);
    m.set('exit', 'Покинуть объект', false);
    $('obj').innerHTML = '<span class="t">Задание</span>' +
      m.obj.map(o => `<div class="${o.done ? 'd' : ''}">${o.done ? '✓' : '•'} ${o.t}</div>`).join('');
  }
  finish(dead) {
    this.state = 'over';
    const m = this.mission; m.stats.time = this.time;
    const r = dead ? { t: 'ПРОВАЛ', d: 'Вас достали раньше, чем вы ушли.' } : m.rank();
    $('fEb').textContent = dead ? 'контракт не закрыт' : 'контракт закрыт';
    $('fT').textContent = r.t;
    const mm = Math.floor(this.time / 60), ss = Math.floor(this.time % 60);
    const line = (k, v, good) => `<div>${k}: <b class="${good ? '' : 'no'}">${v}</b></div>`;
    $('fStats').innerHTML = `<p>${r.d}</p>` +
      line('Время', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, 1) +
      line('Тревога', m.stats.alarm ? 'была' : 'не поднималась', !m.stats.alarm) +
      line('Вас видели', m.stats.spotted ? 'да' : 'нет', !m.stats.spotted) +
      line('Свидетели устранения', m.stats.witnessed ? 'есть' : 'нет', !m.stats.witnessed) +
      line('Найдено тел', m.stats.bodiesFound, m.stats.bodiesFound === 0) +
      line('Всего устранено', m.stats.kills, m.stats.kills <= 1) +
      line('Документы', this.player.inv.docs.length + '/2', this.player.inv.docs.length >= 2);
    $('fin').classList.add('on');
    SaveManager.clear();
  }

  /* ═════════ ОТРИСОВКА ═════════ */
  loop(t) {
    requestAnimationFrame(t2 => this.loop(t2));
    const dt = Math.min(.05, (t - (this.lastT || t)) / 1000); this.lastT = t;
    this.update(dt);
    if (this.state === 'menu') return;
    this.draw();
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = .12; this.drawHUD(); this.drawMap(); }
  }
  w2s(x, y) {
    return [(x - this.cam.x) * this.ts + this.W / 2, (y - this.cam.y) * this.ts + this.H / 2];
  }
  draw() {
    const cx = this.cx, ts = this.ts, lv = this.lv, p = this.player;
    cx.save();
    if (this.shake > .2) cx.translate(rnd(-this.shake, this.shake), rnd(-this.shake, this.shake));
    cx.fillStyle = '#07090a'; cx.fillRect(0, 0, this.W, this.H);
    const x0 = Math.floor(this.cam.x - this.W / 2 / ts) - 1, x1 = Math.ceil(this.cam.x + this.W / 2 / ts) + 1;
    const y0 = Math.floor(this.cam.y - this.H / 2 / ts) - 1, y1 = Math.ceil(this.cam.y + this.H / 2 / ts) + 2;

    // ── пол
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = lv.at(x, y); if (t === TILE.WALL) continue;
      const [sx, sy] = this.w2s(x, y);
      const z = lv.zoneAt(x, y);
      if (t === TILE.OUT) cx.fillStyle = ((x + y) & 1) ? '#191c1e' : '#171a1c';
      else if (z.clr === CLR.SECURE) cx.fillStyle = ((x + y) & 1) ? '#1d2124' : '#1b1f22';
      else if (z.clr === CLR.STAFF) cx.fillStyle = ((x + y) & 1) ? '#20241f' : '#1d211d';
      else cx.fillStyle = ((x + y) & 1) ? '#262a2b' : '#232728';
      cx.fillRect(sx, sy, ts + 1, ts + 1);
      if (t === TILE.OUT && ((x * 7 + y * 3) % 9 === 0)) {
        cx.fillStyle = 'rgba(180,180,160,.05)'; cx.fillRect(sx + ts * .2, sy + ts * .3, ts * .6, ts * .1);
      }
    }
    // ── следы и кровь
    for (const d of this.fx.decals) {
      const [sx, sy] = this.w2s(d.x, d.y);
      if (sx < -40 || sy < -40 || sx > this.W + 40 || sy > this.H + 40) continue;
      if (d.type === 'blood') {
        cx.fillStyle = 'rgba(110,26,20,.55)';
        cx.beginPath(); cx.ellipse(sx, sy, d.r * ts, d.r * ts * .72, d.a, 0, 6.283); cx.fill();
      } else if (d.type === 'step') {
        cx.save(); cx.translate(sx, sy); cx.rotate(d.a);
        cx.fillStyle = 'rgba(150,155,150,.07)'; cx.fillRect(-ts * .06, -ts * .11, ts * .12, ts * .22); cx.restore();
      } else {
        cx.fillStyle = 'rgba(190,170,110,.35)'; cx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }
    // ── конусы зрения
    for (const n of this.npcs) {
      if (n.down) continue;
      const [sx, sy] = this.w2s(n.x, n.y);
      const rr = n.baseRange * this.visibility() * ts * .9;
      const col = n.state >= 5 ? [176, 74, 60] : n.state >= 2 ? [200, 168, 106] : [110, 130, 140];
      const g = cx.createRadialGradient(sx, sy, ts * .3, sx, sy, rr);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},.16)`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      cx.fillStyle = g;
      cx.beginPath(); cx.moveTo(sx, sy);
      cx.arc(sx, sy, rr, n.a - n.baseFov, n.a + n.baseFov); cx.closePath(); cx.fill();
    }
    // ── камеры
    for (const c of lv.props) {
      if (c.t !== 'camera') continue;
      const [sx, sy] = this.w2s(c.x + .5, c.y + .5);
      if (c.alive) {
        const sweep = Math.sin(c.dir) * .9, rr = 8 * ts;
        const g = cx.createRadialGradient(sx, sy, ts * .2, sx, sy, rr);
        g.addColorStop(0, 'rgba(176,74,60,.13)'); g.addColorStop(1, 'rgba(176,74,60,0)');
        cx.fillStyle = g; cx.beginPath(); cx.moveTo(sx, sy);
        cx.arc(sx, sy, rr, sweep - .6, sweep + .6); cx.closePath(); cx.fill();
      }
      cx.fillStyle = c.alive ? '#b04a3c' : '#3d474e';
      cx.beginPath(); cx.arc(sx, sy, ts * .16, 0, 6.283); cx.fill();
    }
    // ── объекты
    for (const pr of lv.props) {
      if (pr.t === 'camera') continue;
      const [sx, sy] = this.w2s(pr.x + .5, pr.y + .5);
      if (sx < -60 || sy < -60 || sx > this.W + 60 || sy > this.H + 60) continue;
      const s = ts * .42;
      if (pr.t === 'locker') { cx.fillStyle = '#39424a'; cx.fillRect(sx - s, sy - s, s * 2, s * 2); cx.strokeStyle = '#4d5860'; cx.strokeRect(sx - s, sy - s, s * 2, s * 2); }
      else if (pr.t === 'generator') { cx.fillStyle = pr.used ? '#2c3238' : '#4a5340'; cx.fillRect(sx - s * 1.4, sy - s, s * 2.8, s * 2); cx.fillStyle = '#8f9a7f'; cx.fillRect(sx - s * .5, sy - s * .3, s, s * .6); }
      else if (pr.t === 'terminal') { cx.fillStyle = '#2f3a42'; cx.fillRect(sx - s, sy - s * .7, s * 2, s * 1.4); cx.fillStyle = pr.used ? '#3d474e' : '#5b7f93'; cx.fillRect(sx - s * .7, sy - s * .45, s * 1.4, s * .9); }
      else if (pr.t === 'docs' && !pr.used) { cx.fillStyle = '#c8a86a'; cx.fillRect(sx - s * .6, sy - s * .8, s * 1.2, s * 1.6); cx.fillStyle = '#8e7440'; cx.fillRect(sx - s * .6, sy - s * .2, s * 1.2, s * .18); }
      else if (pr.t === 'keycard' && !pr.used) { cx.fillStyle = '#6f9a6a'; cx.fillRect(sx - s * .55, sy - s * .35, s * 1.1, s * .7); }
      else if (pr.t === 'food') { cx.fillStyle = pr.used ? '#6a7f5a' : '#9aa0a2'; cx.beginPath(); cx.ellipse(sx, sy, s * .9, s * .6, 0, 0, 6.283); cx.fill(); }
      else if (pr.t === 'switch') { cx.fillStyle = '#8a9298'; cx.fillRect(sx - s * .25, sy - s * .4, s * .5, s * .8); }
      else if (pr.t === 'vent') { cx.fillStyle = '#333c42'; cx.fillRect(sx - s, sy - s * .7, s * 2, s * 1.4); cx.strokeStyle = '#4d5860'; for (let i = 0; i < 3; i++) { cx.beginPath(); cx.moveTo(sx - s, sy - s * .4 + i * s * .4); cx.lineTo(sx + s, sy - s * .4 + i * s * .4); cx.stroke(); } }
      else if (pr.t === 'exit') { cx.strokeStyle = '#6f9a6a'; cx.lineWidth = 2; cx.strokeRect(sx - s, sy - s, s * 2, s * 2); cx.lineWidth = 1; }
    }
    // ── двери
    for (const d of lv.doors) {
      const [sx, sy] = this.w2s(d.x, d.y);
      if (sx < -60 || sy < -60 || sx > this.W + 60 || sy > this.H + 60) continue;
      cx.fillStyle = d.open ? 'rgba(120,130,120,.2)' : (d.locked ? '#5c4a3a' : '#48504f');
      if (d.open) { cx.fillRect(sx + ts * .1, sy + ts * .1, ts * .8, ts * .16); }
      else cx.fillRect(sx, sy, ts, ts);
      if (d.locked && !d.open) { cx.fillStyle = d.locked === 2 ? '#b04a3c' : '#c8a86a'; cx.fillRect(sx + ts * .42, sy + ts * .42, ts * .16, ts * .16); }
    }
    // ── стены (псевдо-объём)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (lv.at(x, y) !== TILE.WALL) continue;
      if (lv.at(x, y + 1) === TILE.WALL && lv.at(x, y - 1) === TILE.WALL &&
        lv.at(x + 1, y) === TILE.WALL && lv.at(x - 1, y) === TILE.WALL) {
        const [sx, sy] = this.w2s(x, y);
        cx.fillStyle = '#0e1113'; cx.fillRect(sx, sy, ts + 1, ts + 1); continue;
      }
      const [sx, sy] = this.w2s(x, y);
      const h = ts * .34;
      cx.fillStyle = '#171c1f'; cx.fillRect(sx, sy, ts + 1, ts + 1);
      if (lv.at(x, y + 1) !== TILE.WALL) { cx.fillStyle = '#232a2e'; cx.fillRect(sx, sy + ts, ts + 1, h); }
      cx.fillStyle = '#2b3338'; cx.fillRect(sx, sy, ts + 1, ts * .18);
      cx.strokeStyle = 'rgba(0,0,0,.45)'; cx.strokeRect(sx + .5, sy + .5, ts, ts);
    }
    // ── тела
    for (const n of this.npcs) {
      if (!n.down || n.hidden) continue;
      const [sx, sy] = this.w2s(n.x, n.y);
      cx.save(); cx.translate(sx, sy); cx.rotate(n.a);
      cx.fillStyle = n.dead ? '#4a3230' : '#3f464a';
      cx.beginPath(); cx.ellipse(0, 0, ts * .42, ts * .2, 0, 0, 6.283); cx.fill();
      cx.fillStyle = '#8e8172'; cx.beginPath(); cx.arc(ts * .3, 0, ts * .13, 0, 6.283); cx.fill();
      cx.restore();
    }
    // ── NPC
    for (const n of this.npcs) {
      if (n.down) continue;
      const [sx, sy] = this.w2s(n.x, n.y);
      if (sx < -50 || sy < -50 || sx > this.W + 50 || sy > this.H + 50) continue;
      cx.fillStyle = 'rgba(0,0,0,.45)';
      cx.beginPath(); cx.ellipse(sx, sy + ts * .16, ts * .3, ts * .12, 0, 0, 6.283); cx.fill();
      const body = n === this.target ? '#8a6a3a' : n.kind === 'guard' ? '#39434b' : n.kind === 'staff' ? '#3b4a3c' : '#414449';
      cx.fillStyle = body; cx.beginPath(); cx.arc(sx, sy, ts * .27, 0, 6.283); cx.fill();
      cx.fillStyle = '#8e8172'; cx.beginPath(); cx.arc(sx, sy, ts * .16, 0, 6.283); cx.fill();
      // взгляд
      cx.strokeStyle = 'rgba(200,205,200,.5)'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + Math.cos(n.a) * ts * .34, sy + Math.sin(n.a) * ts * .34); cx.stroke();
      cx.lineWidth = 1;
      // индикатор состояния
      if (n.state > 0) {
        cx.fillStyle = n.state >= 5 ? '#b04a3c' : '#c8a86a';
        cx.font = 'bold 12px Arial'; cx.textAlign = 'center';
        cx.fillText(n.state >= 5 ? '!' : '?', sx, sy - ts * .42);
        cx.strokeStyle = n.state >= 5 ? '#b04a3c' : '#c8a86a';
        cx.beginPath(); cx.arc(sx, sy, ts * .36, -1.57, -1.57 + 6.283 * (n.susp / 100)); cx.stroke();
      }
    }
    // ── выстрелы
    for (const s of this.shots) {
      const [ax, ay] = this.w2s(s.x1, s.y1), [bx, by] = this.w2s(s.x2, s.y2);
      cx.strokeStyle = 'rgba(240,220,170,.75)'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(ax, ay); cx.lineTo(bx, by); cx.stroke(); cx.lineWidth = 1;
    }
    // ── волны шума
    for (const nz of this.noises) {
      const [sx, sy] = this.w2s(nz.x, nz.y);
      cx.strokeStyle = `rgba(91,127,147,${nz.l})`;
      cx.beginPath(); cx.arc(sx, sy, nz.r * ts * (1 - nz.l * 2), 0, 6.283); cx.stroke();
    }
    // ── частицы
    for (const q of this.fx.p) {
      const [sx, sy] = this.w2s(q.x, q.y);
      cx.globalAlpha = clamp(q.l / q.m, 0, 1); cx.fillStyle = q.c;
      cx.beginPath(); cx.arc(sx, sy, q.r * ts, 0, 6.283); cx.fill(); cx.globalAlpha = 1;
    }
    // ── игрок
    {
      const [sx, sy] = this.w2s(p.x, p.y);
      cx.fillStyle = 'rgba(0,0,0,.5)';
      cx.beginPath(); cx.ellipse(sx, sy + ts * .16, ts * .3, ts * .12, 0, 0, 6.283); cx.fill();
      const col = p.disguise === 'guard' ? '#4a5560' : p.disguise === 'staff' ? '#4a5c4a' : '#2f3336';
      cx.fillStyle = col;
      cx.beginPath(); cx.arc(sx, sy, ts * (p.crouch ? .22 : .28), 0, 6.283); cx.fill();
      cx.fillStyle = '#c9b393'; cx.beginPath(); cx.arc(sx, sy, ts * .155, 0, 6.283); cx.fill();
      cx.strokeStyle = '#c8a86a'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + Math.cos(p.a) * ts * .42, sy + Math.sin(p.a) * ts * .42); cx.stroke();
      cx.lineWidth = 1;
      if (p.actT > 0) {
        cx.strokeStyle = '#c8a86a';
        cx.beginPath(); cx.arc(sx, sy, ts * .5, -1.57, -1.57 + 6.283 * (1 - p.actT / 3)); cx.stroke();
      }
    }
    // ── темнота
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (lv.at(x, y) === TILE.WALL) continue;
      const l = lv.light(x, y);
      if (l > .92) continue;
      const [sx, sy] = this.w2s(x, y);
      cx.fillStyle = `rgba(4,6,7,${clamp(.86 - l * .9, 0, .86)})`;
      cx.fillRect(sx, sy, ts + 1, ts + 1);
    }
    // ── виньетка
    const vg = cx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * .3,
      this.W / 2, this.H / 2, Math.max(this.W, this.H) * .78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.75)');
    cx.fillStyle = vg; cx.fillRect(0, 0, this.W, this.H);
    if (this.mission.stats.alarm && this.alarmT > 0) {
      cx.fillStyle = `rgba(140,40,32,${.06 + Math.abs(Math.sin(this.time * 4)) * .07})`;
      cx.fillRect(0, 0, this.W, this.H);
    }
    cx.restore();
  }
  drawHUD() {
    const p = this.player, m = this.mission;
    const mm = Math.floor(this.time / 60), ss = Math.floor(this.time % 60);
    $('timer').textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    $('diff').textContent = ['ЛЕГКО', 'НОРМА', 'ПРОФИ', 'МАСТЕР'][this.diff] + ' · ' + DISGUISE[p.disguise].name.toUpperCase();
    $('hp').style.width = clamp(p.hp, 0, 100) + '%';
    const maxS = Math.max(0, ...this.npcs.filter(n => !n.down).map(n => n.susp));
    $('susp').style.width = maxS + '%';
    $('noise').style.width = clamp(p.noise * 100, 0, 100) + '%';
    const st = $('state');
    if (m.stats.alarm && this.alarmT > 0) { st.textContent = 'ТРЕВОГА'; st.classList.add('on'); }
    else if (maxS > 55) { st.textContent = 'ВАС ЗАМЕТИЛИ'; st.classList.add('on'); }
    else if (maxS > 18) { st.textContent = 'ПОДОЗРЕНИЕ'; st.classList.add('on'); }
    else st.classList.remove('on');
    $('prompt').textContent = this.promptText();
    const it = p.inv.cur;
    $('slot').innerHTML = it.n + '<small>' + (it.q < 0 ? 'без ограничений' : it.q + ' шт.') + '</small>';
    $('log').innerHTML = this.msgs.map(x => '<div>' + x.t + '</div>').join('');
    const z = this.lv.zoneAt(p.x | 0, p.y | 0);
    if (z.clr > p.clr) $('prompt').textContent = '⚠ ЗАКРЫТАЯ ЗОНА: ' + z.name + (this.promptText() ? ' · ' + this.promptText() : '');
  }
  drawMap() {
    const g = this.mx, lv = this.lv, W = 150, H = 110;
    const s = Math.min(W / lv.W, H / lv.H);
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(8,10,11,.8)'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
      if (lv.at(x, y) === TILE.WALL) continue;
      const z = lv.zoneAt(x, y);
      g.fillStyle = z.clr === CLR.SECURE ? '#2a2226' : z.clr === CLR.STAFF ? '#232a24' : '#2b3134';
      g.fillRect(x * s, y * s, s + .5, s + .5);
    }
    for (const pr of lv.props) {
      if (pr.t === 'docs' && !pr.used) { g.fillStyle = '#c8a86a'; g.fillRect(pr.x * s - 1, pr.y * s - 1, 3, 3); }
      if (pr.t === 'exit') { g.fillStyle = '#6f9a6a'; g.fillRect(pr.x * s - 1, pr.y * s - 1, 3, 3); }
    }
    for (const n of this.npcs) {
      if (n.down) { g.fillStyle = '#5c3a36'; g.fillRect(n.x * s - 1, n.y * s - 1, 2, 2); continue; }
      g.fillStyle = n === this.target ? '#c8a86a' : n.state >= 5 ? '#b04a3c' : n.kind === 'guard' ? '#7c8a94' : '#55605e';
      g.fillRect(n.x * s - 1, n.y * s - 1, 2.5, 2.5);
    }
    const p = this.player;
    g.fillStyle = '#e8e2d2'; g.beginPath(); g.arc(p.x * s, p.y * s, 2.4, 0, 6.283); g.fill();
    g.strokeStyle = '#c8a86a'; g.beginPath(); g.moveTo(p.x * s, p.y * s);
    g.lineTo(p.x * s + Math.cos(p.a) * 6, p.y * s + Math.sin(p.a) * 6); g.stroke();
  }
}

window.addEventListener('load', () => { window.GAME = new Game(); });

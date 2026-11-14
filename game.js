// Oyun kuralları ve mantığı (sunucu tarafı)
const crypto = require('crypto');

const MAX_LEVEL = 15;
const MAP_SIZE = 20;

const BUILDINGS = {
  hq:       { name: 'Karargah', icon: '🏛️', desc: 'Üssün kalbi. Diğer binaların azami seviyesini ve depo kapasitesini belirler.', cost: { food: 400, wood: 500, metal: 300 }, time: 40 },
  farm:     { name: 'Çiftlik',  icon: '🌾', desc: 'Yiyecek üretir.', cost: { food: 60,  wood: 120, metal: 40 },  time: 15 },
  lumber:   { name: 'Kereste Atölyesi', icon: '🪓', desc: 'Odun üretir.', cost: { food: 120, wood: 60, metal: 40 },  time: 15 },
  mine:     { name: 'Maden',    icon: '⛏️', desc: 'Metal üretir.', cost: { food: 120, wood: 120, metal: 20 }, time: 18 },
  barracks: { name: 'Kışla',    icon: '🪖', desc: 'Asker eğitir. Seviye arttıkça parti büyür, yeni birlikler açılır.', cost: { food: 200, wood: 250, metal: 120 }, time: 25 },
  hospital: { name: 'Hastane',  icon: '🏥', desc: 'Yaralı askerleri barındırır ve iyileştirir.', cost: { food: 150, wood: 200, metal: 150 }, time: 22 },
  wall:     { name: 'Duvar',    icon: '🧱', desc: 'Savunmaya bonus verir, zombilere ve düşmana karşı korur.', cost: { food: 100, wood: 300, metal: 200 }, time: 25 },
};
const BUILD_ORDER = ['hq', 'farm', 'lumber', 'mine', 'barracks', 'hospital', 'wall'];

const TROOPS = {
  inf:    { name: 'Piyade',      icon: '🪖', atk: 10, def: 12, hp: 50,  cost: { food: 50,  wood: 30, metal: 0 },   time: 3,  unlock: 1 },
  sniper: { name: 'Nişancı',     icon: '🎯', atk: 16, def: 7,  hp: 40,  cost: { food: 60,  wood: 50, metal: 15 },  time: 4,  unlock: 2 },
  tank:   { name: 'Zırhlı Araç', icon: '🚙', atk: 26, def: 22, hp: 130, cost: { food: 100, wood: 80, metal: 130 }, time: 8,  unlock: 4 },
};
const TROOP_ORDER = ['inf', 'sniper', 'tank'];

const ZOMBIES = {
  walker: { name: 'Yürüyen', atk: 7,  def: 6,  hp: 40 },
  runner: { name: 'Koşucu',  atk: 12, def: 5,  hp: 35 },
  brute:  { name: 'Dev Zombi', atk: 24, def: 18, hp: 160 },
};

const HERO_POOL = [
  { key: 'kurt',   name: 'Kurt',        role: 'Saldırı',  rarity: 'Nadir',     icon: '🐺', atk: 12, def: 8 },
  { key: 'elif',   name: 'Doktor Elif', role: 'Destek',   rarity: 'Nadir',     icon: '🩺', atk: 6,  def: 14 },
  { key: 'asena',  name: 'Asena',       role: 'Nişancı',  rarity: 'Epik',      icon: '🏹', atk: 22, def: 8 },
  { key: 'demir',  name: 'Demir Ali',   role: 'Tank',     rarity: 'Epik',      icon: '🛡️', atk: 9,  def: 24 },
  { key: 'golge',  name: 'Gölge',       role: 'Suikast',  rarity: 'Efsanevi',  icon: '🗡️', atk: 32, def: 12 },
  { key: 'reis',   name: 'Yaşlı Reis',  role: 'Komutan',  rarity: 'Efsanevi',  icon: '🎖️', atk: 20, def: 28 },
];
const HERO_WEIGHTS = { 'Nadir': 50, 'Epik': 35, 'Efsanevi': 15 };
const HERO_COST = { food: 800, wood: 0, metal: 800 };

const RES = ['food', 'wood', 'metal'];

function scaleCost(base, level) { // level = hedef seviye
  const m = Math.pow(1.65, level - 1);
  const o = {}; for (const r of RES) o[r] = Math.round(base[r] * m); return o;
}
function upgradeCost(key, toLevel) { return scaleCost(BUILDINGS[key].cost, toLevel); }
function upgradeTime(key, toLevel) { return Math.round(BUILDINGS[key].time * Math.pow(1.75, toLevel - 1)); }
function prodPerHour(level) { return level <= 0 ? 0 : Math.round(300 * level * Math.pow(1.12, level - 1)); }
function storageCap(hq) { return Math.round(6000 * Math.pow(1.55, hq - 1)); }
function protectedAmount(hq) { return 500 * hq; }
function batchSize(barracks) { return 25 * barracks; }
function hospitalCap(level) { return 80 * level; }

function newPlayer(name, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  const now = Date.now();
  return {
    id: crypto.randomUUID(), name, salt, hash, tokens: [],
    createdAt: now, lastTick: now,
    res: { food: 2500, wood: 2500, metal: 1500 },
    b: { hq: 1, farm: 1, lumber: 1, mine: 1, barracks: 1, hospital: 1, wall: 1 },
    build: null, train: null, heal: null,
    troops: { inf: 20, sniper: 0, tank: 0 },
    wounded: { inf: 0, sniper: 0, tank: 0 },
    heroes: [{ id: crypto.randomUUID(), key: 'kurt', level: 1, xp: 0, stars: 1 }], // başlangıç kahramanı
    pos: null,
    shieldUntil: now + 30 * 60 * 1000, // yeni oyuncu kalkanı 30 dk
    nextWaveAt: now + 60 * 60 * 1000,
    stats: { pvpWin: 0, pvpLoss: 0, campWin: 0, waveWin: 0, kills: 0 },
    reports: [],
  };
}
function checkPassword(p, password) {
  const h = crypto.scryptSync(password, p.salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(p.hash, 'hex'));
}

function heroStats(h) { const base = HERO_POOL.find(x => x.key === h.key); const f = 1 + (h.level - 1) * 0.12 + (h.stars - 1) * 0.25; return { atk: Math.round(base.atk * f), def: Math.round(base.def * f) }; }

function power(p) {
  let pw = 0;
  for (const k of BUILD_ORDER) pw += Math.round(60 * Math.pow(p.b[k], 1.6));
  for (const t of TROOP_ORDER) pw += p.troops[t] * Math.round((TROOPS[t].atk + TROOPS[t].def) / 2);
  for (const h of p.heroes) { const s = heroStats(h); pw += (s.atk + s.def) * 10; }
  return pw;
}

function rand(a, b) { return a + Math.random() * (b - a); }

// Genel savaş: iki taraf, birlik sözlükleri, tip tanımları, çarpanlar
function simulate(att, def) {
  // att/def: { units: {type:count}, defs: {type:{atk,def,hp}}, atkMul, defMul }
  const A = { ...att.units }, D = { ...def.units };
  const rounds = [];
  const sumAtk = (U, defs, mul) => Object.keys(U).reduce((s, t) => s + U[t] * defs[t].atk, 0) * mul;
  const sumHp = (U, defs, mul) => Object.keys(U).reduce((s, t) => s + U[t] * (defs[t].hp + defs[t].def * 2), 0) * mul;
  const total = U => Object.values(U).reduce((s, n) => s + n, 0);
  for (let r = 1; r <= 6; r++) {
    if (total(A) < 0.5 || total(D) < 0.5) break;
    const dmgA = sumAtk(A, att.defs, att.atkMul) * rand(0.85, 1.15) * 0.9;
    const dmgD = sumAtk(D, def.defs, def.atkMul) * rand(0.85, 1.15) * 0.9;
    const hpA = sumHp(A, att.defs, att.defMul), hpD = sumHp(D, def.defs, def.defMul);
    const fD = Math.min(1, dmgA / Math.max(1, hpD) * 1.6), fA = Math.min(1, dmgD / Math.max(1, hpA) * 1.6);
    for (const t in D) D[t] = D[t] * (1 - fD);
    for (const t in A) A[t] = A[t] * (1 - fA);
    rounds.push({ r, attDmg: Math.round(dmgA), defDmg: Math.round(dmgD) });
  }
  const round = U => { const o = {}; for (const t in U) o[t] = Math.max(0, Math.round(U[t])); return o; };
  const Af = round(A), Df = round(D);
  const remA = sumAtk(Af, att.defs, att.atkMul) + sumHp(Af, att.defs, att.defMul) * 0.1;
  const remD = sumAtk(Df, def.defs, def.atkMul) + sumHp(Df, def.defs, def.defMul) * 0.1;
  const attackerWins = total(Af) > 0 && (total(Df) === 0 || remA > remD * 1.0);
  const lossA = {}, lossD = {};
  for (const t in att.units) lossA[t] = att.units[t] - Af[t];
  for (const t in def.units) lossD[t] = def.units[t] - Df[t];
  return { attackerWins, rounds, survA: Af, survD: Df, lossA, lossD };
}

function campUnits(level) {
  return { walker: Math.round(15 * level * Math.pow(1.35, level - 1)), runner: level >= 2 ? Math.round(6 * level * Math.pow(1.3, level - 1)) : 0, brute: level >= 4 ? Math.round(2 * (level - 3) * Math.pow(1.3, level - 1)) : 0 };
}
function campLoot(level) { const m = Math.round(400 * level * Math.pow(1.4, level - 1)); return { food: m, wood: m, metal: Math.round(m * 0.7) }; }
function waveUnits(hq) { return campUnits(Math.max(1, Math.min(8, Math.round(hq * 0.8)))); }

module.exports = { MAX_LEVEL, MAP_SIZE, BUILDINGS, BUILD_ORDER, TROOPS, TROOP_ORDER, ZOMBIES, HERO_POOL, HERO_WEIGHTS, HERO_COST, RES,
  upgradeCost, upgradeTime, prodPerHour, storageCap, protectedAmount, batchSize, hospitalCap, newPlayer, checkPassword, heroStats, power, simulate, campUnits, campLoot, waveUnits };

// Karanlık Savaş: Hayatta Kalma — 2 oyunculu sunucu
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const G = require('./game');

const PORT = +process.env.PORT || 8090;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 2;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BASES = [{ x: 4, y: 4 }, { x: 15, y: 15 }];

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { players: [], camps: [], marches: [], chat: [], nextCampId: 1 };
if (fs.existsSync(DB_FILE)) { try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('DB okunamadı', e); } }
let dirty = false;
function save() { if (!dirty) return; dirty = false; const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB_FILE); }
setInterval(save, 3000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dirty = true; save(); process.exit(0); });

const byId = id => db.players.find(p => p.id === id);
const now = () => Date.now();
const clampLevel = l => Math.min(G.MAX_LEVEL, l);

// ---------- Harita / kamplar ----------
function occupied(x, y) {
  if (BASES.some(b => Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1)) return true;
  return db.camps.some(c => c.x === x && c.y === y);
}
function spawnCamp() {
  let x, y, tries = 0;
  do { x = Math.floor(Math.random() * G.MAP_SIZE); y = Math.floor(Math.random() * G.MAP_SIZE); tries++; } while (occupied(x, y) && tries < 200);
  const r = Math.random();
  const level = r < 0.3 ? 1 : r < 0.55 ? 2 : r < 0.72 ? 3 : r < 0.85 ? 4 : r < 0.94 ? 5 : 6;
  db.camps.push({ id: db.nextCampId++, x, y, level, units: G.campUnits(level), respawnAt: null });
  dirty = true;
}
function ensureCamps() { const alive = db.camps.filter(c => !c.respawnAt).length; for (let i = alive; i < 10; i++) spawnCamp(); }
ensureCamps();

// ---------- Oyuncu durumu ----------
function rates(p) { return { food: G.prodPerHour(p.b.farm), wood: G.prodPerHour(p.b.lumber), metal: G.prodPerHour(p.b.mine) }; }
function accrue(p, t) {
  const dt = (t - p.lastTick) / 3600000; if (dt <= 0) return;
  const r = rates(p), cap = G.storageCap(p.b.hq);
  for (const k of G.RES) { if (p.res[k] < cap) p.res[k] = Math.min(cap, p.res[k] + r[k] * dt); }
  p.lastTick = t;
}
function canPay(p, cost) { return G.RES.every(r => p.res[r] >= (cost[r] || 0)); }
function pay(p, cost) { for (const r of G.RES) p.res[r] -= (cost[r] || 0); }
function addRes(p, gain) { const cap = G.storageCap(p.b.hq); for (const r of G.RES) p.res[r] = Math.min(Math.max(cap, p.res[r]), p.res[r] + (gain[r] || 0)); }
function woundedTotal(p) { return G.TROOP_ORDER.reduce((s, t) => s + p.wounded[t], 0) + (p.heal ? G.TROOP_ORDER.reduce((s, t) => s + (p.heal.units[t] || 0), 0) : 0); }
function addWounded(p, units) { // hastane kapasitesine kadar; geri kalan ölür
  let free = Math.max(0, G.hospitalCap(p.b.hospital) - woundedTotal(p)); const got = {}, died = {};
  for (const t of G.TROOP_ORDER) { const n = units[t] || 0; const w = Math.min(n, free); free -= w; p.wounded[t] += w; got[t] = w; died[t] = n - w; }
  return { got, died };
}
function homeHero(p) { const busy = new Set(db.marches.filter(m => m.ownerId === p.id && m.heroId).map(m => m.heroId)); let best = null, bv = -1; for (const h of p.heroes) { if (busy.has(h.id)) continue; const s = G.heroStats(h); if (s.def > bv) { bv = s.def; best = h; } } return best; }
function heroXp(p, heroId, xp) { const h = p.heroes.find(x => x.id === heroId); if (!h) return null; h.xp += xp; let up = 0; while (h.level < 20 && h.xp >= h.level * 100) { h.xp -= h.level * 100; h.level++; up++; } return up; }
function report(p, r) { r.id = crypto.randomUUID(); r.at = now(); p.reports.unshift(r); p.reports = p.reports.slice(0, 40); dirty = true; const s = socketsOf(p.id); for (const so of s) so.emit('report', r); }

function selfView(p) {
  const t = now(); accrue(p, t);
  const next = {}; for (const k of G.BUILD_ORDER) { const L = p.b[k] + 1; next[k] = L > G.MAX_LEVEL ? null : { level: L, cost: G.upgradeCost(k, L), time: G.upgradeTime(k, L) }; }
  const heroes = p.heroes.map(h => ({ ...h, ...G.heroStats(h), ...pick(G.HERO_POOL.find(x => x.key === h.key), ['name', 'role', 'rarity', 'icon']) }));
  return {
    id: p.id, name: p.name, res: p.res, rates: rates(p), cap: G.storageCap(p.b.hq), protected: G.protectedAmount(p.b.hq),
    b: p.b, next, build: p.build, train: p.train, heal: p.heal, troops: p.troops, wounded: p.wounded, heroes,
    hospitalCap: G.hospitalCap(p.b.hospital), batch: G.batchSize(p.b.barracks), pos: p.pos, shieldUntil: p.shieldUntil,
    nextWaveAt: p.nextWaveAt, lastWaveAt: p.lastWaveAt || 0, stats: p.stats, power: G.power(p), reports: p.reports, serverTime: t,
  };
}
function pick(o, ks) { const r = {}; for (const k of ks) r[k] = o[k]; return r; }
function worldView() {
  return {
    serverTime: now(), mapSize: G.MAP_SIZE,
    players: db.players.map(p => ({ id: p.id, name: p.name, pos: p.pos, hq: p.b.hq, wall: p.b.wall, power: G.power(p), shieldUntil: p.shieldUntil, stats: p.stats, online: socketsOf(p.id).length > 0 })),
    camps: db.camps.filter(c => !c.respawnAt).map(c => ({ id: c.id, x: c.x, y: c.y, level: c.level, units: c.units })),
    marches: db.marches.map(m => ({ id: m.id, ownerId: m.ownerId, from: m.from, to: m.to, phase: m.phase, startAt: m.startAt, arriveAt: m.arriveAt, returnAt: m.returnAt, target: m.target })),
  };
}
const CONFIG = { BUILDINGS: G.BUILDINGS, BUILD_ORDER: G.BUILD_ORDER, TROOPS: G.TROOPS, TROOP_ORDER: G.TROOP_ORDER, ZOMBIES: G.ZOMBIES, HERO_POOL: G.HERO_POOL, HERO_COST: G.HERO_COST, MAX_LEVEL: G.MAX_LEVEL };

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const attempts = new Map();
function limited(ip) { const t = now(); const a = (attempts.get(ip) || []).filter(x => t - x < 60000); a.push(t); attempts.set(ip, a); return a.length > 15; }
app.get('/api/slots', (req, res) => res.json({ max: MAX_PLAYERS, used: db.players.length, names: db.players.map(p => p.name) }));
app.post('/api/register', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ ok: false, msg: 'Çok fazla deneme, 1 dakika bekleyin.' });
  const name = String(req.body.name || '').trim(), pw = String(req.body.password || '');
  if (name.length < 2 || name.length > 16) return res.json({ ok: false, msg: 'İsim 2-16 karakter olmalı.' });
  if (pw.length < 4) return res.json({ ok: false, msg: 'Şifre en az 4 karakter olmalı.' });
  if (db.players.length >= MAX_PLAYERS) return res.json({ ok: false, msg: 'Tüm oyuncu yerleri dolu (2/2). Giriş yapın.' });
  if (db.players.some(p => p.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) return res.json({ ok: false, msg: 'Bu isim alınmış.' });
  const p = G.newPlayer(name, pw); if (process.env.NEWBIE_SHIELD === '0') p.shieldUntil = 0; p.pos = BASES[db.players.length]; const token = crypto.randomBytes(24).toString('hex'); p.tokens.push(token);
  db.players.push(p); dirty = true; broadcastWorld();
  chatSystem(`${name} kıyamet dünyasına katıldı!`);
  res.json({ ok: true, token });
});
app.post('/api/login', (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ ok: false, msg: 'Çok fazla deneme, 1 dakika bekleyin.' });
  const name = String(req.body.name || '').trim(), pw = String(req.body.password || '');
  const p = db.players.find(x => x.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
  if (!p || !G.checkPassword(p, pw)) return res.json({ ok: false, msg: 'İsim veya şifre hatalı.' });
  const token = crypto.randomBytes(24).toString('hex'); p.tokens.push(token); p.tokens = p.tokens.slice(-5); dirty = true;
  res.json({ ok: true, token });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
function socketsOf(pid) { return [...(io.sockets.sockets?.values() || [])].filter(s => s.data.pid === pid); }
function pushState(p) { const v = selfView(p); for (const s of socketsOf(p.id)) s.emit('state', v); }
function broadcastWorld() { io.emit('world', worldView()); }
function chatSystem(text) { const m = { id: crypto.randomUUID(), system: true, text, at: now() }; db.chat.push(m); db.chat = db.chat.slice(-200); dirty = true; io.emit('chat', m); }

io.use((socket, next) => { const tok = socket.handshake.auth && socket.handshake.auth.token; const p = db.players.find(x => x.tokens.includes(tok)); if (!p) return next(new Error('AUTH')); socket.data.pid = p.id; next(); });
io.on('connection', socket => {
  const me = () => byId(socket.data.pid);
  socket.emit('config', CONFIG);
  pushState(me()); socket.emit('world', worldView()); socket.emit('chatHistory', db.chat.slice(-100));
  broadcastWorld();
  socket.on('disconnect', () => setTimeout(broadcastWorld, 100));
  const act = (name, fn) => socket.on(name, (arg, ack) => {
    const p = me(); if (!p) return; accrue(p, now());
    let r; try { r = fn(p, arg || {}) || { ok: true }; } catch (e) { console.error(e); r = { ok: false, msg: 'Sunucu hatası' }; }
    if (r.ok) dirty = true; pushState(p); if (r.world) broadcastWorld();
    if (typeof ack === 'function') ack(r);
  });

  act('upgrade', (p, { key }) => {
    const B = G.BUILDINGS[key]; if (!B) return { ok: false, msg: 'Geçersiz bina.' };
    if (p.build) return { ok: false, msg: 'İnşaat ekibi meşgul.' };
    const L = p.b[key] + 1; if (L > G.MAX_LEVEL) return { ok: false, msg: 'Azami seviye.' };
    if (key !== 'hq' && L > p.b.hq + 1) return { ok: false, msg: `Önce Karargah'ı ${L - 1}. seviyeye yükseltin.` };
    if (key === 'hq' && p.b.wall < L - 1) return { ok: false, msg: `Karargah ${L} için Duvar en az ${L - 1}. seviye olmalı.` };
    const cost = G.upgradeCost(key, L); if (!canPay(p, cost)) return { ok: false, msg: 'Yetersiz kaynak.' };
    pay(p, cost); p.build = { key, level: L, startAt: now(), endAt: now() + G.upgradeTime(key, L) * 1000 };
    return { ok: true, msg: `${B.name} ${L}. seviyeye yükseltiliyor.` };
  });
  act('speedup', (p) => { // ücretsiz hızlandırma: kalan süre < 60 sn
    if (!p.build) return { ok: false, msg: 'İnşaat yok.' };
    if (p.build.endAt - now() > 60000) return { ok: false, msg: 'Ücretsiz hızlandırma son 1 dakikada kullanılabilir.' };
    p.build.endAt = now(); return { ok: true, msg: 'Hızlandırıldı!' };
  });
  act('train', (p, { type, count }) => {
    const T = G.TROOPS[type]; count = Math.floor(+count); if (!T || !(count > 0)) return { ok: false, msg: 'Geçersiz eğitim.' };
    if (p.train) return { ok: false, msg: 'Kışla zaten eğitim yapıyor.' };
    if (p.b.barracks < T.unlock) return { ok: false, msg: `${T.name} için Kışla ${T.unlock}. seviye gerekli.` };
    if (count > G.batchSize(p.b.barracks)) return { ok: false, msg: `Tek seferde en fazla ${G.batchSize(p.b.barracks)} asker.` };
    const cost = {}; for (const r of G.RES) cost[r] = T.cost[r] * count; if (!canPay(p, cost)) return { ok: false, msg: 'Yetersiz kaynak.' };
    pay(p, cost); const secs = Math.max(2, Math.round(count * T.time / (1 + 0.1 * (p.b.barracks - 1))));
    p.train = { type, count, startAt: now(), endAt: now() + secs * 1000 }; return { ok: true, msg: `${count} ${T.name} eğitiliyor.` };
  });
  act('heal', (p) => {
    if (p.heal) return { ok: false, msg: 'Zaten tedavi sürüyor.' };
    const units = { ...p.wounded }; const n = G.TROOP_ORDER.reduce((s, t) => s + units[t], 0); if (!n) return { ok: false, msg: 'Yaralı asker yok.' };
    const cost = { food: 0, wood: 0, metal: 0 }; for (const t of G.TROOP_ORDER) for (const r of G.RES) cost[r] += Math.round(G.TROOPS[t].cost[r] * units[t] * 0.25);
    if (!canPay(p, cost)) return { ok: false, msg: 'Tedavi için yetersiz kaynak.' };
    pay(p, cost); for (const t of G.TROOP_ORDER) p.wounded[t] = 0;
    const secs = Math.max(3, Math.round(n * 0.6 / p.b.hospital)); p.heal = { units, startAt: now(), endAt: now() + secs * 1000 };
    return { ok: true, msg: `${n} yaralı tedavi ediliyor.` };
  });
  act('recruit', (p) => {
    if (!canPay(p, G.HERO_COST)) return { ok: false, msg: 'Kahraman çağırmak için 800 yiyecek + 800 metal gerekli.' };
    pay(p, G.HERO_COST);
    const tot = Object.values(G.HERO_WEIGHTS).reduce((a, b) => a + b, 0); let r = Math.random() * tot, rar = 'Nadir';
    for (const [k, w] of Object.entries(G.HERO_WEIGHTS)) { if (r < w) { rar = k; break; } r -= w; }
    const opts = G.HERO_POOL.filter(h => h.rarity === rar); const h = opts[Math.floor(Math.random() * opts.length)];
    const have = p.heroes.find(x => x.key === h.key);
    if (have) { if (have.stars < 5) { have.stars++; return { ok: true, hero: h, dup: true, msg: `${h.icon} ${h.name} tekrar geldi! Yıldız ${have.stars}★ oldu.` }; } heroXp(p, have.id, 300); return { ok: true, hero: h, dup: true, msg: `${h.name} zaten 5★, 300 XP kazandı.` }; }
    p.heroes.push({ id: crypto.randomUUID(), key: h.key, level: 1, xp: 0, stars: 1 });
    return { ok: true, hero: h, msg: `Yeni kahraman: ${h.icon} ${h.name} (${h.rarity})!` };
  });
  act('march', (p, { target, units, heroId }) => {
    const send = {}; let n = 0;
    for (const t of G.TROOP_ORDER) { const c = Math.max(0, Math.floor(+(units || {})[t] || 0)); if (c > p.troops[t]) return { ok: false, msg: 'Yeterli asker yok.' }; send[t] = c; n += c; }
    if (!n) return { ok: false, msg: 'En az 1 asker gönderin.' };
    if (db.marches.filter(m => m.ownerId === p.id).length >= 2) return { ok: false, msg: 'Aynı anda en fazla 2 sefer.' };
    if (heroId) { if (!p.heroes.find(h => h.id === heroId)) return { ok: false, msg: 'Kahraman yok.' }; if (db.marches.some(m => m.heroId === heroId)) return { ok: false, msg: 'Kahraman zaten seferde.' }; }
    let to, tgt;
    if (target && target.type === 'camp') { const c = db.camps.find(x => x.id === +target.id && !x.respawnAt); if (!c) return { ok: false, msg: 'Kamp bulunamadı.' }; to = { x: c.x, y: c.y }; tgt = { type: 'camp', id: c.id, level: c.level }; }
    else if (target && target.type === 'player') {
      const d = byId(target.id); if (!d || d.id === p.id) return { ok: false, msg: 'Hedef bulunamadı.' };
      if (d.shieldUntil > now()) return { ok: false, msg: `${d.name} kalkan altında.` };
      to = { ...d.pos }; tgt = { type: 'player', id: d.id, name: d.name }; p.shieldUntil = 0;
    } else return { ok: false, msg: 'Hedef seçin.' };
    for (const t of G.TROOP_ORDER) p.troops[t] -= send[t];
    const dist = Math.hypot(to.x - p.pos.x, to.y - p.pos.y); const travel = Math.max(8, Math.round(dist * 2.5)) * 1000;
    db.marches.push({ id: crypto.randomUUID(), ownerId: p.id, from: { ...p.pos }, to, target: tgt, units: send, heroId: heroId || null, phase: 'go', startAt: now(), arriveAt: now() + travel, travel, returnAt: null, loot: null, survivors: null });
    return { ok: true, world: true, msg: `Sefer yola çıktı (${Math.round(travel / 1000)} sn).` };
  });
  act('wave', (p) => {
    if (now() - (p.lastWaveAt || 0) < 10 * 60000) return { ok: false, msg: 'Son dalgadan sonra 10 dakika beklemelisiniz.' };
    p.nextWaveAt = now(); return { ok: true, msg: 'Zombi dalgası geliyor!' };
  });
  act('chat', (p, { text }) => {
    text = String(text || '').trim().slice(0, 300); if (!text) return { ok: false };
    const m = { id: crypto.randomUUID(), from: p.id, name: p.name, text, at: now() }; db.chat.push(m); db.chat = db.chat.slice(-200); io.emit('chat', m); return { ok: true };
  });
});

// ---------- Savaş çözümleri ----------
function troopDefs() { return G.TROOPS; }
function heroMul(p, heroId) { const h = heroId && p.heroes.find(x => x.id === heroId); if (!h) return { atk: 1, def: 1, h: null }; const s = G.heroStats(h); return { atk: 1 + s.atk / 100, def: 1 + s.def / 100, h }; }
function wallUnit(level) { return { atk: 8 * level, def: 30 * level, hp: 300 * level }; }
function defenderSide(d) {
  const hh = homeHero(d); const hm = heroMul(d, hh && hh.id);
  const units = { ...d.troops, wall: 1 }; const defs = { ...G.TROOPS, wall: wallUnit(d.b.wall) };
  return { units, defs, atkMul: hm.atk * (1 + 0.02 * d.b.wall), defMul: hm.def * (1 + 0.06 * d.b.wall), hero: hm.h };
}
function nameUnits(u, defs) { return u; }
function carry(units) { return (units.inf || 0) * 50 + (units.sniper || 0) * 40 + (units.tank || 0) * 120; }

function resolveArrival(m) {
  const p = byId(m.ownerId); if (!p) return;
  const hm = heroMul(p, m.heroId);
  const att = { units: { ...m.units }, defs: G.TROOPS, atkMul: hm.atk, defMul: hm.def };
  const heroInfo = hm.h ? G.HERO_POOL.find(x => x.key === hm.h.key).name : null;
  if (m.target.type === 'camp') {
    const c = db.camps.find(x => x.id === m.target.id && !x.respawnAt);
    if (!c) { m.survivors = m.units; m.loot = {}; report(p, { kind: 'camp', title: 'Kamp boştu', text: 'Hedef kamp başka biri tarafından temizlenmiş. Askerler geri dönüyor.' }); return; }
    const res = G.simulate(att, { units: { ...c.units }, defs: G.ZOMBIES, atkMul: 1, defMul: 1 });
    finishAttackerLosses(p, m, res);
    if (res.attackerWins) {
      m.loot = G.campLoot(c.level); c.respawnAt = now() + 5 * 60000; p.stats.campWin++; p.stats.kills += sum(res.lossD);
      const up = m.heroId ? heroXp(p, m.heroId, 40 * c.level) : 0;
      report(p, { kind: 'camp', win: true, title: `Zombi Kampı Sv.${c.level} temizlendi!`, hero: heroInfo, heroUp: up, att: m.units, attLoss: res.lossA, def: c.units, defLoss: res.lossD, defNames: 'zombie', loot: m.loot, rounds: res.rounds });
    } else {
      const orig = { ...c.units }; c.units = res.survD; m.loot = {}; p.stats.kills += sum(res.lossD);
      if (m.heroId) heroXp(p, m.heroId, 10 * c.level);
      report(p, { kind: 'camp', win: false, title: `Zombi Kampı Sv.${c.level}: geri çekildik`, hero: heroInfo, att: m.units, attLoss: res.lossA, def: orig, defLoss: res.lossD, defNames: 'zombie', loot: {}, rounds: res.rounds });
    }
  } else {
    const d = byId(m.target.id); if (!d) { m.survivors = m.units; m.loot = {}; return; }
    accrue(d, now());
    const ds = defenderSide(d); const defHeroName = ds.hero ? G.HERO_POOL.find(x => x.key === ds.hero.key).name : null;
    const res = G.simulate(att, ds);
    finishAttackerLosses(p, m, res);
    const dl = { ...res.lossD }; delete dl.wall; const defUnits = { ...d.troops };
    for (const t of G.TROOP_ORDER) d.troops[t] = Math.max(0, d.troops[t] - (dl[t] || 0));
    const wnd = {}; for (const t of G.TROOP_ORDER) wnd[t] = Math.round((dl[t] || 0) * 0.7);
    const hw = addWounded(d, wnd);
    let loot = {};
    if (res.attackerWins) {
      const cap = carry(m.survivors); const avail = {}; let tot = 0;
      for (const r of G.RES) { avail[r] = Math.max(0, d.res[r] - G.protectedAmount(d.b.hq)) * 0.3; tot += avail[r]; }
      const f = tot > cap ? cap / tot : 1; for (const r of G.RES) { loot[r] = Math.floor(avail[r] * f); d.res[r] -= loot[r]; }
      d.shieldUntil = now() + 30 * 60000; p.stats.pvpWin++; d.stats.pvpLoss++;
    } else { p.stats.pvpLoss++; d.stats.pvpWin++; }
    m.loot = loot; p.stats.kills += sum(dl); d.stats.kills += sum(res.lossA);
    const upA = m.heroId ? heroXp(p, m.heroId, res.attackerWins ? 150 : 50) : 0; if (ds.hero) heroXp(d, ds.hero.id, res.attackerWins ? 50 : 150);
    const base = { kind: 'pvp', attacker: p.name, defender: d.name, att: m.units, attLoss: res.lossA, def: defUnits, defLoss: dl, wall: d.b.wall, hero: heroInfo, defHero: defHeroName, loot, rounds: res.rounds, defWounded: hw.got };
    report(p, { ...base, win: res.attackerWins, heroUp: upA, title: res.attackerWins ? `Zafer! ${d.name} üssü yağmalandı` : `Yenilgi: ${d.name} üssünü savundu` });
    report(d, { ...base, win: !res.attackerWins, title: res.attackerWins ? `${p.name} üssünüzü yağmaladı!` : `${p.name} saldırısı püskürtüldü!` });
    chatSystem(res.attackerWins ? `⚔️ ${p.name}, ${d.name} üssüne saldırdı ve kazandı!` : `🛡️ ${d.name}, ${p.name} saldırısını püskürttü!`);
    pushState(d);
  }
}
function sum(u) { return Object.entries(u).filter(([k]) => k !== 'wall').reduce((s, [, n]) => s + n, 0); }
function finishAttackerLosses(p, m, res) { m.survivors = res.survA; m.attWounded = {}; for (const t of G.TROOP_ORDER) m.attWounded[t] = Math.round((res.lossA[t] || 0) * 0.4); }

function resolveWave(p) {
  const level = Math.max(1, Math.min(8, Math.round(p.b.hq * 0.8)));
  const ds = defenderSide(p); const z = G.waveUnits(p.b.hq);
  const res = G.simulate({ units: z, defs: G.ZOMBIES, atkMul: 1, defMul: 1 }, ds);
  const dl = { ...res.lossD }; delete dl.wall; const before = { ...p.troops };
  for (const t of G.TROOP_ORDER) p.troops[t] = Math.max(0, p.troops[t] - (dl[t] || 0));
  const wnd = {}; for (const t of G.TROOP_ORDER) wnd[t] = Math.round((dl[t] || 0) * 0.8); addWounded(p, wnd);
  let loot = {}, lost = {};
  if (!res.attackerWins) { const l = G.campLoot(level); for (const r of G.RES) loot[r] = Math.round(l[r] * 0.5); addRes(p, loot); p.stats.waveWin++; }
  else { for (const r of G.RES) { lost[r] = Math.floor(Math.max(0, p.res[r] - G.protectedAmount(p.b.hq)) * 0.1); p.res[r] -= lost[r]; } }
  p.stats.kills += sum(res.lossA);
  p.lastWaveAt = now(); p.nextWaveAt = now() + 2 * 3600000;
  report(p, { kind: 'wave', win: !res.attackerWins, title: !res.attackerWins ? `Zombi dalgası (Sv.${level}) püskürtüldü!` : `Zombi dalgası (Sv.${level}) üsse sızdı!`, att: z, attLoss: res.lossA, def: before, defLoss: dl, wall: p.b.wall, loot, lost, rounds: res.rounds });
}

// ---------- Ana döngü ----------
setInterval(() => {
  const t = now(); let world = false;
  for (const p of db.players) {
    accrue(p, t); let changed = false;
    if (p.build && p.build.endAt <= t) { p.b[p.build.key] = p.build.level; const B = G.BUILDINGS[p.build.key]; for (const s of socketsOf(p.id)) s.emit('toast', `✅ ${B.name} ${p.build.level}. seviye oldu!`); p.build = null; changed = world = true; }
    if (p.train && p.train.endAt <= t) { p.troops[p.train.type] += p.train.count; for (const s of socketsOf(p.id)) s.emit('toast', `🪖 ${p.train.count} ${G.TROOPS[p.train.type].name} eğitimi tamamlandı!`); p.train = null; changed = world = true; }
    if (p.heal && p.heal.endAt <= t) { for (const k of G.TROOP_ORDER) p.troops[k] += p.heal.units[k] || 0; for (const s of socketsOf(p.id)) s.emit('toast', '🏥 Yaralılar iyileşti ve göreve döndü!'); p.heal = null; changed = true; }
    if (p.nextWaveAt && p.nextWaveAt <= t) { resolveWave(p); changed = world = true; }
    if (changed) { dirty = true; pushState(p); }
  }
  for (const m of [...db.marches]) {
    if (m.phase === 'go' && m.arriveAt <= t) { resolveArrival(m); m.phase = 'back'; m.returnAt = t + m.travel; dirty = world = true; const p = byId(m.ownerId); if (p) pushState(p); }
    else if (m.phase === 'back' && m.returnAt <= t) {
      const p = byId(m.ownerId);
      if (p) { for (const k of G.TROOP_ORDER) p.troops[k] += (m.survivors || {})[k] || 0; addWounded(p, m.attWounded || {}); addRes(p, m.loot || {}); for (const s of socketsOf(p.id)) s.emit('toast', '🏠 Sefer üsse döndü.'); pushState(p); }
      db.marches = db.marches.filter(x => x !== m); dirty = world = true;
    }
  }
  for (const c of db.camps) if (c.respawnAt && c.respawnAt <= t) { db.camps = db.camps.filter(x => x !== c); world = true; }
  const before = db.camps.length; ensureCamps(); if (db.camps.length !== before) world = true;
  if (world) broadcastWorld();
}, 1000);
setInterval(() => { for (const p of db.players) if (socketsOf(p.id).length) pushState(p); }, 10000);

server.listen(PORT, () => console.log(`Karanlık Savaş sunucusu: http://localhost:${PORT}`));

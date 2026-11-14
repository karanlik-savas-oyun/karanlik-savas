'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => { n = Math.floor(n || 0); if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M'; if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + 'B'; return n.toLocaleString('tr-TR'); };
const dur = s => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}sa ${m}dk` : m ? `${m}dk ${x}sn` : `${x}sn`; };
const RICON = { food: '🌽', wood: '🪵', metal: '⚙️' }, RNAME = { food: 'Yiyecek', wood: 'Odun', metal: 'Metal' };
const ZICON = { walker: '🧟', runner: '🧟‍♂️', brute: '👹' };

let token = localStorage.getItem('dw_token'), socket = null, C = null, S = null, W = null, stateAt = 0, skew = 0, tab = 'base', chat = [], selected = null;
const ui = { train: {}, };

// ---------- giriş ----------
let regMode = false;
function setMode(r) { regMode = r; $('#tabLogin').classList.toggle('on', !r); $('#tabReg').classList.toggle('on', r); $('#lgo').textContent = r ? 'Kayıt Ol ve Başla' : 'Giriş Yap'; $('#lpass').autocomplete = r ? 'new-password' : 'current-password'; }
$('#tabLogin').onclick = () => setMode(false); $('#tabReg').onclick = () => setMode(true);
async function loadSlots() { try { const r = await (await fetch('/api/slots')).json(); $('#slots').innerHTML = `Oyuncu yerleri: <b>${r.used}/${r.max}</b>${r.names.length ? ' · ' + r.names.map(esc).join(', ') : ''}`; if (r.used >= r.max && !r.adminFree) { setMode(false); $('#tabReg').disabled = true; $('#tabReg').style.opacity = .4; } else if (r.used === 0) setMode(true); } catch (e) { $('#slots').textContent = 'Sunucuya ulaşılamıyor'; } }
$('#lgo').onclick = async () => {
  $('#lerr').textContent = '';
  const body = { name: $('#lname').value, password: $('#lpass').value };
  try { const r = await (await fetch(regMode ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (!r.ok) { $('#lerr').textContent = r.msg; return; } token = r.token; localStorage.setItem('dw_token', token); connect(); } catch (e) { $('#lerr').textContent = 'Bağlantı hatası.'; }
};
$('#lpass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lgo').click(); });
$('#logout').onclick = () => { if (!confirm('Çıkış yapılsın mı?')) return; localStorage.removeItem('dw_token'); location.reload(); };

function connect() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });
  socket.on('connect_error', e => { if (e.message === 'AUTH') { localStorage.removeItem('dw_token'); token = null; showLogin(); } });
  socket.on('config', c => { C = c; });
  socket.on('state', s => { const first = !S; S = s; $('#navAdmin').classList.toggle('hidden', !s.isAdmin); stateAt = Date.now(); skew = s.serverTime - Date.now(); $('#login').classList.add('hidden'); $('#game').classList.remove('hidden'); if (first || (tab !== 'chat' && tab !== 'admin')) render(); if (tab === 'admin') adminRefresh(); headerTick(); });
  socket.on('world', w => { W = w; if (tab === 'map' && mv.busy) { mv.pending = true; return; } if (['map', 'rank'].includes(tab)) render(); });
  socket.on('toast', t => toast(t));
  socket.on('report', r => { toast((r.win ? '🏆 ' : '💀 ') + r.title, !r.win); if (tab !== 'reports') $('#repDot').classList.remove('hidden'); });
  socket.on('chatHistory', h => { chat = h; if (tab === 'chat') render(); });
  socket.on('chat', m => { chat.push(m); if (tab === 'chat') appendMsg(m, true); else if (m.from !== (S && S.id)) $('#chatDot').classList.remove('hidden'); });
}
function showLogin() { $('#game').classList.add('hidden'); $('#login').classList.remove('hidden'); loadSlots(); }
function act(ev, data) { return new Promise(res => socket.emit(ev, data, r => { if (r && r.msg) toast(r.msg, !r.ok); res(r || {}); })); }
function toast(t, bad) { const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = t; $('#toasts').appendChild(d); setTimeout(() => d.remove(), 3800); }
const sNow = () => Date.now() + skew;

// ---------- kaynak / başlık ----------
function curRes() { const dt = (Date.now() - stateAt) / 3600000; const o = {}; for (const r of ['food', 'wood', 'metal']) o[r] = S.res[r] >= S.cap ? S.res[r] : Math.min(S.cap, S.res[r] + S.rates[r] * dt); return o; }
function headerTick() {
  if (!S) return; const r = curRes();
  for (const k in r) { $('#r_' + k).textContent = fmt(r[k]); $('#rr_' + k).textContent = r[k] >= S.cap ? 'DEPO DOLU' : '+' + fmt(S.rates[k]) + '/sa'; $('#r_' + k).closest('.res').classList.toggle('full', r[k] >= S.cap); }
  $('#pname').textContent = S.name; $('#ppower').textContent = '⚡ ' + fmt(S.power);
  const sh = S.shieldUntil - sNow(); $('#pshield').textContent = sh > 0 ? '🛡️ Kalkan ' + dur(sh / 1000) : 'Kalkan yok';
  document.querySelectorAll('[data-end]').forEach(el => { const end = +el.dataset.end, st = +el.dataset.start; const left = (end - sNow()) / 1000; if (el.classList.contains('bar')) el.firstElementChild.style.width = Math.min(100, Math.max(0, (sNow() - st) / (end - st) * 100)) + '%'; else el.textContent = left > 0 ? dur(left) : 'tamamlanıyor…'; });
  document.querySelectorAll('[data-cost]').forEach(el => { const c = JSON.parse(el.dataset.cost); const ok = Object.keys(c).every(k => r[k] >= c[k]); el.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('no', r[x.dataset.r] < c[x.dataset.r])); const b = el.parentElement.querySelector('button[data-needres]'); if (b && !b.dataset.locked) b.disabled = !ok; });
}
setInterval(headerTick, 1000);
function costHtml(c, mult = 1) { const o = {}; let h = ''; for (const k of ['food', 'wood', 'metal']) { const v = Math.round((c[k] || 0) * mult); if (!v) continue; o[k] = v; h += `<span data-r="${k}">${RICON[k]} ${fmt(v)}</span>`; } return `<div class="cost" data-cost='${JSON.stringify(o)}'>${h || '<span>Ücretsiz</span>'}</div>`; }
function timerBlock(start, end, label) { return `<div class="row small"><span>${label}</span><span data-end="${end}" data-start="${start}"></span></div><div class="bar" data-end="${end}" data-start="${start}"><i></i></div>`; }
const unitList = (u, defs, icons) => Object.entries(u || {}).filter(([k, n]) => n > 0 && defs[k]).map(([k, n]) => `${icons ? icons[k] || '' : defs[k].icon || ''} ${defs[k].name} ×${fmt(n)}`).join(', ') || '—';
const resList = r => Object.entries(r || {}).filter(([, v]) => v > 0).map(([k, v]) => `${RICON[k]} ${fmt(v)}`).join('  ') || '—';

// ---------- sekmeler ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b)); if (tab === 'reports') $('#repDot').classList.add('hidden'); if (tab === 'chat') $('#chatDot').classList.add('hidden'); render(); $('#main').scrollTop = 0; });
function render() { if (!S || !C) return; const m = $('#main'); const f = { base, army, heroes, map, reports, chat: chatTab, rank, admin: adminTab, inside }[tab]; m.innerHTML = f(); bind[tab] && bind[tab](); headerTick(); }
const bind = {};

function base() {
  let h = '<h2>Durum</h2><div class="card status">';
  if (S.build) { const B = C.BUILDINGS[S.build.key]; h += timerBlock(S.build.startAt, S.build.endAt, `🔨 ${B.name} → Sv.${S.build.level}`); h += `<button class="btn sm" id="speed">⚡ Ücretsiz hızlandır (son 1 dk)</button>`; }
  else h += '<div class="small">🔨 İnşaat ekibi boşta — bir bina yükseltin.</div>';
  if (S.train) h += timerBlock(S.train.startAt, S.train.endAt, `🪖 ${S.train.count} ${C.TROOPS[S.train.type].name} eğitimi`);
  if (S.heal) h += timerBlock(S.heal.startAt, S.heal.endAt, '🏥 Tedavi');
  h += `<div class="row" style="margin-top:6px"><span>🧟 Sıradaki zombi dalgası: <b data-end="${S.nextWaveAt}" data-start="${S.lastWaveAt}"></b></span><button class="btn red sm" id="wave">Şimdi savaş</button></div>`;
  h += `<div class="small">Korunan kaynak: her biri ${fmt(S.protected)} · Depo kapasitesi: ${fmt(S.cap)}</div></div>`;
  h += '<h2>Binalar</h2><div class="grid">';
  for (const k of C.BUILD_ORDER) {
    const B = C.BUILDINGS[k], n = S.next[k], L = S.b[k];
    let extra = '';
    if (k === 'farm') extra = `Üretim: ${fmt(S.rates.food)}/sa`; else if (k === 'lumber') extra = `Üretim: ${fmt(S.rates.wood)}/sa`; else if (k === 'mine') extra = `Üretim: ${fmt(S.rates.metal)}/sa`;
    else if (k === 'barracks') extra = `Parti: ${S.batch} asker`; else if (k === 'hospital') extra = `Kapasite: ${S.hospitalCap}`; else if (k === 'wall') extra = `Savunma +%${6 * L}`; else if (k === 'hq') extra = `Depo: ${fmt(S.cap)}`;
    let lock = ''; if (n) { if (k !== 'hq' && n.level > S.b.hq + 1) lock = `Karargah Sv.${n.level - 1} gerekli`; if (k === 'hq' && S.b.wall < n.level - 1) lock = `Duvar Sv.${n.level - 1} gerekli`; }
    const busy = S.build && S.build.key === k;
    h += `<div class="card"><div class="bhead"><div class="bicon">${B.icon}<span class="lvl">${L}</span></div><div><div class="bname">${B.name}</div><div class="bdesc">${B.desc}</div><div class="small" style="color:#cfc8b8">${extra}</div></div></div>`;
    if (!n) h += '<div class="pill good" style="margin-top:8px">Azami seviye</div>';
    else { h += costHtml(n.cost) + `<div class="row"><span class="small">⏱ ${dur(n.time)}${lock ? ' · <span style="color:#ff9d5c">🔒 ' + lock + '</span>' : ''}</span><button class="btn sm" data-up="${k}" data-needres="1" ${lock || S.build ? 'data-locked="1" disabled' : ''}>${busy ? 'İnşa ediliyor' : 'Yükselt → ' + n.level}</button></div>`; }
    h += '</div>';
  }
  return h + '</div>';
}
bind.base = () => { document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => act('upgrade', { key: b.dataset.up })); $('#wave').onclick = () => act('wave'); const sp = $('#speed'); if (sp) sp.onclick = () => act('speedup'); };

function army() {
  const T = C.TROOPS; let h = '<h2>Ordu</h2><div class="card"><div class="row">';
  for (const t of C.TROOP_ORDER) h += `<div style="text-align:center;flex:1"><div style="font-size:26px">${T[t].icon}</div><div class="troopcount">${fmt(S.troops[t])}</div><div class="small">${T[t].name}</div></div>`;
  h += '</div></div>';
  if (S.train) h += `<div class="card">${timerBlock(S.train.startAt, S.train.endAt, `🪖 ${S.train.count} ${T[S.train.type].name} eğitiliyor`)}</div>`;
  h += `<h2>Kışla (Sv.${S.b.barracks})</h2>`;
  for (const t of C.TROOP_ORDER) {
    const U = T[t], locked = S.b.barracks < U.unlock; const v = Math.min(ui.train[t] || 10, S.batch);
    h += `<div class="card"><div class="bhead"><div class="bicon">${U.icon}</div><div style="flex:1"><div class="bname">${U.name}</div><div class="stat"><span>⚔️ ${U.atk}</span><span>🛡️ ${U.def}</span><span>❤️ ${U.hp}</span><span>⏱ ${U.time}sn/asker</span></div></div></div>`;
    if (locked) h += `<div class="pill warn" style="margin-top:8px">🔒 Kışla Sv.${U.unlock} gerekli</div>`;
    else h += `<div class="row" style="margin-top:6px"><input type="range" min="1" max="${S.batch}" value="${v}" data-tr="${t}" style="flex:1"><b style="width:44px;text-align:right" id="tc_${t}">${v}</b></div><div id="tcost_${t}">${costHtml(U.cost, v)}</div><button class="btn sm" data-train="${t}" data-needres="1" ${S.train ? 'data-locked="1" disabled' : ''} style="width:100%">Eğit</button>`;
    h += '</div>';
  }
  const wt = C.TROOP_ORDER.reduce((s, t) => s + S.wounded[t], 0);
  h += `<h2>Hastane (Sv.${S.b.hospital})</h2><div class="card"><div>Yaralı: <b>${wt}</b> / ${S.hospitalCap}</div><div class="small">${unitList(S.wounded, T)}</div>`;
  if (S.heal) h += timerBlock(S.heal.startAt, S.heal.endAt, '🏥 Tedavi sürüyor');
  else if (wt) { const c = { food: 0, wood: 0, metal: 0 }; for (const t of C.TROOP_ORDER) for (const r in c) c[r] += Math.round(T[t].cost[r] * S.wounded[t] * .25); h += costHtml(c) + '<button class="btn grn sm" id="heal" data-needres="1" style="width:100%">Tümünü İyileştir</button>'; }
  else h += '<div class="small" style="margin-top:6px">Hastane boş. Kapasite dolarsa yaralılar ölür!</div>';
  return h + '</div>';
}
bind.army = () => {
  document.querySelectorAll('[data-tr]').forEach(i => i.oninput = () => { const t = i.dataset.tr; ui.train[t] = +i.value; $('#tc_' + t).textContent = i.value; $('#tcost_' + t).innerHTML = costHtml(C.TROOPS[t].cost, +i.value); headerTick(); });
  document.querySelectorAll('[data-train]').forEach(b => b.onclick = () => { const t = b.dataset.train; act('train', { type: t, count: +document.querySelector(`[data-tr="${t}"]`).value }); });
  const hb = $('#heal'); if (hb) hb.onclick = () => act('heal');
};

function heroCard(h) { return `<div class="card hero"><div class="bicon rar-${h.rarity}">${h.icon}<span class="lvl">${h.level}</span></div><div style="flex:1"><div class="bname">${h.name} <span class="stars">${'★'.repeat(h.stars)}</span></div><div class="small">${h.rarity} · ${h.role}</div><div class="stat"><span>⚔️ +%${h.atk} saldırı</span><span>🛡️ +%${h.def} savunma</span></div><div class="bar"><i style="width:${Math.min(100, h.xp / (h.level * 100) * 100)}%"></i></div><div class="small">XP ${h.xp}/${h.level * 100}</div></div></div>`; }
function heroes() {
  let h = `<h2>Kahraman Çağır</h2><div class="card"><div class="small">Her çağrı rastgele bir kahraman getirir: Nadir %50 · Epik %35 · Efsanevi %15. Tekrar gelen kahraman yıldız kazanır.</div>${costHtml(C.HERO_COST)}<button class="btn big" id="recruit" data-needres="1">🎲 Kahraman Çağır</button></div>`;
  h += `<h2>Kahramanlarım (${S.heroes.length})</h2>`;
  if (!S.heroes.length) h += '<div class="card small">Henüz kahraman yok. Kahramanlar seferlerde saldırı/savunma bonusu verir; üste kalan en iyi savunmacı kahraman üssü korur.</div>';
  for (const x of S.heroes) h += heroCard(x);
  h += '<h2>Tüm Kahramanlar</h2><div class="grid">';
  for (const x of C.HERO_POOL) { const own = S.heroes.find(y => y.key === x.key); h += `<div class="card hero" style="${own ? '' : 'opacity:.55'}"><div class="bicon rar-${x.rarity}">${x.icon}</div><div><div class="bname">${x.name}</div><div class="small">${x.rarity} · ${x.role} · ⚔️${x.atk} 🛡️${x.def}</div></div></div>`; }
  return h + '</div>';
}
bind.heroes = () => { $('#recruit').onclick = async () => { const r = await act('recruit'); if (r.ok && r.hero) modal(`<div class="reveal">${r.hero.icon}</div><h3 style="text-align:center">${esc(r.hero.name)}</h3><div style="text-align:center" class="small">${r.hero.rarity} · ${r.hero.role}${r.dup ? ' · tekrar (yıldız +1)' : ''}</div><br><button class="btn big" onclick="closeModal()">Harika!</button>`); }; };

const TILE = 52; // harita karesi (px, zoom 1)
const mv = { z: 1, x: 0, y: 0, init: false, busy: false, pending: false };
function map() {
  if (!W) return '<div class="card">Harita yükleniyor…</div>';
  const pct = v => (v / W.mapSize * 100) + '%', ctr = v => ((v + .5) / W.mapSize * 100);
  let h = `<div class="maphead"><h2>Kıyamet Haritası</h2><span class="small">İki parmakla yakınlaştır · sürükle</span></div><div class="mapview" id="mapview"><div class="mapinner" id="mapinner" style="width:${W.mapSize * TILE}px;height:${W.mapSize * TILE}px;transform:translate(${mv.x}px,${mv.y}px) scale(${mv.z})"><div class="mapgrid" style="background-size:${TILE}px ${TILE}px"></div><svg class="marches" viewBox="0 0 100 100" preserveAspectRatio="none">`;
  for (const m of W.marches) {
    const mine = m.ownerId === S.id, col = mine ? '#f0b347' : '#e74c3c';
    const [a, b, s, e] = m.phase === 'go' ? [m.from, m.to, m.startAt, m.arriveAt] : [m.to, m.from, m.arriveAt, m.returnAt];
    h += `<line x1="${ctr(a.x)}" y1="${ctr(a.y)}" x2="${ctr(b.x)}" y2="${ctr(b.y)}" stroke="${col}" stroke-width=".35" stroke-dasharray="1.2 .8" opacity=".85"/><circle r=".9" fill="${col}" data-mv="${[ctr(a.x), ctr(a.y), ctr(b.x), ctr(b.y), s, e].join(',')}"/>`;
  }
  h += '</svg>';
  for (const c of W.camps) h += `<div class="mobj ${selected && selected.type === 'camp' && selected.id === c.id ? 'sel' : ''}" style="left:${pct(c.x)};top:${pct(c.y)}" data-camp="${c.id}">${c.level >= 4 ? '👹' : '🧟'}<span class="tag">Sv.${c.level}</span></div>`;
  for (const p of W.players) { if (!p.pos) continue; const me = p.id === S.id; h += `<div class="mobj base ${me ? 'mine' : 'enemy'} ${selected && selected.type === 'player' && selected.id === p.id ? 'sel' : ''}" style="left:${pct(p.pos.x)};top:${pct(p.pos.y)}" data-pl="${p.id}">${me ? '🏰' : '🏯'}<span class="tag">${me ? '★ ' : ''}${esc(p.name)} · Sv.${p.hq}</span></div>`; }
  h += `</div><div class="mapctl"><button id="mz_in" aria-label="Yakınlaştır">＋</button><button id="mz_out" aria-label="Uzaklaştır">－</button><button id="mz_home" aria-label="Üssüme git">🏰</button><button id="mz_fit" aria-label="Tüm harita">🗺️</button></div></div>`;
  h += '<div class="legend"><span>🏰 Üssün (dokun: içeri gir)</span><span>🏯 Rakip</span><span>🧟 Zombi kampı</span><span>👹 Güçlü kamp</span><span style="color:#f0b347">— senin seferin</span><span style="color:#e74c3c">— rakip seferi</span></div>';
  h += '<div class="mapinfo" id="mapinfo">' + mapInfo() + '</div>';
  const mine = W.marches.filter(m => m.ownerId === S.id);
  if (mine.length) { h += '<h2>Seferlerim</h2>'; for (const m of mine) h += `<div class="card">${timerBlock(m.phase === 'go' ? m.startAt : m.arriveAt, m.phase === 'go' ? m.arriveAt : m.returnAt, (m.phase === 'go' ? '➡️ Hedefe: ' : '⬅️ Dönüş: ') + (m.target.type === 'camp' ? `Zombi Kampı Sv.${m.target.level}` : esc(m.target.name)))}</div>`; }
  return h;
}
function mapApply() { const i = $('#mapinner'); if (i) i.style.transform = `translate(${mv.x}px,${mv.y}px) scale(${mv.z})`; }
function mapClamp() {
  const v = $('#mapview'); if (!v || !W) return; const Vw = v.clientWidth, Vh = v.clientHeight, M = W.mapSize * TILE * mv.z, pad = 60;
  mv.x = M <= Vw ? (Vw - M) / 2 : Math.min(pad, Math.max(Vw - M - pad, mv.x));
  mv.y = M <= Vh ? (Vh - M) / 2 : Math.min(pad, Math.max(Vh - M - pad, mv.y));
}
function mapZoom(nz, px, py) { const v = $('#mapview'); if (!v) return; nz = Math.min(2.5, Math.max(0.3, nz)); if (px == null) { px = v.clientWidth / 2; py = v.clientHeight / 2; } mv.x = px - (px - mv.x) * nz / mv.z; mv.y = py - (py - mv.y) * nz / mv.z; mv.z = nz; mapClamp(); mapApply(); }
function mapCenter(pos, z) { const v = $('#mapview'); if (!v || !pos) return; if (z) mv.z = z; mv.x = v.clientWidth / 2 - (pos.x + .5) * TILE * mv.z; mv.y = v.clientHeight / 2 - (pos.y + .5) * TILE * mv.z; mapClamp(); mapApply(); }
function mapFit() { const v = $('#mapview'); if (!v) return; mv.z = Math.min(v.clientWidth, v.clientHeight) / (W.mapSize * TILE); mapClamp(); mapApply(); }
function mapGestures() {
  const v = $('#mapview'); if (!v) return; const pts = new Map(); let last = null, moved = 0, pinch = null;
  const end = () => { if (!pts.size) { mv.busy = false; if (mv.pending) { mv.pending = false; setTimeout(() => { if (tab === 'map' && !mv.busy) render(); }, 50); } } };
  v.addEventListener('pointerdown', e => { if (e.target.closest('.mapctl')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); mv.busy = true; if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; moved = 0; } else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: mv.z }; } });
  v.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const r = v.getBoundingClientRect();
    if (pts.size >= 2 && pinch) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); moved = 99; mapZoom(pinch.z * d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); }
    else if (pts.size === 1 && last) { const dx = e.clientX - last.x, dy = e.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy); last = { x: e.clientX, y: e.clientY }; if (moved > 6) { mv.x += dx; mv.y += dy; mapClamp(); mapApply(); } }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 1) { const [p] = [...pts.values()]; last = { ...p }; } end(); };
  v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up); v.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') up(e); });
  v.addEventListener('click', e => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); } }, true); // sürükleme dokunma sayılmasın
  v.addEventListener('wheel', e => { e.preventDefault(); const r = v.getBoundingClientRect(); mapZoom(mv.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  ['gesturestart', 'gesturechange'].forEach(t => v.addEventListener(t, e => e.preventDefault())); // iOS Safari sayfa zoom'unu engelle
  $('#mz_in').onclick = () => mapZoom(mv.z * 1.3); $('#mz_out').onclick = () => mapZoom(mv.z / 1.3);
  $('#mz_home').onclick = () => mapCenter(S.pos, Math.max(mv.z, 1)); $('#mz_fit').onclick = mapFit;
}
function mapInfo() {
  if (!selected) return '<div class="card small">Haritada bir zombi kampına veya rakip üsse dokunun.</div>';
  if (selected.type === 'camp') { const c = W.camps.find(x => x.id === selected.id); if (!c) { selected = null; return mapInfo(); }
    return `<div class="card"><div class="bhead"><div class="bicon">${c.level >= 4 ? '👹' : '🧟'}</div><div><div class="bname">Zombi Kampı · Sv.${c.level}</div><div class="small">Konum (${c.x},${c.y}) · ${unitList(c.units, C.ZOMBIES, ZICON)}</div><div class="small">Ganimet: ${resList(campLoot(c.level))}</div></div></div><button class="btn red big" style="margin-top:10px" id="atk">⚔️ Saldır</button></div>`; }
  const p = W.players.find(x => x.id === selected.id); if (!p) return '';
  if (p.id === S.id) return `<div class="card"><div class="bname">🏰 ${esc(p.name)} (sen)</div><div class="small">Güç ⚡${fmt(p.power)} · Karargah Sv.${p.hq} · Duvar Sv.${p.wall}</div><button class="btn big" style="margin-top:10px" id="enter">🚪 Üsse Gir</button></div>`;
  const sh = p.shieldUntil - sNow();
  return `<div class="card"><div class="bhead"><div class="bicon">🏯</div><div><div class="bname">${esc(p.name)} ${p.online ? '<span class="pill good">çevrimiçi</span>' : '<span class="pill">çevrimdışı</span>'}</div><div class="small">Güç ⚡${fmt(p.power)} · Karargah Sv.${p.hq} · Duvar Sv.${p.wall}</div>${sh > 0 ? `<div class="pill warn">🛡️ Kalkan: <span data-end="${p.shieldUntil}" data-start="0"></span></div>` : ''}</div></div><button class="btn red big" style="margin-top:10px" id="atk" ${sh > 0 ? 'disabled' : ''}>⚔️ Üsse Saldır</button><div class="small" style="margin-top:6px">Not: Saldırırsan kendi kalkanın kalkar.</div></div>`;
}
function campLoot(l) { const m = Math.round(400 * l * Math.pow(1.4, l - 1)); return { food: m, wood: m, metal: Math.round(m * .7) }; }
bind.map = () => {
  if (!W) return;
  if (!mv.init) { mv.init = true; mapCenter(S.pos || { x: 10, y: 10 }, 1); } else { mapClamp(); mapApply(); }
  mapGestures();
  document.querySelectorAll('[data-camp]').forEach(e => e.onclick = () => { selected = { type: 'camp', id: +e.dataset.camp }; render(); });
  document.querySelectorAll('[data-pl]').forEach(e => e.onclick = () => { if (e.dataset.pl === S.id) return openInterior(); selected = { type: 'player', id: e.dataset.pl }; render(); });
  const a = $('#atk'); if (a) a.onclick = marchModal; const en = $('#enter'); if (en) en.onclick = openInterior;
};
function openInterior() { tab = 'inside'; render(); $('#main').scrollTop = 0; }

// ---------- Üs İçi ----------
const BLAYOUT = [['hq'], ['farm', 'lumber', 'mine'], ['barracks', 'hospital'], ['wall']];
function inside() {
  const T = C.TROOPS;
  let h = `<div class="inhead"><button class="btn sm" id="backmap">← Haritaya dön</button><b>🏰 ${esc(S.name)} Üssü</b><span class="small">⚡${fmt(S.power)}</span></div>`;
  h += `<div class="introops">${C.TROOP_ORDER.map(t => `<div><span>${T[t].icon}</span><b>${fmt(S.troops[t])}</b><small>${T[t].name}</small></div>`).join('')}<div><span>🤕</span><b>${fmt(C.TROOP_ORDER.reduce((s, t) => s + S.wounded[t], 0))}</b><small>Yaralı</small></div><div><span>🦸</span><b>${S.heroes.length}</b><small>Kahraman</small></div></div>`;
  const st = [];
  if (S.train) st.push(timerBlock(S.train.startAt, S.train.endAt, `🪖 ${S.train.count} ${T[S.train.type].name} eğitimi`));
  if (S.heal) st.push(timerBlock(S.heal.startAt, S.heal.endAt, '🏥 Tedavi'));
  st.push(`<div class="row small"><span>🧟 Sıradaki dalga: <b data-end="${S.nextWaveAt}" data-start="${S.lastWaveAt}"></b></span><span>Korunan: ${fmt(S.protected)} · Depo: ${fmt(S.cap)}</span></div>`);
  h += `<div class="card">${st.join('')}</div>`;
  h += '<div class="yard">';
  for (const row of BLAYOUT) {
    h += `<div class="yrow n${row.length}">`;
    for (const k of row) {
      const B = C.BUILDINGS[k], n = S.next[k], L = S.b[k], busy = S.build && S.build.key === k;
      let lock = ''; if (n) { if (k !== 'hq' && n.level > S.b.hq + 1) lock = `KG Sv.${n.level - 1} gerekli`; if (k === 'hq' && S.b.wall < n.level - 1) lock = `Duvar Sv.${n.level - 1} gerekli`; }
      h += `<div class="ybld ${k} ${busy ? 'busy' : ''}"><div class="yicon">${B.icon}<span class="lvl">${L}</span></div><div class="yname">${B.name}</div>`;
      if (busy) h += timerBlock(S.build.startAt, S.build.endAt, `→ Sv.${S.build.level}`) + '<button class="btn sm" data-speedup="1">⚡ Hızlandır</button>';
      else if (!n) h += '<div class="pill good">Azami</div>';
      else h += `<div>${costHtml(n.cost)}<button class="btn sm" data-up="${k}" data-needres="1" ${lock || S.build ? 'data-locked="1" disabled' : ''}>${lock ? '🔒 ' + lock : `⬆ Sv.${n.level} · ${dur(n.time)}`}</button></div>`;
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  h += `<div class="adrow"><button class="btn sm" data-goto="army">🪖 Ordu / Eğitim</button><button class="btn sm" data-goto="heroes">🦸 Kahramanlar</button><button class="btn sm red" id="inwave">🧟 Dalgayla savaş</button></div>`;
  return h;
}
bind.inside = () => {
  $('#backmap').onclick = () => { tab = 'map'; render(); };
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => act('upgrade', { key: b.dataset.up }));
  document.querySelectorAll('[data-speedup]').forEach(b => b.onclick = () => act('speedup'));
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => document.querySelector(`nav [data-tab=${b.dataset.goto}]`).click());
  $('#inwave').onclick = () => act('wave');
};
setInterval(() => document.querySelectorAll('[data-mv]').forEach(c => { const [x1, y1, x2, y2, s, e] = c.dataset.mv.split(',').map(Number); const f = Math.min(1, Math.max(0, (sNow() - s) / (e - s))); c.setAttribute('cx', x1 + (x2 - x1) * f); c.setAttribute('cy', y1 + (y2 - y1) * f); }), 200);

function marchModal() {
  const T = C.TROOPS; const busy = new Set(W.marches.filter(m => m.ownerId === S.id && m.heroId).map(m => m.heroId));
  let h = `<h3>⚔️ Sefer Hazırla</h3><div class="small">Hedef: ${selected.type === 'camp' ? 'Zombi Kampı' : 'Rakip üs'}</div>`;
  for (const t of C.TROOP_ORDER) h += `<div style="margin-top:10px"><div class="row"><span>${T[t].icon} ${T[t].name}</span><b id="mv_${t}">${S.troops[t]}</b></div><input type="range" min="0" max="${S.troops[t]}" value="${S.troops[t]}" data-mt="${t}" ${S.troops[t] ? '' : 'disabled'}></div>`;
  h += `<div style="margin-top:10px">Kahraman</div><select id="mhero"><option value="">— Kahramansız —</option>${S.heroes.filter(x => !busy.has(x.id)).sort((a, b) => b.atk - a.atk).map(x => `<option value="${x.id}">${x.icon} ${x.name} Sv.${x.level} (⚔️+%${x.atk})</option>`).join('')}</select>`;
  h += `<div class="small" style="margin-top:8px" id="mpow"></div><div class="flex" style="margin-top:12px"><button class="btn" style="background:#333;color:#ddd;box-shadow:none;text-shadow:none" onclick="closeModal()">Vazgeç</button><button class="btn red" id="mgo">Yola Çık</button></div>`;
  modal(h);
  const upd = () => { let a = 0; document.querySelectorAll('[data-mt]').forEach(i => { $('#mv_' + i.dataset.mt).textContent = i.value; a += i.value * T[i.dataset.mt].atk; }); $('#mpow').textContent = `Toplam saldırı gücü: ⚔️ ${fmt(a)}`; };
  document.querySelectorAll('[data-mt]').forEach(i => i.oninput = upd); upd();
  $('#mgo').onclick = async () => { const units = {}; document.querySelectorAll('[data-mt]').forEach(i => units[i.dataset.mt] = +i.value); const r = await act('march', { target: { type: selected.type, id: selected.id }, units, heroId: $('#mhero').value || null }); if (r.ok) closeModal(); };
}
function modal(h) { $('#mbox').innerHTML = h; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

function reports() {
  if (!S.reports.length) return '<h2>Savaş Raporları</h2><div class="card small">Henüz rapor yok. Bir zombi kampına saldırın!</div>';
  let h = '<h2>Savaş Raporları</h2>';
  for (const r of S.reports) {
    const tm = new Date(r.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const ad = r.kind === 'wave' ? C.ZOMBIES : r.kind === 'camp' ? C.TROOPS : C.TROOPS; const dd = r.kind === 'camp' ? C.ZOMBIES : C.TROOPS; const ai = r.kind === 'wave' ? ZICON : null, di = r.kind === 'camp' ? ZICON : null;
    const icon = r.kind === 'pvp' ? '⚔️' : r.kind === 'wave' ? '🌊' : '🧟';
    h += `<div class="card rep ${r.win ? 'win' : 'lose'}" onclick="this.classList.toggle('open')"><div class="row"><span class="t">${icon} ${esc(r.title)}</span><span class="small">${tm}</span></div>`;
    if (r.text) h += `<div class="small">${esc(r.text)}</div>`;
    h += `<div class="small">Ganimet: ${resList(r.loot)}${r.lost && Object.values(r.lost).some(v => v) ? ' · Kayıp kaynak: ' + resList(r.lost) : ''} · ayrıntı için dokun</div><div class="det">`;
    if (r.att) {
      const aName = r.kind === 'wave' ? 'Zombiler' : r.kind === 'pvp' ? esc(r.attacker) : 'Senin ordun', dName = r.kind === 'camp' ? 'Zombi kampı' : r.kind === 'pvp' ? esc(r.defender) : 'Üssün';
      h += `<table><tr><th></th><th>Saldıran: ${aName}</th><th>Savunan: ${dName}</th></tr><tr><td>Birlikler</td><td>${unitList(r.att, ad, ai)}</td><td>${unitList(r.def, dd, di)}${r.wall ? `<br>🧱 Duvar Sv.${r.wall}` : ''}</td></tr><tr><td>Kayıp</td><td>${unitList(r.attLoss, ad, ai)}</td><td>${unitList(r.defLoss, dd, di)}</td></tr>`;
      if (r.hero || r.defHero) h += `<tr><td>Kahraman</td><td>${esc(r.hero || '—')}${r.heroUp ? ` (⬆ seviye +${r.heroUp})` : ''}</td><td>${esc(r.defHero || '—')}</td></tr>`;
      if (r.defWounded) h += `<tr><td>Hastaneye</td><td>—</td><td>${unitList(r.defWounded, C.TROOPS)}</td></tr>`;
      h += '</table><div class="small" style="margin-top:6px">Turlar: ' + (r.rounds || []).map(x => `T${x.r}: ${fmt(x.attDmg)}/${fmt(x.defDmg)}`).join(' · ') + '</div>';
    }
    h += '</div></div>';
  }
  return h;
}

function chatTab() { return `<div class="chatwrap"><div class="msgs" id="msgs">${chat.map(msgHtml).join('')}</div><div class="chatin"><input id="cin" placeholder="Mesaj yaz…" maxlength="300"><button class="btn" id="csend">Gönder</button></div></div>`; }
function msgHtml(m) { const tm = new Date(m.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); if (m.system) return `<div class="msg sys">📢 ${esc(m.text)} <span class="tm">${tm}</span></div>`; return `<div class="msg ${m.from === S.id ? 'me' : ''}"><div class="n">${esc(m.name)}<span class="tm">${tm}</span></div>${esc(m.text)}</div>`; }
function appendMsg(m) { const box = $('#msgs'); if (!box) return; box.insertAdjacentHTML('beforeend', msgHtml(m)); box.scrollTop = box.scrollHeight; }
bind.chat = () => { $('#main').style.display = 'flex'; $('#main').style.flexDirection = 'column'; const box = $('#msgs'); box.scrollTop = box.scrollHeight; const send = () => { const v = $('#cin').value.trim(); if (!v) return; act('chat', { text: v }); $('#cin').value = ''; }; $('#csend').onclick = send; $('#cin').onkeydown = e => { if (e.key === 'Enter') send(); }; };
const _render = render;

function rank() {
  if (!W) return '';
  const ps = [...W.players].sort((a, b) => b.power - a.power);
  let h = '<h2>Güç Sıralaması</h2><div class="card"><table><tr><th>#</th><th>Komutan</th><th>Güç</th><th>KG</th></tr>';
  ps.forEach((p, i) => h += `<tr><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td>${esc(p.name)} ${p.id === S.id ? '<span class="pill">sen</span>' : ''} ${p.online ? '🟢' : '⚫'}</td><td>⚡ ${fmt(p.power)}</td><td>${p.hq}</td></tr>`);
  h += '</table></div><h2>İstatistikler</h2><div class="card"><table><tr><th>Komutan</th><th>PvP G/M</th><th>Kamp</th><th>Dalga</th><th>Öldürme</th></tr>';
  for (const p of ps) h += `<tr><td>${esc(p.name)}</td><td>${p.stats.pvpWin}/${p.stats.pvpLoss}</td><td>${p.stats.campWin}</td><td>${p.stats.waveWin}</td><td>${fmt(p.stats.kills)}</td></tr>`;
  return h + '</table></div>';
}

// ---------- Yönetici paneli (yetki sunucuda kontrol edilir) ----------
let AD = null, adSel = null, adBusy = false, adTimer = 0;
function adm(op, data) { return new Promise(res => socket.emit('admin', { op, ...(data || {}) }, r => { r = r || {}; if (r.msg) toast(r.msg, !r.ok); if (r.ok && op !== 'list') adminRefresh(true); res(r); })); }
async function adminRefresh(force) { if (!S || !S.isAdmin || adBusy) return; if (!force && Date.now() - adTimer < 4000) return; adTimer = Date.now(); adBusy = true; const r = await adm('list'); adBusy = false; if (r.ok) { AD = r.data; const ae = document.activeElement; if (tab === 'admin' && !(force !== true && ae && $('#main').contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName))) { const keep = captureAdminInputs(); renderAdmin(); restoreAdminInputs(keep); } } }
function captureAdminInputs() { const o = {}; document.querySelectorAll('#main input[id^=ad_], #main textarea[id^=ad_]').forEach(i => o[i.id] = i.value); return o; }
function restoreAdminInputs(o) { for (const k in o) { const i = document.getElementById(k); if (i && i.type !== 'hidden') i.value = o[k]; } }
function adminTab() { if (!AD) { setTimeout(() => adminRefresh(true), 0); return '<h2>👑 Yönetim</h2><div class="card">Yükleniyor…</div>'; } return adminHtml(); }
function renderAdmin() { const m = $('#main'); m.innerHTML = adminHtml(); bind.admin(); headerTick(); }
function adminHtml() {
  if (!S.isAdmin) return '<div class="card">Yetkiniz yok.</div>';
  const ps = AD.players; if (!adSel || !ps.find(p => p.id === adSel)) adSel = (ps.find(p => !p.isAdmin) || ps[0] || {}).id;
  let h = '<h2>👑 Yönetici Paneli</h2>';
  h += `<div class="card"><div class="bname">⏩ Oyun hızı: x${AD.speed}</div><div class="small">İnşaat, eğitim, tedavi, sefer ve üretim bu hızla çalışır.</div><div class="adrow">${[1, 2, 5, 10, 20, 50].map(v => `<button class="btn sm ${v === AD.speed ? 'grn' : ''}" data-speed="${v}">x${v}</button>`).join('')}</div>
    <div class="adrow"><button class="btn sm" id="ad_fm">⚡ Benim işlerimi anında bitir</button><button class="btn sm" id="ad_fa">⚡ Herkesin işlerini bitir</button></div></div>`;
  h += '<h2>Oyuncular</h2>';
  for (const p of ps) {
    const sh = p.shieldUntil - sNow();
    h += `<div class="card adp ${p.id === adSel ? 'sel' : ''}" data-adsel="${p.id}"><div class="row"><b>${p.isAdmin ? '👑 ' : ''}${esc(p.name)} ${p.online ? '🟢' : '⚫'}</b><span class="small">⚡${fmt(p.power)} · KG ${p.b.hq}</span></div>
      <div class="small">${RICON.food} ${fmt(p.res.food)} · ${RICON.wood} ${fmt(p.res.wood)} · ${RICON.metal} ${fmt(p.res.metal)} (depo ${fmt(p.cap)})</div>
      <div class="small">🪖 ${p.troops.inf} · 🎯 ${p.troops.sniper} · 🚙 ${p.troops.tank} · yaralı ${p.wounded.inf + p.wounded.sniper + p.wounded.tank} · konum (${p.pos ? p.pos.x + ',' + p.pos.y : '-'}) · ${sh > 0 ? '🛡️ ' + dur(sh / 1000) : 'kalkan yok'}</div>
      <div class="small">Binalar: ${C.BUILD_ORDER.map(k => C.BUILDINGS[k].icon + p.b[k]).join(' ')}${p.build ? ` · 🔨 ${C.BUILDINGS[p.build.key].name}→${p.build.level}` : ''}${p.train ? ` · 🪖 ${p.train.count} eğitimde` : ''}</div></div>`;
  }
  const t = ps.find(p => p.id === adSel);
  if (t) {
    h += `<h2>İşlem: ${esc(t.name)}</h2>`;
    h += `<div class="card"><div class="bname">💰 Kaynak ver / al</div><div class="small">Eksi yazarsanız alır (ör. -500).</div><div class="adrow">${['food', 'wood', 'metal'].map(r => `<label>${RICON[r]}<input id="ad_r_${r}" type="number" inputmode="numeric" placeholder="0"></label>`).join('')}</div>
      <div class="adrow"><button class="btn sm grn" id="ad_res">Uygula</button>${[1000, 10000, 100000].map(v => `<button class="btn sm" data-resall="${v}">Hepsine +${fmt(v)}</button>`).join('')}</div>
      <div class="adrow"><span class="small">Üretimi ileri sar:</span>${[1, 8, 24].map(v => `<button class="btn sm" data-prod="${v}">+${v} saat</button>`).join('')}</div></div>`;
    h += `<div class="card"><div class="bname">🪖 Asker ver / al</div><div class="adrow">${C.TROOP_ORDER.map(k => `<label>${C.TROOPS[k].icon}<input id="ad_t_${k}" type="number" inputmode="numeric" placeholder="0"></label>`).join('')}</div><button class="btn sm grn" id="ad_tr">Uygula</button></div>`;
    h += `<div class="card"><div class="bname">⚡ Hızlandırma</div><div class="adrow"><button class="btn sm" data-fin="build">İnşaatı bitir</button><button class="btn sm" data-fin="train">Eğitimi bitir</button><button class="btn sm" data-fin="">Hepsini bitir</button></div></div>`;
    h += `<div class="card"><div class="bname">🏗️ Bina seviyesi</div><div class="adrow"><select id="ad_bk">${C.BUILD_ORDER.map(k => `<option value="${k}">${C.BUILDINGS[k].icon} ${C.BUILDINGS[k].name} (Sv.${t.b[k]})</option>`).join('')}</select><input id="ad_bl" type="number" min="1" max="${C.MAX_LEVEL}" placeholder="Sv" style="width:80px"></div><div class="adrow"><button class="btn sm grn" id="ad_lvl">Seviyeyi ayarla</button><button class="btn sm" id="ad_maxall">Tüm binalar Sv.${C.MAX_LEVEL}</button></div></div>`;
    h += `<div class="card"><div class="bname">🛡️ Kalkan · 🧭 Konum · 🧟 Dalga</div><div class="adrow">${[30, 240, 1440].map(m => `<button class="btn sm" data-sh="${m}">Kalkan ${m >= 60 ? m / 60 + ' sa' : m + ' dk'}</button>`).join('')}<button class="btn sm red" data-sh="0">Kalkanı kaldır</button></div>
      <div class="adrow"><input id="ad_x" type="number" placeholder="X (0-19)"><input id="ad_y" type="number" placeholder="Y (0-19)"><button class="btn sm" id="ad_tp">Işınla</button></div>
      <div class="adrow"><button class="btn sm red" id="ad_wave">🧟 Zombi dalgası gönder</button></div></div>`;
    h += `<div class="card"><div class="bname">⚠️ Tehlikeli</div><div class="adrow"><button class="btn sm red" id="ad_rp">Oyuncuyu sıfırla</button>${t.isAdmin ? '' : '<button class="btn sm red" id="ad_del">Oyuncuyu sil</button>'}</div></div>`;
  }
  h += `<h2>📢 Duyuru</h2><div class="card"><div class="adrow"><input id="ad_msg" maxlength="300" placeholder="Herkese sistem mesajı"><button class="btn sm" id="ad_bc">Gönder</button></div></div>`;
  h += `<h2>♻️ Oyunu sıfırla</h2><div class="card"><div class="small">Herkesin ilerlemesi baştan başlar. Kamplar, seferler ve sohbet temizlenir.</div><div class="adrow"><button class="btn sm red" id="ad_reset">Oyunu sıfırla</button><button class="btn sm red" id="ad_reset2">Sıfırla + oyuncuları sil</button></div></div>`;
  h += `<h2>📋 Yönetici kayıtları</h2><div class="card small">${AD.log.length ? AD.log.map(l => `<div>${new Date(l.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(l.text)}</div>`).join('') : 'Henüz kayıt yok.'}</div>`;
  return h;
}
bind.admin = () => {
  if (!AD) return; const pid = adSel; const num = id => +(($('#' + id) || {}).value || 0);
  document.querySelectorAll('[data-adsel]').forEach(e => e.onclick = () => { adSel = e.dataset.adsel; renderAdmin(); });
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => adm('speed', { value: +b.dataset.speed }));
  const on = (id, f) => { const e = $('#' + id); if (e) e.onclick = f; };
  on('ad_fm', () => adm('finishMine')); on('ad_fa', () => adm('finishAllPlayers'));
  on('ad_res', () => { const res = { food: num('ad_r_food'), wood: num('ad_r_wood'), metal: num('ad_r_metal') }; adm('res', { pid, res }).then(r => { if (r.ok) ['food', 'wood', 'metal'].forEach(k => { const i = $('#ad_r_' + k); if (i) i.value = ''; }); }); });
  document.querySelectorAll('[data-resall]').forEach(b => b.onclick = () => { const v = +b.dataset.resall; adm('res', { pid, res: { food: v, wood: v, metal: v } }); });
  document.querySelectorAll('[data-prod]').forEach(b => b.onclick = () => adm('produce', { pid, hours: +b.dataset.prod }));
  on('ad_tr', () => { const troops = {}; C.TROOP_ORDER.forEach(k => troops[k] = num('ad_t_' + k)); adm('troops', { pid, troops }).then(r => { if (r.ok) C.TROOP_ORDER.forEach(k => { const i = $('#ad_t_' + k); if (i) i.value = ''; }); }); });
  document.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => adm('finish', { pid, what: b.dataset.fin || null }));
  on('ad_lvl', () => adm('setLevel', { pid, key: $('#ad_bk').value, level: num('ad_bl') }));
  on('ad_maxall', async () => { if (!confirm('Tüm binalar azami seviyeye çıkarılsın mı?')) return; for (const k of C.BUILD_ORDER) await adm('setLevel', { pid, key: k, level: C.MAX_LEVEL }); });
  document.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => adm('shield', { pid, minutes: +b.dataset.sh }));
  on('ad_tp', () => adm('teleport', { pid, x: num('ad_x'), y: num('ad_y') }));
  on('ad_wave', () => adm('wave', { pid }));
  on('ad_rp', () => { if (confirm('Bu oyuncunun tüm ilerlemesi silinsin mi?')) adm('resetPlayer', { pid }); });
  on('ad_del', () => { if (confirm('Bu oyuncu tamamen silinsin mi? Geri alınamaz.')) adm('deletePlayer', { pid }); });
  on('ad_bc', () => { const v = $('#ad_msg').value.trim(); if (!v) return; adm('broadcast', { text: v }).then(r => { if (r.ok) $('#ad_msg').value = ''; }); });
  on('ad_reset', () => { if (prompt('Tüm oyun sıfırlanacak. Onaylamak için SIFIRLA yazın:') === 'SIFIRLA') adm('resetGame', { confirm: 'SIFIRLA' }); });
  on('ad_reset2', () => { if (prompt('Oyun sıfırlanacak VE diğer oyuncular silinecek. Onay için SIFIRLA yazın:') === 'SIFIRLA') adm('resetGame', { confirm: 'SIFIRLA', deletePlayers: true }); });
};

// main'in sohbet dışı görünümü
const origRender = render;
render = function () { const m = $('#main'); m.style.display = ''; m.style.flexDirection = ''; origRender(); };

if (token) connect(); else showLogin();
loadSlots();

/* extras.js: add <script src="/extras.js"></script> before </body> on members.html and index.html */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const ERLC_URL = 'https://www.roblox.com/games/2534724415'; // ER:LC on Roblox
  const fmtDur = s => s == null ? '–' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const hourLabel = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  const json = u => fetch(u).then(r => r.json());

  // ---------- Preferences ----------
  const KEY = 'xprefs';
  const prefs = { theme: 'system', size: 'normal', contrast: false, motion: true, soundCalls: false, soundEvents: false };
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if (saved) Object.assign(prefs, saved); else { try { const t = localStorage.getItem('theme'); if (t) prefs.theme = t; } catch {} }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };
  function applyPrefs() {
    const r = document.documentElement;
    if (prefs.theme === 'system') delete r.dataset.theme; else r.dataset.theme = prefs.theme;
    r.dataset.size = prefs.size; r.dataset.contrast = prefs.contrast ? 'high' : ''; r.dataset.motion = prefs.motion ? '' : 'off';
  }

  // ---------- Styles ----------
  const css = `
  @view-transition { navigation: auto; }
  ::view-transition-old(root) { animation: xout .22s ease both; } ::view-transition-new(root) { animation: xin .38s ease both; }
  @keyframes xout { to { opacity: 0; } } @keyframes xin { from { opacity: 0; } }
  body { animation: xpage .5s ease both; } body.xleave { opacity: 0; transition: opacity .22s ease; }
  @keyframes xpage { from { opacity: 0; transform: translateY(6px); } }

  :root[data-theme="texas"] { color-scheme: dark; --bg:#0c0f16; --card:#151a24; --text:#f2f3f5; --muted:#a3abb9; --line:#262d3b; --accent:#e0354f; --accent-soft:rgba(224,53,79,.18); --good:#34d17a; --warn:#f0a23b; --bad:#ff7b7b; }
  :root[data-theme="midnight"] { color-scheme: dark; --bg:#070b1a; --card:#0f1630; --text:#e6ebff; --muted:#93a0cf; --line:#1f2a55; --accent:#6c8cff; --accent-soft:rgba(108,140,255,.2); --good:#34d17a; --warn:#f0a23b; --bad:#f26b6b; }
  :root[data-theme="emerald"] { color-scheme: light; --bg:#f2f7f4; --card:#ffffff; --text:#10201a; --muted:#55675e; --line:#d9e6de; --accent:#0f9d6b; --accent-soft:rgba(15,157,107,.14); --good:#0f9d6b; --warn:#d97706; --bad:#dc2626; }
  :root[data-size="large"] body { zoom: 1.12; } :root[data-size="xlarge"] body { zoom: 1.25; }
  :root[data-motion="off"] *, :root[data-motion="off"] *::before, :root[data-motion="off"] *::after { animation-duration: .01ms !important; animation-delay: 0s !important; transition-duration: .01ms !important; }
  :root[data-contrast="high"] { --muted: var(--text); --line: color-mix(in srgb, var(--text) 60%, transparent); --accent-soft: color-mix(in srgb, var(--accent) 28%, transparent); }
  :root[data-contrast="high"] .card { border-width: 2px; } :root[data-contrast="high"] a { text-decoration: underline; }
  :root[data-contrast="high"] button, :root[data-contrast="high"] input, :root[data-contrast="high"] select { border-width: 2px; }

  .xin { animation: xrise .6s cubic-bezier(.22,1,.36,1) both; } @keyframes xrise { from { opacity: 0; transform: translateY(14px); } }
  #xGear { font-size: 16px; line-height: 1; }
  #xSettings { position: fixed; top: 56px; right: 12px; width: 270px; max-width: calc(100vw - 24px); z-index: 30; box-shadow: 0 18px 40px -16px rgba(0,0,0,.5); }
  #xSettings label { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 8px 0; font-size: 14px; }
  #xSettings[hidden] { display: none; }
  #xStatus { display: grid; gap: 8px; } #xStatus .line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .xcode { font: 600 15px ui-monospace, Menlo, Consolas, monospace; padding: 3px 10px; border: 1px dashed var(--accent); border-radius: 8px; user-select: all; }
  .xup { display: flex; gap: 2px; height: 38px; } .xup i { flex: 1; border-radius: 2px; background: var(--line); transition: transform .2s; } .xup i:hover { transform: scaleY(1.15); }
  .xbig { font-size: 28px; font-weight: 650; }
  .xdays { display: flex; align-items: flex-end; gap: 6px; height: 70px; margin-top: 8px; } .xdays div { flex: 1; text-align: center; font-size: 11px; color: var(--muted); }
  .xdays b { display: block; background: var(--accent); border-radius: 4px 4px 0 0; min-height: 3px; transition: height .6s cubic-bezier(.22,1,.36,1); }
  #xMap { width: 100%; height: auto; display: block; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; }
  #xMap .p { transition: transform 1s linear; } #xMap .ring { fill: none; stroke-width: 2; transform-box: fill-box; transform-origin: center; animation: xring 1.6s ease-out infinite; }
  @keyframes xring { from { transform: scale(.5); opacity: 1; } to { transform: scale(2.6); opacity: 0; } }
  .xleg { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-top: 6px; } .xleg span::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--c); margin-right: 5px; }
  #xToast { position: fixed; bottom: 18px; left: 50%; transform: translate(-50%, 20px); opacity: 0; z-index: 40; pointer-events: none; transition: all .35s cubic-bezier(.22,1,.36,1); padding: 10px 16px; border-radius: 10px; background: var(--accent); color: #fff; font-size: 14px; }
  #xToast.on { opacity: 1; transform: translate(-50%, 0); }`;
  const style = el('style'); style.textContent = css; document.head.append(style);
  applyPrefs();

  // ---------- Chime + toast ----------
  let ac;
  function chime(kind) {
    try {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      let t = ac.currentTime;
      (kind === 'event' ? [660, 880] : [880, 660, 880]).forEach(f => {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.15, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .22);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .25); t += .2;
      });
    } catch {}
  }
  const toastEl = el('div'); toastEl.id = 'xToast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl);
  let toastT; const toast = m => { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 5000); };

  // ---------- Settings panel ----------
  const oldBtn = $('themeBtn'), gear = el('button', '⚙'); gear.id = 'xGear'; gear.title = gear.ariaLabel = 'Display and sound settings';
  if (oldBtn) { oldBtn.hidden = true; oldBtn.parentElement.insertBefore(gear, oldBtn); } else (document.querySelector('header .row') || document.body).append(gear);
  const panel = el('div', undefined, 'card'); panel.id = 'xSettings'; panel.hidden = true;
  const opt = (v, t) => { const o = el('option', t); o.value = v; return o; };
  const sel = (key, items) => { const s = el('select'); items.forEach(([v, t]) => s.append(opt(v, t))); s.value = prefs[key]; s.onchange = () => { prefs[key] = s.value; save(); applyPrefs(); }; return s; };
  const chk = (key, cb) => { const c = el('input'); c.type = 'checkbox'; c.checked = prefs[key]; c.onchange = () => { prefs[key] = c.checked; save(); applyPrefs(); if (cb) cb(c.checked); }; return c; };
  const row = (label, ctl) => { const l = el('label'); l.append(el('span', label), ctl); return l; };
  panel.append(el('h2', 'Settings'),
    row('Theme', sel('theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark'], ['texas', 'Texas red'], ['midnight', 'Midnight'], ['emerald', 'Emerald']])),
    row('Text size', sel('size', [['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']])),
    row('High contrast', chk('contrast')), row('Animations', chk('motion')),
    row('Chime on new 911 call', chk('soundCalls', on => on && chime('call'))),
    row('Chime when my event starts', chk('soundEvents', on => on && chime('event'))));
  document.body.append(panel);
  gear.onclick = e => { e.stopPropagation(); panel.hidden = !panel.hidden; };
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') panel.hidden = true; });

  // ---------- Cards ----------
  const anchor = $('heatCard'), host = anchor ? anchor.parentElement : document.querySelector('.wrap') || document.body;
  const put = (node, before) => host.insertBefore(node, before || null);
  const card = (id, title, extra = '') => { const c = el('div', undefined, 'card section xin'); c.id = id; c.innerHTML = `<h2>${title} <small id="${id}N"></small></h2>${extra}`; return c; };

  const status = el('div', undefined, 'card section xin'); status.id = 'xStatus';
  status.innerHTML = '<div class="line" id="xJoin"></div><div class="line muted" id="xQueue"></div><div class="line muted" id="xPredict"></div>';
  const overview = $('overview'); if (overview) overview.after(status); else put(status, anchor);

  const mapCard = card('xMapCard', 'Live map', '<svg id="xMap" viewBox="0 0 600 380" role="img" aria-label="Map of players and active calls"></svg><div class="xleg"><span style="--c:#3b82f6">Police</span><span style="--c:#ef4444">Fire</span><span style="--c:#22c55e">EMS</span><span style="--c:#f59e0b">DOT</span><span style="--c:#94a3b8">Civilian / other</span><span style="--c:#fff;--b:1">Pulsing ring = active 911 call</span></div>');
  const twoRow = el('div', undefined, 'two');
  const upCard = card('xUp', 'Server uptime <small>last 24h</small>', '<div class="xbig" id="xUpPct">–</div><div class="xup" id="xUpBar"></div><div class="muted" id="xUpNote" style="margin-top:6px;font-size:13px"></div>');
  const rtCard = card('xRt', '911 response time', '<div class="xbig" id="xRtAvg">–</div><div class="muted" id="xRtNote" style="font-size:13px"></div><div class="xdays" id="xRtDays"></div>');
  twoRow.append(upCard, rtCard);
  put(mapCard, anchor); put(twoRow, anchor);
  for (const c of [upCard, rtCard]) { c.classList.remove('section'); }

  // ---------- Join + queue + prediction ----------
  let hist = [], grid = null, gridMax = 0;
  function updateJoin(d) {
    const box = $('xJoin'); box.textContent = '';
    const full = d.max && d.current >= d.max;
    if (full) { box.append(el('strong', 'Server is full'), el('span', 'Join the queue in-game', 'muted')); return; }
    const a = el('a', 'Join now', 'btn'); a.href = ERLC_URL; a.target = '_blank'; a.rel = 'noopener'; box.append(a);
    if (d.joinKey) {
      const code = el('span', d.joinKey, 'xcode'), cp = el('button', 'Copy code');
      cp.onclick = async () => { try { await navigator.clipboard.writeText(d.joinKey); cp.textContent = 'Copied!'; setTimeout(() => cp.textContent = 'Copy code', 1500); } catch { cp.textContent = 'Select + copy'; } };
      box.append(code, cp, el('span', 'Enter this in ER:LC → Join by code', 'muted'));
    } else box.append(el('span', `${d.max ? d.max - d.current : 'Open'} slots open`, 'muted'));
  }
  function updateQueue(d) {
    const q = d.queue, box = $('xQueue'); box.hidden = !q;
    if (!q) return;
    const full = d.max && d.current >= d.max;
    if (!full) { box.textContent = `${q} in queue. It’s moving, so you should get in within a minute or two.`; return; }
    const pts = hist.slice(-30); let leaves = 0;
    for (let i = 1; i < pts.length; i++) leaves += Math.max(0, pts[i - 1].players - pts[i].players);
    const rate = Math.max(leaves / Math.max(pts.length - 1, 1), .25); // players leaving per minute, floored so we never divide by ~0
    const mins = Math.max(1, Math.round(q / rate));
    box.textContent = `${q} in queue. Estimated wait: about ${mins >= 60 ? Math.round(mins / 60) + 'h+' : mins + ' min'}.`;
  }
  function updatePredict() {
    const box = $('xPredict'); box.hidden = true;
    if (!grid) return;
    const now = new Date(), flat = (dow, h) => grid[(dow + Math.floor(h / 24)) % 7][h % 24];
    const here = flat(now.getDay(), now.getHours()), busy = gridMax * .8;
    if (gridMax < 1) return;
    box.hidden = false;
    if (here >= busy) { box.textContent = 'It’s one of the busiest times right now.'; return; }
    for (let k = 1; k <= 12; k++) {
      const v = flat(now.getDay(), now.getHours() + k);
      if (v >= busy && v > here * 1.15) { box.textContent = `Usually busy in about ${k} hour${k > 1 ? 's' : ''} (around ${hourLabel((now.getHours() + k) % 24)}).`; return; }
    }
    box.textContent = 'Usually quiet for the next 12 hours.';
  }
  async function loadGrid() {
    try {
      const d = await json('/api/heatmap'); if (!d.samples || d.samples < 120) return;
      grid = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const [k, v] of Object.entries(d.cells)) { const [dow, hr] = k.split('-').map(Number); const t = new Date(Date.UTC(2024, 0, 7 + dow, hr)); grid[t.getDay()][t.getHours()] = v; }
      gridMax = Math.max(...grid.flat(), 0); updatePredict();
    } catch {}
  }
  async function loadHist() { try { hist = await json('/api/history'); } catch {} }

  // ---------- Live map ----------
  const NS = 'http://www.w3.org/2000/svg', MW = 600, MH = 380, PAD = 22, nodes = new Map();
  const bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  const teamColor = t => /police|sheriff|trooper/i.test(t) ? '#3b82f6' : /fire/i.test(t) ? '#ef4444' : /ems|medic/i.test(t) ? '#22c55e' : /dot|transport/i.test(t) ? '#f59e0b' : '#94a3b8';
  function drawMap(d) {
    const svg = $('xMap'), ps = d.players.filter(p => p.x != null && p.z != null), cs = (d.calls || []).filter(c => c.pos && c.pos.length >= 2);
    $('xMapCardN').textContent = ps.length ? `${ps.length} on map` : '';
    if (!ps.length && !cs.length) { if (!nodes.size) { svg.textContent = ''; const t = document.createElementNS(NS, 'text'); t.setAttribute('x', 300); t.setAttribute('y', 190); t.setAttribute('text-anchor', 'middle'); t.setAttribute('fill', 'currentColor'); t.setAttribute('opacity', .6); t.textContent = 'No location data right now.'; svg.append(t); } return; }
    if (svg.querySelector('text')) { svg.textContent = ''; nodes.clear(); }
    for (const [x, z] of [...ps.map(p => [p.x, p.z]), ...cs.map(c => c.pos)]) { bounds.x0 = Math.min(bounds.x0, x); bounds.x1 = Math.max(bounds.x1, x); bounds.z0 = Math.min(bounds.z0, z); bounds.z1 = Math.max(bounds.z1, z); }
    const sx = (bounds.x1 - bounds.x0) || 1, sz = (bounds.z1 - bounds.z0) || 1, k = Math.min((MW - PAD * 2) / sx, (MH - PAD * 2) / sz);
    const ox = (MW - sx * k) / 2, oy = (MH - sz * k) / 2;
    const X = x => ox + (x - bounds.x0) * k, Y = z => MH - oy - (z - bounds.z0) * k; // north is up
    const want = new Set();
    const place = (id, x, z, make) => {
      want.add(id); let g = nodes.get(id);
      if (!g) { g = document.createElementNS(NS, 'g'); g.classList.add('p'); make(g); svg.append(g); nodes.set(id, g); }
      g.style.transform = `translate(${X(x).toFixed(1)}px, ${Y(z).toFixed(1)}px)`; return g;
    };
    for (const p of ps) place('p' + (p.id || p.name), p.x, p.z, g => {
      const c = document.createElementNS(NS, 'circle'), t = document.createElementNS(NS, 'title');
      c.setAttribute('r', 5); c.setAttribute('fill', teamColor(p.team)); c.setAttribute('stroke', 'var(--card)'); c.setAttribute('stroke-width', 1.5);
      t.textContent = `${p.name} · ${p.team}`; g.append(c, t);
    });
    for (const c of cs) place('c' + c.number, c.pos[0], c.pos[1], g => {
      const r = document.createElementNS(NS, 'circle'), t = document.createElementNS(NS, 'title');
      r.setAttribute('r', 9); r.setAttribute('class', 'ring'); r.setAttribute('stroke', teamColor(c.team)); t.textContent = `911 #${c.number} · ${c.team}`; g.append(r, t);
    });
    for (const [id, g] of nodes) if (!want.has(id)) { g.remove(); nodes.delete(id); }
  }

  // ---------- Uptime + response times ----------
  async function loadUptime() {
    try {
      const d = await json('/api/uptime'), bar = $('xUpBar'); bar.textContent = '';
      let lastBad = null;
      for (const b of d.buckets) {
        const i = el('i'); i.style.background = b.pct == null ? 'var(--line)' : b.pct >= 95 ? 'var(--good)' : b.pct >= 50 ? 'var(--warn)' : 'var(--bad)';
        i.title = `${new Date(b.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${b.pct == null ? 'no data' : b.pct + '% up'}`;
        if (b.pct != null && b.pct < 95) lastBad = b.t; bar.append(i);
      }
      $('xUpPct').textContent = d.uptime == null ? '–' : d.uptime + '%';
      $('xUpNote').textContent = d.uptime == null ? 'Collecting data…' : lastBad ? `Last problem around ${new Date(lastBad).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Grey means the dashboard itself was offline.` : 'No problems in the last 24 hours.';
    } catch {}
  }
  async function loadCalls() {
    try {
      const { days } = await json('/api/callstats'), box = $('xRtDays'); box.textContent = '';
      const today = days[days.length - 1], prev = days.slice(0, -1).filter(x => x.avg != null), max = Math.max(...days.map(x => x.avg || 0), 1);
      $('xRtAvg').textContent = fmtDur(today.avg);
      const pAvg = prev.length ? prev.reduce((a, x) => a + x.avg * x.n, 0) / Math.max(prev.reduce((a, x) => a + x.n, 0), 1) : null;
      $('xRtNote').textContent = today.avg == null ? 'No answered calls yet today.' : pAvg ? `${today.n} calls today · ${today.avg <= pAvg ? Math.round((1 - today.avg / pAvg) * 100) + '% faster' : Math.round((today.avg / pAvg - 1) * 100) + '% slower'} than the previous days` : `${today.n} calls today`;
      for (const x of days) {
        const col = el('div'), b = el('b'); b.style.height = '3px'; b.title = `${x.date}: ${x.avg == null ? 'no data' : fmtDur(x.avg) + ' (' + x.n + ' calls)'}`;
        col.append(b, document.createTextNode(new Date(x.date + 'T00:00:00Z').toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' }))); box.append(col);
        requestAnimationFrame(() => requestAnimationFrame(() => { b.style.height = x.avg == null ? '3px' : Math.max(3, x.avg / max * 52) + 'px'; }));
      }
    } catch {}
  }

  // ---------- Hook into the page's stats refresh ----------
  let seenCalls = null;
  function onStats(d) {
    updateJoin(d); updateQueue(d); updatePredict(); drawMap(d);
    const ids = new Set((d.calls || []).map(c => c.number + ':' + c.startedAt));
    if (seenCalls && prefs.soundCalls && [...ids].some(k => !seenCalls.has(k))) { chime('call'); toast('New 911 call'); }
    seenCalls = ids;
  }
  if (typeof render === 'function') { const orig = render; window.render = function (d) { orig(d); try { onStats(d); } catch (e) { console.error(e); } }; }
  try { if (typeof data !== 'undefined' && data) onStats(data); } catch {}

  // Event start chime (only for events you RSVP'd to)
  let evs = [], chimed = new Set();
  const loadEvs = async () => { try { evs = await json('/api/events'); } catch {} };
  setInterval(() => {
    for (const e of evs) if (e.rsvped && !chimed.has(e.id) && e.startsAt - Date.now() <= 60_000 && e.startsAt - Date.now() > -300_000) {
      chimed.add(e.id); if (prefs.soundEvents) chime('event'); toast(`${e.title} is starting`);
    }
  }, 20_000);

  // Fade out before logging in/out
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="/auth/"], a[href="/login"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault(); document.body.classList.add('xleave'); setTimeout(() => { location.href = a.href; }, 200);
  });

  loadHist(); loadGrid(); loadUptime(); loadCalls(); loadEvs();
  setInterval(loadHist, 60_000); setInterval(updatePredict, 60_000); setInterval(loadGrid, 300_000);
  setInterval(loadUptime, 60_000); setInterval(loadCalls, 60_000); setInterval(loadEvs, 60_000);
})();
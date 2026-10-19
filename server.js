require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const fs = require('fs');

const {
  ERLC_SERVER_KEY, STAFF_KEY, MELONLY_API_TOKEN, SHOW_JOIN_CODE, ALLOW_ANNOUNCE,
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN, VERIFIED_ROLE_ID,
  DISCORD_WEBHOOK_URL, QUEUE_ALERT, STAFF_ROLE_IDS = '', MEMBER_ROLE_IDS = '',
  ADMIN_ROLE_IDS = '', ALLOW_ADMIN_COMMANDS, DB_PATH = '../verify.db', PORT = 3000,
} = process.env;
const STAFF_ROLES = STAFF_ROLE_IDS.split(',').map(x => x.trim()).filter(Boolean);
// Admin role(s): full access to the admin panel (admins also count as staff and members).
const ADMIN_ROLES = ADMIN_ROLE_IDS.split(',').map(x => x.trim()).filter(Boolean);
const adminCommandsEnabled = String(ALLOW_ADMIN_COMMANDS).toLowerCase() === 'true';
// Live map. Optional: put your map picture at public/map.png and set MAP_BOUNDS="minX,minZ,maxX,maxZ"
// (the in-game coordinates of the picture's top-left and bottom-right edges). Without them the map
// draws a plain grid that fits itself to where players are. MAP_FLIP_Y=true flips the north/south direction.
const MAP_BOUNDS = (() => {
  const n = String(process.env.MAP_BOUNDS || '').split(',').map(Number);
  return n.length === 4 && n.every(Number.isFinite) && n[2] > n[0] && n[3] > n[1]
    ? { minX: n[0], minZ: n[1], maxX: n[2], maxZ: n[3] } : null;
})();
const MAP_FLIP_Y = String(process.env.MAP_FLIP_Y).toLowerCase() === 'true';
// Members role(s): people with one of these (or any staff role) can see the members page.
// Leave MEMBER_ROLE_IDS empty and every person in your Discord server counts as a member.
const MEMBER_ROLES = MEMBER_ROLE_IDS.split(',').map(x => x.trim()).filter(Boolean);
// Render sets RENDER_EXTERNAL_URL automatically; set BASE_URL yourself for a custom domain.
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const loadJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; } };
const saveJson = (file, obj) => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, file);
    fs.writeFileSync(p + '.tmp', JSON.stringify(obj));
    fs.renameSync(p + '.tmp', p);
  } catch (e) { console.error(`Could not save ${file}:`, e.message); }
};
const authEnabled = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
const verifyEnabled = Boolean(authEnabled && DISCORD_BOT_TOKEN && VERIFIED_ROLE_ID && DISCORD_GUILD_ID);
const announceEnabled = String(ALLOW_ANNOUNCE).toLowerCase() === 'true';
const BASE = 'https://api.erlc.gg/v2'; // ER:LC API v2: https://apidocs.erlc.gg

// Read-only access to the verification bot's database (optional)
// better-sqlite3 is an optional dependency: if it isn't installed (or the DB is missing),
// the dashboard still works and simply hides the verified count.
let db = null;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.resolve(DB_PATH), { readonly: true, fileMustExist: true });
} catch {
  console.warn('Verification DB unavailable; verified count will be hidden.');
}

// ---------- ERLC client with cache + request sharing ----------
// The key stays on the server. Caching keeps you under ERLC rate limits
// no matter how many people have the dashboard open.
const cache = new Map();
// v2 has one endpoint: GET /v2/server, with sections switched on by query flags
// (Players, Queue, JoinLogs, KillLogs, CommandLogs, ModCalls, EmergencyCalls, Vehicles).
async function erlc(flags = [], ttl = 10_000) {
  const key = [...flags].sort().join(',');
  const entry = cache.get(key) || {};
  if (entry.data && Date.now() - entry.at < ttl) return entry.data;
  if (entry.pending) return entry.pending;

  const qs = flags.map(f => `${f}=true`).join('&');
  const url = `${BASE}/server${qs ? '?' + qs : ''}`;
  const pending = fetch(url, { headers: { 'server-key': ERLC_SERVER_KEY } })
    .then(async r => {
      if (!r.ok) throw new Error(`ERLC ${r.status}`);
      return r.json();
    })
    .then(data => { cache.set(key, { data, at: Date.now() }); return data; })
    .catch(err => {
      if (entry.data) { cache.set(key, { data: entry.data, at: entry.at }); return entry.data; } // serve stale
      cache.delete(key);
      throw err;
    });
  cache.set(key, { ...entry, pending });
  return pending;
}

// ---------- Melonly client (read-only GETs, cached) ----------
// Docs: https://apidocs.melonly.xyz  |  Base URL and Bearer auth confirmed there.
const MELONLY_BASE = 'https://api.melonly.xyz/api/v1';
const mCache = new Map();
async function melonly(endpoint, ttl = 30_000) {
  if (!MELONLY_API_TOKEN) throw new Error('MELONLY_API_TOKEN not set');
  const hit = mCache.get(endpoint);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  try {
    const r = await fetch(MELONLY_BASE + endpoint, {
      headers: { Authorization: `Bearer ${MELONLY_API_TOKEN}` },
    });
    if (!r.ok) throw new Error(`Melonly ${r.status}`);
    const data = await r.json();
    mCache.set(endpoint, { data, at: Date.now() });
    return data;
  } catch (err) {
    if (hit) return hit.data; // serve stale
    throw err;
  }
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.use(express.json({ limit: '10kb' }));

// Render pings this to know the service is up
app.get('/healthz', (req, res) => res.json({
  ok: true,
  pageFound: Boolean(pageDir),
  erlcKeySet: Boolean(ERLC_SERVER_KEY),
  staffKeySet: Boolean(STAFF_KEY),
  melonlyTokenSet: Boolean(MELONLY_API_TOKEN),
  discordLoginSet: authEnabled,
  staffRolesSet: STAFF_ROLES.length > 0,
  adminRolesSet: ADMIN_ROLES.length > 0,
  memberRolesSet: MEMBER_ROLES.length > 0,
  webVerifyEnabled: verifyEnabled,
  loginRequired,
  webhookAlerts: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(DISCORD_WEBHOOK_URL || ''),
  discordProxyOn: Boolean(process.env.DISCORD_PROXY_URL),
  baseUrl: BASE_URL,
}));
// ---------- Who can see what ----------
// Public: landing, rules, departments, privacy, sign-in. Members (signed in with Discord): apply, link Roblox,
// profile, settings, events. Staff only: live dashboard, map, MDT and all server data. Admins: setup tools.
// Set REQUIRE_LOGIN=false to turn all of this off.
const loginRequired = authEnabled && String(process.env.REQUIRE_LOGIN ?? 'true').toLowerCase() !== 'false';
const PUBLIC_PATHS = new Set(['/', '/login', '/rules', '/departments', '/privacy', '/healthz', '/api/me', '/site.css', '/site.js',
  '/api/public/info', '/api/public/rules', '/api/public/departments']);
const STAFF_ONLY = /^\/(dashboard|mdt|index\.html)$|^\/api\/(stats|history|heatmap|mapheat|mdt|melonly|activity)$/;
const pageFile = name => { // find a page by name, ignoring capitals and stray spaces in the uploaded file name
  for (const dir of [path.join(__dirname, 'public'), __dirname]) {
    try { const hit = fs.readdirSync(dir).find(f => f.trim().toLowerCase() === name); if (hit) return path.join(dir, hit); } catch {}
  }
  return null;
};
app.use((req, res, next) => {
  if (!loginRequired) return next();
  const p = req.path, api = p.startsWith('/api/');
  if (PUBLIC_PATHS.has(p) || p.startsWith('/auth/')) return next();
  const s = getSession(req);
  if (!s) return api ? res.status(401).json({ error: 'Sign in with Discord first.', login: true }) : res.redirect('/?signin=1');
  if (!s.member) return api ? res.status(403).json({ error: 'You need the Members role.' }) : res.redirect(s.inGuild ? '/login?error=norole' : '/login?error=notmember');
  if (STAFF_ONLY.test(p) && !s.staff) return api ? res.status(403).json({ error: 'Staff only.' }) : res.redirect('/');
  next();
});

// Serve the page from ./public (or from next to server.js if the folder was flattened on upload)
const PAGE_DIRS = [path.join(__dirname, 'public'), __dirname];
const pageDir = PAGE_DIRS.find(d => fs.existsSync(path.join(d, 'index.html')));
// Friendly login page (also where signed-out visitors land)
app.get('/login', (req, res) => {
  const s = getSession(req);
  if (s && s.member) return res.redirect('/');
  const file = pageDir && path.join(pageDir, 'login.html');
  if (file && fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send('login.html is missing. Upload dashboard/public/login.html to your repo and redeploy.');
});
// ---------- Pages ----------
const PAGES = { '/': 'landing.html', '/rules': 'rules.html', '/departments': 'departments.html', '/privacy': 'privacy.html', '/link': 'link.html', '/dashboard': 'index.html' };
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (req, res) => {
    const f = pageFile(file);
    if (!f) return res.status(404).send(`${file} is missing. Upload it next to server.js and redeploy.`);
    res.set('Cache-Control', 'no-store'); res.sendFile(f);
  });
}
for (const asset of ['site.css', 'site.js']) {
  app.get('/' + asset, (req, res) => { const f = pageFile(asset); if (!f) return res.status(404).end(); res.set('Cache-Control', 'no-cache'); res.sendFile(f); });
}
app.get('/index.html', (req, res) => res.redirect('/dashboard'));
try {
  require(['./extras', './extra'].find(m => { try { return require.resolve(m); } catch { return false; } }) || './extras')(app, {
    erlc, loadJson, saveJson, dataDir: DATA_DIR, pageFile,
    getSession: req => getSession(req),
    requireStaff: (req, res, next) => requireStaff(req, res, next),
    audit: (...a) => audit(...a),
    notify: e => notify(e),
    activity: () => activity, links: () => links,
    minutesSince: (a, d) => minutesSince(a, d), mainTeam: a => mainTeam(a),
  });
} catch (e) { console.warn('extras.js not loaded:', e.message); }
if (pageDir) {
  if (pageDir === __dirname) {
    // Flat folder: only hand out these specific files, never server.js or the data folder
    const OPEN = new Set(['map.png', 'favicon.ico', 'logo.png']);
    app.get('/:file', (req, res, next) => OPEN.has(req.params.file) && fs.existsSync(path.join(pageDir, req.params.file))
      ? res.sendFile(path.join(pageDir, req.params.file)) : next());
  } else {
    app.use(express.static(pageDir, { index: false, dotfiles: 'ignore' }));
  }
} else {
  console.error('index.html not found. Expected dashboard/public/index.html in your repo.');
  app.get('/', (req, res) => res.status(500).send(
    'Server is running, but index.html is missing. Upload dashboard/public/index.html to your GitHub repo and redeploy.'
  ));
}

// One request pulls everything the public page needs.
const PUBLIC_FLAGS = ['Players', 'Queue', 'EmergencyCalls', 'Vehicles'];

app.get('/api/stats', async (req, res) => {
  try {
    const data = await erlc(PUBLIC_FLAGS);
    const players = data.Players || [];
    const queue = data.Queue || [];

    const teams = {};
    const staff = [];
    const list = players.map(p => {
      const [name, id] = String(p.Player).split(':');
      const team = p.Team || 'Unknown';
      teams[team] = (teams[team] || 0) + 1;
      if (p.Permission && p.Permission !== 'Normal') staff.push({ name, permission: p.Permission });
      const loc = p.Location || {};
      return {
        name, id, team,
        permission: p.Permission || 'Normal',
        callsign: p.Callsign || '',
        street: [loc.BuildingNumber, loc.StreetName].filter(Boolean).join(' '),
        postal: loc.PostalCode || '',
        wanted: p.WantedStars || 0,
        x: Number.isFinite(loc.LocationX) ? loc.LocationX : null,
        z: Number.isFinite(loc.LocationZ) ? loc.LocationZ : null,
      };
    });

    const calls = (data.EmergencyCalls || [])
      .map(c => ({
        team: c.Team, number: c.CallNumber, description: c.Description || '',
        where: c.PositionDescriptor || '', startedAt: c.StartedAt, responders: (c.Players || []).length,
      }))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

    const vehicles = (data.Vehicles || []).slice(0, 300).map(v => ({
      name: v.Name, owner: v.Owner, plate: v.Plate, texture: v.Texture || '',
      colorHex: v.ColorHex || '', colorName: v.ColorName || '',
    }));

    let verified = null;
    if (db) { try { verified = db.prepare('SELECT COUNT(*) AS n FROM links').get().n; } catch {} }
    if (verified === null && verifyEnabled) verified = Object.keys(links).length;

    res.set('Cache-Control', 'no-store');
    res.json({
      name: data.Name,
      current: data.CurrentPlayers ?? players.length,
      max: data.MaxPlayers ?? null,
      queue: Array.isArray(queue) ? queue.length : 0,
      teamBalance: data.TeamBalance ?? null,
      accVerifiedReq: data.AccVerifiedReq || null,
      joinKey: String(SHOW_JOIN_CODE).toLowerCase() === 'true' ? data.JoinKey : null,
      peaks: { today: meta.peakDay.date === dayKey() ? meta.peakDay.n : 0, allTime: meta.peakAll, allTimeAt: meta.peakAllAt },
      logo: /^https:\/\//.test(process.env.SERVER_LOGO_URL || '') ? process.env.SERVER_LOGO_URL : null,
      map: (() => {
        const cal = loadJson('mapcal.json', null); // saved by the /mapsetup page
        if (cal && cal.bounds) return { image: cal.hasImage ? cal.v : false, bounds: cal.bounds, flipY: false };
        return { image: Boolean(MAP_BOUNDS && pageDir && fs.existsSync(path.join(pageDir, 'map.png'))), bounds: MAP_BOUNDS, flipY: MAP_FLIP_Y };
      })(),
      teams, staff, players: list, calls, vehicles,
      vehicleCount: (data.Vehicles || []).length,
      verified,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: 'Could not reach the ERLC API.' });
  }
});

// ---------- Activity tracking (minutes in-game per player) ----------
// Every minute each online player earns one minute. Saved to data/activity.json.
// Like the history chart, this resets if your host wipes its disk on redeploy.
let activity = loadJson('activity.json', null) || { since: Date.now(), players: {} };
let activityTicks = 0;
let heat = loadJson('mapheat.json', {}); // "x,z" (50-stud cells) -> player-minutes, powers the map heat layer
function trackActivity(players) {
  for (const p of players) {
    const [name, id] = String(p.Player).split(':');
    if (!id) continue;
    const a = (activity.players[id] ||= { name, minutes: 0, teams: {}, perm: 'Normal', days: {} });
    a.name = name; a.minutes += 1; a.perm = p.Permission || 'Normal';
    a.days ||= {};
    const dk = dayKey(); a.days[dk] = (a.days[dk] || 0) + 1;
    const team = p.Team || 'Unknown';
    a.teams[team] = (a.teams[team] || 0) + 1;
    const loc = p.Location || {};
    if (Number.isFinite(loc.LocationX) && Number.isFinite(loc.LocationZ)) {
      const k = Math.round(loc.LocationX / 50) + ',' + Math.round(loc.LocationZ / 50);
      if (heat[k] || Object.keys(heat).length < 6000) heat[k] = (heat[k] || 0) + 1;
    }
  }
  if (++activityTicks % 5 === 0) {
    const cutoff = dayKey(Date.now() - 40 * 86400_000); // keep ~40 days of per-day minutes
    for (const a of Object.values(activity.players)) for (const d of Object.keys(a.days || {})) if (d < cutoff) delete a.days[d];
    saveJson('activity.json', activity);
    saveJson('mapheat.json', heat);
  }
}
const mainTeam = a => Object.entries(a.teams).sort((x, y) => y[1] - x[1])[0]?.[0] || '';

// ---------- Player-count history (in memory, last 24 hours) ----------
// Resets whenever the service restarts or sleeps (normal on Render's free plan).
// ---------- Peaks + busy-hours heatmap (saved to data/stats.json) ----------
const QUOTA = Number(process.env.STAFF_WEEKLY_HOURS) || 0; // weekly hours target for staff (0 = off)
let meta = loadJson('stats.json', null) || {};
meta.peakAll ||= 0; meta.peakAllAt ||= 0; meta.peakDay ||= { date: '', n: 0 }; meta.hourly ||= {};
let metaTicks = 0;
function dayKey(t = Date.now()) { return new Date(t).toISOString().slice(0, 10); }
function minutesSince(a, days) {
  const from = dayKey(Date.now() - (days - 1) * 86400_000);
  return Object.entries(a.days || {}).reduce((sum, [d, m]) => (d >= from ? sum + m : sum), 0);
}
function recordPeaks(n) {
  const now = Date.now(), today = dayKey(now);
  if (meta.peakDay.date !== today) meta.peakDay = { date: today, n: 0 };
  if (n > meta.peakDay.n) meta.peakDay.n = n;
  if (n > meta.peakAll) { meta.peakAll = n; meta.peakAllAt = now; }
  const dt = new Date(now), k = `${dt.getUTCDay()}-${dt.getUTCHours()}`;
  const h = (meta.hourly[k] ||= { sum: 0, n: 0 });
  h.sum += n; h.n += 1;
  if (++metaTicks % 5 === 0) saveJson('stats.json', meta);
}

const history = [];
async function sample() {
  try {
    const d = await erlc(PUBLIC_FLAGS, 55_000);
    history.push({ t: Date.now(), players: d.CurrentPlayers ?? (d.Players || []).length, queue: (d.Queue || []).length });
    while (history.length > 1440) history.shift();
    recordPeaks(d.CurrentPlayers ?? (d.Players || []).length);
    trackActivity(d.Players || []);
  } catch {}
}
if (ERLC_SERVER_KEY) { sample(); setInterval(sample, 60_000); }
app.get('/api/mapheat', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ cells: Object.entries(heat).map(([k, v]) => { const [x, z] = k.split(',').map(Number); return [x * 50, z * 50, v]; }) });
});
app.get('/api/history', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(history); });
// Average players for each (UTC day-of-week, UTC hour); the page converts to the viewer's local time.
app.get('/api/heatmap', (req, res) => {
  const cells = {}; let samples = 0;
  for (const [k, v] of Object.entries(meta.hourly)) { cells[k] = v.n ? +(v.sum / v.n).toFixed(1) : 0; samples += v.n; }
  res.set('Cache-Control', 'no-store');
  res.json({ cells, samples });
});

// ---------- Melonly (public summary only) ----------
app.get('/api/melonly', async (req, res) => {
  if (!MELONLY_API_TOKEN) return res.json({ enabled: false });
  try {
    const [info, members] = await Promise.all([melonly('/server/info'), melonly('/server/members')]);
    const list = Array.isArray(members) ? members : (members.data || members.members || []);
    const count = members.total ?? members.pagination?.total ?? list.length;
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: true, name: info.name, members: count });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ enabled: true, error: 'Could not reach the Melonly API.' });
  }
});

// ---------- Sessions (signed cookies, no extra packages) ----------
// Set SESSION_SECRET in Render so logins survive restarts; otherwise a random one is used per boot.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
function packCookie(obj) { const b = Buffer.from(JSON.stringify(obj)).toString('base64url'); return `${b}.${sign(b)}`; }
function unpackCookie(raw) {
  if (!raw || !raw.includes('.')) return null;
  const [b, sig] = raw.split('.');
  const want = sign(b);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const o = JSON.parse(Buffer.from(b, 'base64url').toString());
    return o.exp && o.exp < Date.now() ? null : o;
  } catch { return null; }
}
function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  const secure = BASE_URL.startsWith('https') ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
const getSession = req => unpackCookie(readCookies(req).session);

// ---------- Discord login (OAuth2) ----------
const REDIRECT_URI = `${BASE_URL}/auth/callback`;

// Optional proxy: if Discord is blocking this host's IP (HTTP 429 with an HTML body),
// set DISCORD_PROXY_URL (your Cloudflare Worker URL) and PROXY_KEY (shared secret) on Render.
// Only server-side Discord API calls go through it; the browser still talks to Discord directly.
const DISCORD_PROXY = (process.env.DISCORD_PROXY_URL || '').replace(/\/$/, '');
const DISCORD_API = (DISCORD_PROXY || 'https://discord.com') + '/api/v10';
if (DISCORD_PROXY) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts = {}) => String(url).startsWith(DISCORD_API)
    ? realFetch(url, { ...opts, headers: { ...opts.headers, 'x-proxy-key': process.env.PROXY_KEY } })
    : realFetch(url, opts);
}
console.log('Discord API base:', DISCORD_API, '| proxy on:', Boolean(DISCORD_PROXY));

app.get('/auth/login', (req, res) => {
  if (!authEnabled) return res.status(404).send('Discord login is not configured on this server.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', packCookie({ state, exp: Date.now() + 10 * 60_000 }), 600);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: DISCORD_GUILD_ID ? 'identify guilds.members.read' : 'identify', state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  try {
    if (req.query.error) return res.status(400).send(`Discord said: ${req.query.error}. Go back and try again.`);
    const st = unpackCookie(readCookies(req).oauth_state);
    if (!st || !req.query.code || st.state !== req.query.state) {
      return res.status(400).send('Login failed (the sign-in link expired). Go back and try again.');
    }
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code',
        code: String(req.query.code), redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) {
      const detail = (await tokenRes.text().catch(() => '')).slice(0, 300);
      const wait = tokenRes.headers.get('retry-after');
      console.error(`Discord token exchange failed: ${tokenRes.status}${wait ? ` (retry-after ${wait}s)` : ''} ${detail}`);
      if (tokenRes.status === 429) {
        return res.status(429).send('Discord is temporarily rate-limiting sign-ins from this host. Please wait a few minutes, then try once more (repeated tries make the wait longer).');
      }
      if (tokenRes.status === 403 && DISCORD_PROXY) {
        return res.status(502).send('The Discord proxy rejected the request. Check that PROXY_KEY matches on Render and Cloudflare.');
      }
      if (tokenRes.status === 400 || tokenRes.status === 401) {
        return res.status(502).send('Discord rejected the login. Check DISCORD_CLIENT_SECRET and that the redirect URL in the Discord developer portal matches exactly.');
      }
      throw new Error(`token exchange ${tokenRes.status}`);
    }
    const { access_token } = await tokenRes.json();
    const auth = { Authorization: `Bearer ${access_token}` };

    const me = await (await fetch(`${DISCORD_API}/users/@me`, { headers: auth })).json();
    let inGuild = true, roles = [];
    if (DISCORD_GUILD_ID) {
      const m = await fetch(`${DISCORD_API}/users/@me/guilds/${DISCORD_GUILD_ID}/member`, { headers: auth });
      if (m.ok) roles = (await m.json()).roles || []; else inGuild = false;
    }
    const admin = inGuild && roles.some(r => ADMIN_ROLES.includes(r));
    // Admins always count as staff.
    const staff = inGuild && (admin || roles.some(r => STAFF_ROLES.includes(r)));
    // Staff always count as members. With no MEMBER_ROLE_IDS set, everyone in the server is a member.
    const member = inGuild && (staff || !MEMBER_ROLES.length || roles.some(r => MEMBER_ROLES.includes(r)));
    const session = {
      id: me.id, name: me.global_name || me.username, staff, admin, member, inGuild,
      avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
      exp: Date.now() + 12 * 3600_000,
    };
    setCookie(res, 'session', packCookie(session), 12 * 3600);
    setCookie(res, 'oauth_state', '', 0);
    res.redirect(staff ? '/dashboard' : '/');
  } catch (err) {
    console.error('Discord login failed:', err.message);
    res.status(502).send('Discord login failed. Check the server logs and your Discord app settings.');
  }
});

app.get('/auth/logout', (req, res) => { setCookie(res, 'session', '', 0); res.redirect('/'); });

// ---------- Web verification (Roblox <-> Discord) ----------
// Links are saved to data/links.json. On Render's free plan the disk resets on redeploy,
// but the Discord role itself is permanent, so members stay verified.
const LINKS_FILE = path.join(DATA_DIR, 'links.json');
let links = {};
try { links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8')); } catch {}
function saveLinks() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LINKS_FILE + '.tmp', JSON.stringify(links));
    fs.renameSync(LINKS_FILE + '.tmp', LINKS_FILE);
  } catch (e) { console.error('Could not save links:', e.message); }
}
const pending = new Map(); // discordId -> { robloxId, robloxUsername, code, exp, startedAt }

const botCall = (method, url, body) => fetch(`${DISCORD_API}${url}`, {
  method,
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

function requireLogin(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Log in with Discord first.' });
  req.session = s;
  next();
}

app.get('/api/me', (req, res) => {
  const s = getSession(req);
  const link = s ? links[s.id] : null;
  res.set('Cache-Control', 'no-store');
  res.json({
    authEnabled, verifyEnabled, staffKeyEnabled: Boolean(STAFF_KEY), announceEnabled,
    user: s ? { id: s.id, name: s.name, avatar: s.avatar } : null,
    inGuild: s ? s.inGuild : null,
    staff: Boolean(s && s.staff),
    admin: Boolean(s && s.admin),
    adminCommandsEnabled,
    member: Boolean(s && s.member),
    link: link ? { robloxUsername: link.robloxUsername, robloxId: link.robloxId } : null,
  });
});

app.post('/api/verify/start', requireLogin, async (req, res) => {
  if (!verifyEnabled) return res.status(404).json({ error: 'Web verification is not enabled.' });
  const uid = req.session.id;
  if (!req.session.inGuild) return res.status(403).json({ error: 'Join the Discord server first, then log in again.' });
  if (links[uid]) return res.status(409).json({ error: 'You are already verified.' });
  const prev = pending.get(uid);
  if (prev && Date.now() - prev.startedAt < 3000) return res.status(429).json({ error: 'Slow down for a moment.' });

  const username = String(req.body.username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'That doesn’t look like a Roblox username.' });
  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    if (!r.ok) throw new Error(`Roblox ${r.status}`);
    const found = (await r.json()).data?.[0];
    if (!found) return res.status(404).json({ error: 'I couldn’t find that Roblox user.' });
    if (Object.values(links).some(l => l.robloxId === String(found.id))) {
      return res.status(409).json({ error: 'That Roblox account is already linked to another Discord user.' });
    }
    const code = 'ERLC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    pending.set(uid, { robloxId: String(found.id), robloxUsername: found.name, code, exp: Date.now() + 10 * 60_000, startedAt: Date.now() });
    res.json({ code, robloxUsername: found.name, minutes: 10 });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: 'Could not reach Roblox. Try again in a moment.' });
  }
});

app.post('/api/verify/confirm', requireLogin, async (req, res) => {
  if (!verifyEnabled) return res.status(404).json({ error: 'Web verification is not enabled.' });
  const uid = req.session.id;
  const p = pending.get(uid);
  if (!p) return res.status(400).json({ error: 'Start verification first.' });
  if (Date.now() > p.exp) { pending.delete(uid); return res.status(400).json({ error: 'Your code expired. Start again.' }); }
  try {
    const r = await fetch(`https://users.roblox.com/v1/users/${p.robloxId}`);
    if (!r.ok) throw new Error(`Roblox ${r.status}`);
    const user = await r.json();
    if (!String(user.description || '').includes(p.code)) {
      return res.status(400).json({ error: `I couldn’t find ${p.code} in your Roblox About section yet. Save it, wait a few seconds, then try again.` });
    }
    links[uid] = { robloxId: p.robloxId, robloxUsername: user.name, verifiedAt: Date.now() };
    saveLinks(); pending.delete(uid);

    const notes = [];
    const role = await botCall('PUT', `/guilds/${DISCORD_GUILD_ID}/members/${uid}/roles/${VERIFIED_ROLE_ID}`);
    if (!role.ok) notes.push('I linked your account but couldn’t give you the role. Ask a staff member (the bot’s role must be above the verified role).');
    await botCall('PATCH', `/guilds/${DISCORD_GUILD_ID}/members/${uid}`, { nick: user.name.slice(0, 32) }).catch(() => {});
    res.json({ ok: true, robloxUsername: user.name, notes });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: 'Could not reach Roblox. Try again in a moment.' });
  }
});

app.post('/api/verify/remove', requireLogin, async (req, res) => {
  const uid = req.session.id;
  if (!links[uid]) return res.status(404).json({ error: 'You are not verified here.' });
  delete links[uid]; saveLinks();
  if (verifyEnabled) await botCall('DELETE', `/guilds/${DISCORD_GUILD_ID}/members/${uid}/roles/${VERIFIED_ROLE_ID}`).catch(() => {});
  res.json({ ok: true });
});

// ---------- Staff-only panels ----------
// Staff = Discord login with one of STAFF_ROLE_IDS, or the shared STAFF_KEY header (fallback).
function requireStaff(req, res, next) {
  if (!STAFF_KEY && !authEnabled) return res.status(404).json({ error: 'Staff panel disabled.' });
  const s = getSession(req);
  if (s && s.staff) { req.staffUser = s.name; return next(); }
  if (STAFF_KEY) {
    const given = Buffer.from(String(req.get('x-staff-key') || ''));
    const real = Buffer.from(STAFF_KEY);
    if (given.length === real.length && crypto.timingSafeEqual(given, real)) { req.staffUser = 'staff-key'; return next(); }
  }
  return res.status(401).json({ error: 'Staff access required.' });
}

// Audit trail of staff actions (saved to data/audit.json)
let auditLog = loadJson('audit.json', []);
function audit(who, action, detail = '') {
  auditLog.unshift({ Timestamp: Math.floor(Date.now() / 1000), Staff: who, Action: action, Detail: String(detail).slice(0, 200) });
  if (auditLog.length > 200) auditLog.length = 200;
  saveJson('audit.json', auditLog);
}

const nameOf = s => String(s || '').split(':')[0];
const topN = (map, n = 5) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

app.get('/api/staff/insights', requireStaff, async (req, res) => {
  try {
    const d = await erlc(['KillLogs', 'CommandLogs', 'ModCalls', 'JoinLogs'], 20_000);
    const killers = new Map(), victims = new Map(), cmdUsers = new Map(), cmds = new Map();
    for (const k of d.KillLogs || []) { bump(killers, nameOf(k.Killer)); bump(victims, nameOf(k.Killed)); }
    for (const c of d.CommandLogs || []) { bump(cmdUsers, nameOf(c.Player)); bump(cmds, String(c.Command || '').split(' ')[0]); }
    const calls = d.ModCalls || [];
    const answered = calls.filter(c => c.Moderator).length;
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const joins = (d.JoinLogs || []).filter(j => j.Join);
    res.set('Cache-Control', 'no-store');
    res.json({
      topKillers: topN(killers), topVictims: topN(victims), topCommandUsers: topN(cmdUsers), topCommands: topN(cmds),
      modCalls: { total: calls.length, answered, unanswered: calls.length - answered },
      joinsLastHour: joins.filter(j => j.Timestamp > hourAgo).length,
      uniquePlayersInLog: new Set(joins.map(j => nameOf(j.Player))).size,
      killCount: (d.KillLogs || []).length,
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the ERLC API.' });
  }
});

// Staff can broadcast a server message (:m) or a hint (:h). Off unless ALLOW_ANNOUNCE=true.
// ER:LC may require your host's IP to be trusted in the API dashboard before commands work.
let lastCommandAt = 0;
app.post('/api/staff/announce', requireStaff, async (req, res) => {
  if (!announceEnabled) return res.status(403).json({ error: 'Sending messages is turned off (set ALLOW_ANNOUNCE=true).' });
  const prefix = req.body.type === 'hint' ? ':h' : ':m';
  const message = String(req.body.message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!message) return res.status(400).json({ error: 'Type a message first.' });
  if (Date.now() - lastCommandAt < 5000) return res.status(429).json({ error: 'Wait a few seconds between messages.' });
  lastCommandAt = Date.now();
  try {
    const r = await fetch(`${BASE}/server/command`, {
      method: 'POST',
      headers: { 'server-key': ERLC_SERVER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `${prefix} ${message}` }),
    });
    const body = await r.json().catch(() => ({}));
    console.log(`[announce] ${req.staffUser}: ${prefix} ${message}`);
    audit(req.staffUser, 'Announcement', `${prefix} ${message}`);
    if (!r.ok) return res.status(502).json({ error: body.message || `ERLC returned ${r.status}.` });
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: 'Could not reach the ERLC API.' });
  }
});

// ---------- Public activity leaderboard ----------
app.get('/api/activity', (req, res) => {
  const range = ['week', 'month'].includes(req.query.range) ? req.query.range : 'all';
  const minutes = a => (range === 'all' ? a.minutes : minutesSince(a, range === 'week' ? 7 : 30));
  const rows = Object.values(activity.players)
    .map(a => ({ name: a.name, minutes: minutes(a), team: mainTeam(a) }))
    .filter(r => r.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes).slice(0, 10);
  res.set('Cache-Control', 'no-store');
  res.json({ since: activity.since, tracked: Object.keys(activity.players).length, range, top: rows });
});

app.get('/api/activity/me', requireLogin, (req, res) => {
  const link = links[req.session.id];
  if (!link) return res.json({ linked: false });
  const a = activity.players[link.robloxId];
  res.json({ linked: true, minutes: a ? a.minutes : 0, since: activity.since });
});

app.post('/api/staff/activity/reset', requireStaff, (req, res) => {
  console.log(`[activity] reset by ${req.staffUser}`);
  audit(req.staffUser, 'Activity counters reset');
  activity = { since: Date.now(), players: {} };
  saveJson('activity.json', activity);
  res.json({ ok: true });
});

// ---------- Events board ----------
let events = loadJson('events.json', []);
app.get('/api/events', (req, res) => {
  const cutoff = Date.now() - 2 * 3600_000; // keep an event visible for 2 hours after it starts
  res.set('Cache-Control', 'no-store');
  const s = getSession(req);
  res.json(events.filter(e => e.startsAt > cutoff).sort((a, b) => a.startsAt - b.startsAt).slice(0, 10).map(e => ({
    id: e.id, title: e.title, description: e.description, startsAt: e.startsAt,
    going: (e.rsvps || []).length, rsvped: Boolean(s && (e.rsvps || []).includes(s.id)),
  })));
});
app.post('/api/events/:id/rsvp', requireLogin, (req, res) => {
  if (!req.session.inGuild) return res.status(403).json({ error: 'Join the Discord server first.' });
  const e = events.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Event not found.' });
  e.rsvps ||= [];
  const i = e.rsvps.indexOf(req.session.id);
  if (i >= 0) e.rsvps.splice(i, 1); else e.rsvps.push(req.session.id);
  saveJson('events.json', events);
  res.json({ ok: true, going: e.rsvps.length, rsvped: i < 0 });
});
app.post('/api/staff/events', requireStaff, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 80);
  const description = String(req.body.description || '').trim().slice(0, 300);
  const startsAt = Number(req.body.startsAt);
  if (!title) return res.status(400).json({ error: 'Give the event a title.' });
  if (!Number.isFinite(startsAt) || startsAt < Date.now() - 3600_000) return res.status(400).json({ error: 'Pick a start time in the future.' });
  if (events.length >= 100) return res.status(400).json({ error: 'Too many events. Delete some first.' });
  events.push({ id: crypto.randomBytes(6).toString('hex'), title, description, startsAt, by: req.staffUser, rsvps: [] });
  saveJson('events.json', events);
  audit(req.staffUser, 'Event created', title);
  notify({ title: `New event: ${title}`, description: `${description ? description + '\n\n' : ''}Starts <t:${Math.floor(startsAt / 1000)}:F>`, color: 0x16a34a });
  res.json({ ok: true });
});
app.delete('/api/staff/events/:id', requireStaff, (req, res) => {
  const before = events.length;
  const gone = events.find(e => e.id === req.params.id);
  if (gone) audit(req.staffUser, 'Event deleted', gone.title);
  events = events.filter(e => e.id !== req.params.id);
  if (events.length === before) return res.status(404).json({ error: 'Event not found.' });
  saveJson('events.json', events);
  res.json({ ok: true });
});

// ---------- Discord webhook alerts (optional) ----------
// Posts new mod calls, and a queue alert, to a channel via a webhook URL.
const hookOk = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(DISCORD_WEBHOOK_URL || '');
async function notify(embed) {
  if (!hookOk) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ color: 0x2563eb, timestamp: new Date().toISOString(), ...embed }], allowed_mentions: { parse: [] } }),
    });
  } catch (e) { console.error('Webhook failed:', e.message); }
}
if (DISCORD_WEBHOOK_URL && !hookOk) console.warn('DISCORD_WEBHOOK_URL doesn’t look like a Discord webhook; alerts are off.');
if (hookOk && ERLC_SERVER_KEY) {
  let seen = null, lastQueueAlert = 0;
  const watch = async () => {
    try {
      const d = await erlc(['ModCalls', 'Queue'], 25_000);
      const calls = d.ModCalls || [];
      const keyOf = c => `${c.Caller}:${c.Timestamp}`;
      if (seen === null) seen = new Set(calls.map(keyOf)); // don't announce old calls on startup
      for (const c of calls) {
        if (seen.has(keyOf(c))) continue;
        seen.add(keyOf(c));
        await notify({ title: 'New mod call', description: `**${nameOf(c.Caller)}** is asking for a moderator.`, color: 0xdc2626 });
      }
      const q = (d.Queue || []).length;
      const limit = Number(QUEUE_ALERT);
      if (limit > 0 && q >= limit && Date.now() - lastQueueAlert > 30 * 60_000) {
        lastQueueAlert = Date.now();
        await notify({ title: 'Queue is filling up', description: `**${q}** players are waiting to join.`, color: 0xd97706 });
      }
    } catch {}
  };
  setTimeout(watch, 5000); setInterval(watch, 30_000);
}

const erlcFeed = (flag) => async () =>
  [...((await erlc([flag]))[flag] || [])].sort((a, b) => (b.Timestamp || 0) - (a.Timestamp || 0)).slice(0, 200);
const STAFF_FEEDS = {
  joinlogs: erlcFeed('JoinLogs'),
  modcalls: erlcFeed('ModCalls'),
  killlogs: erlcFeed('KillLogs'),
  commandlogs: erlcFeed('CommandLogs'),
  activity: async () => Object.values(activity.players)
    .filter(a => a.perm && a.perm !== 'Normal')
    .sort((a, b) => b.minutes - a.minutes)
    .map(a => {
      const wk = minutesSince(a, 7);
      const row = { Staff: a.name, Role: a.perm, Hours: (a.minutes / 60).toFixed(1), 'Week (h)': (wk / 60).toFixed(1), Minutes: a.minutes, Team: mainTeam(a) };
      if (QUOTA > 0) row.Quota = wk >= QUOTA * 60 ? '✓ met' : `${((QUOTA * 60 - wk) / 60).toFixed(1)}h short`;
      return row;
    }),
  audit: async () => auditLog,
  melonlymembers: () => melonly('/server/members'),
};
app.get('/api/staff/:feed', requireStaff, async (req, res) => {
  const load = STAFF_FEEDS[req.params.feed];
  if (!load) return res.status(404).json({ error: 'Unknown feed.' });
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await load());
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the API (check the token and try again).' });
  }
});

// ---------- Admin panel (Discord role in ADMIN_ROLE_IDS only) ----------
function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (s && s.admin) { req.staffUser = s.name; return next(); }
  return res.status(s ? 403 : 401).json({ error: 'Admin access required.' });
}

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  let erlcOk = false;
  try { await erlc([], 10_000); erlcOk = true; } catch {}
  res.set('Cache-Control', 'no-store');
  res.json({
    erlcOk,
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
    verifiedLinks: Object.keys(links).length,
    pendingVerifications: pending.size,
    events: events.length,
    activityTracked: Object.keys(activity.players).length,
    auditEntries: auditLog.length,
    webhook: hookOk,
    proxy: Boolean(DISCORD_PROXY),
    commands: adminCommandsEnabled,
  });
});

app.get('/api/admin/links', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(Object.entries(links)
    .map(([discordId, l]) => ({ discordId, robloxUsername: l.robloxUsername, robloxId: l.robloxId, verifiedAt: l.verifiedAt || 0 }))
    .sort((a, b) => b.verifiedAt - a.verifiedAt));
});

app.delete('/api/admin/links/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!/^\d{5,25}$/.test(id) || !links[id]) return res.status(404).json({ error: 'Link not found.' });
  const gone = links[id];
  delete links[id]; saveLinks();
  if (verifyEnabled) await botCall('DELETE', `/guilds/${DISCORD_GUILD_ID}/members/${id}/roles/${VERIFIED_ROLE_ID}`).catch(() => {});
  audit(req.staffUser, 'Admin: link removed', `${gone.robloxUsername} (${id})`);
  res.json({ ok: true });
});

// Allowlisted ER:LC commands only. Target-style commands accept usernames/IDs, comma-separated.
const ADMIN_CMDS = new Set(['m', 'h', 'pm', 'kick', 'ban', 'unban', 'wanted', 'unwanted', 'refresh']);
const TARGET_CMDS = new Set(['kick', 'ban', 'unban', 'wanted', 'unwanted']);
let lastAdminCmdAt = 0;
app.post('/api/admin/command', requireAdmin, async (req, res) => {
  if (!adminCommandsEnabled) return res.status(403).json({ error: 'Panel commands are off (set ALLOW_ADMIN_COMMANDS=true).' });
  const cmd = String(req.body.command || '').toLowerCase();
  if (!ADMIN_CMDS.has(cmd)) return res.status(400).json({ error: 'That command isn’t allowed.' });
  const args = String(req.body.args || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (cmd !== 'refresh' && !args) return res.status(400).json({ error: 'Add a player or message first.' });
  if (TARGET_CMDS.has(cmd) && !/^[A-Za-z0-9_,]{3,100}$/.test(args)) return res.status(400).json({ error: 'Use a Roblox username or ID (comma-separate several).' });
  if (Date.now() - lastAdminCmdAt < 2000) return res.status(429).json({ error: 'Slow down a moment.' });
  lastAdminCmdAt = Date.now();
  const full = `:${cmd}${args ? ' ' + args : ''}`;
  try {
    const r = await fetch(`${BASE}/server/command`, {
      method: 'POST',
      headers: { 'server-key': ERLC_SERVER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: full }),
    });
    const body = await r.json().catch(() => ({}));
    audit(req.staffUser, 'Admin command', full);
    console.log(`[admin] ${req.staffUser}: ${full}`);
    if (!r.ok) return res.status(502).json({ error: body.message || `ERLC returned ${r.status}.` });
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: 'Could not reach the ERLC API.' });
  }
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const what = String(req.body.what || '');
  if (what === 'peaks') {
    meta.peakAll = 0; meta.peakAllAt = 0; meta.peakDay = { date: '', n: 0 }; meta.hourly = {}; heat = {};
    saveJson('stats.json', meta); saveJson('mapheat.json', heat);
  } else if (what === 'activity') {
    activity = { since: Date.now(), players: {} }; saveJson('activity.json', activity);
  } else if (what === 'events') {
    events = []; saveJson('events.json', events);
  } else if (what === 'audit') {
    auditLog.length = 0;
  } else return res.status(400).json({ error: 'Unknown reset.' });
  audit(req.staffUser, 'Admin: reset', what);
  res.json({ ok: true });
});

app.post('/api/admin/test-webhook', requireAdmin, async (req, res) => {
  if (!hookOk) return res.status(400).json({ error: 'No valid DISCORD_WEBHOOK_URL is set.' });
  await notify({ title: 'Test alert', description: `Sent by **${req.staffUser}** from the admin panel.` });
  res.json({ ok: true });
});

// Render provides PORT and requires listening on 0.0.0.0 (not just localhost)
app.listen(Number(PORT), '0.0.0.0', () => console.log(`Dashboard listening on port ${PORT}`));
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const fs = require('fs');

const { ERLC_SERVER_KEY, STAFF_KEY, MELONLY_API_TOKEN, SHOW_JOIN_CODE, DB_PATH = '../verify.db', PORT = 3000 } = process.env;
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

// Render pings this to know the service is up
app.get('/healthz', (req, res) => res.json({
  ok: true,
  pageFound: Boolean(pageDir),
  erlcKeySet: Boolean(ERLC_SERVER_KEY),
  staffKeySet: Boolean(STAFF_KEY),
  melonlyTokenSet: Boolean(MELONLY_API_TOKEN),
}));
// Serve the page from ./public (or from next to server.js if the folder was flattened on upload)
const PAGE_DIRS = [path.join(__dirname, 'public'), __dirname];
const pageDir = PAGE_DIRS.find(d => fs.existsSync(path.join(d, 'index.html')));
if (pageDir) {
  app.use(express.static(pageDir, { index: 'index.html', dotfiles: 'ignore' }));
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

    res.set('Cache-Control', 'no-store');
    res.json({
      name: data.Name,
      current: data.CurrentPlayers ?? players.length,
      max: data.MaxPlayers ?? null,
      queue: Array.isArray(queue) ? queue.length : 0,
      teamBalance: data.TeamBalance ?? null,
      accVerifiedReq: data.AccVerifiedReq || null,
      joinKey: String(SHOW_JOIN_CODE).toLowerCase() === 'true' ? data.JoinKey : null,
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

// ---------- Player-count history (in memory, last 24 hours) ----------
// Resets whenever the service restarts or sleeps (normal on Render's free plan).
const history = [];
async function sample() {
  try {
    const d = await erlc(PUBLIC_FLAGS, 55_000);
    history.push({ t: Date.now(), players: d.CurrentPlayers ?? (d.Players || []).length, queue: (d.Queue || []).length });
    while (history.length > 1440) history.shift();
  } catch {}
}
if (ERLC_SERVER_KEY) { sample(); setInterval(sample, 60_000); }
app.get('/api/history', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(history); });

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

// ---------- Staff-only panels ----------
function requireStaff(req, res, next) {
  if (!STAFF_KEY) return res.status(404).json({ error: 'Staff panel disabled.' });
  const given = Buffer.from(String(req.get('x-staff-key') || ''));
  const real = Buffer.from(STAFF_KEY);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return res.status(401).json({ error: 'Wrong staff key.' });
  }
  next();
}

const erlcFeed = (flag) => async () =>
  [...((await erlc([flag]))[flag] || [])].sort((a, b) => (b.Timestamp || 0) - (a.Timestamp || 0)).slice(0, 200);
const STAFF_FEEDS = {
  joinlogs: erlcFeed('JoinLogs'),
  modcalls: erlcFeed('ModCalls'),
  killlogs: erlcFeed('KillLogs'),
  commandlogs: erlcFeed('CommandLogs'),
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

// Render provides PORT and requires listening on 0.0.0.0 (not just localhost)
app.listen(Number(PORT), '0.0.0.0', () => console.log(`Dashboard listening on port ${PORT}`));

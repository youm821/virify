require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');

const { ERLC_SERVER_KEY, STAFF_KEY, DB_PATH = '../verify.db', PORT = 3000 } = process.env;
const BASE = 'https://api.erlc.gg/v2'; // confirm against the official ERLC docs

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
async function erlc(endpoint, ttl = 10_000) {
  const entry = cache.get(endpoint) || {};
  if (entry.data && Date.now() - entry.at < ttl) return entry.data;
  if (entry.pending) return entry.pending;

  const pending = fetch(BASE + endpoint, { headers: { 'server-key': ERLC_SERVER_KEY } })
    .then(async r => {
      if (!r.ok) throw new Error(`ERLC ${r.status}`);
      return r.json();
    })
    .then(data => { cache.set(endpoint, { data, at: Date.now() }); return data; })
    .catch(err => {
      if (entry.data) { cache.set(endpoint, { data: entry.data, at: entry.at }); return entry.data; } // serve stale
      cache.delete(endpoint);
      throw err;
    });
  cache.set(endpoint, { ...entry, pending });
  return pending;
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy

// Render pings this to know the service is up
app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', async (req, res) => {
  try {
    const [server, players, queue] = await Promise.all([
      erlc('/server'), erlc('/server/players'), erlc('/server/queue'),
    ]);

    const teams = {};
    const staff = [];
    const list = players.map(p => {
      const [name, id] = String(p.Player).split(':');
      const team = p.Team || 'Unknown';
      teams[team] = (teams[team] || 0) + 1;
      if (p.Permission && p.Permission !== 'Normal') staff.push({ name, permission: p.Permission });
      return { name, id, team, permission: p.Permission };
    });

    let verified = null;
    if (db) verified = db.prepare('SELECT COUNT(*) AS n FROM links').get().n;

    res.set('Cache-Control', 'no-store');
    res.json({
      name: server.Name,
      current: server.CurrentPlayers ?? players.length,
      max: server.MaxPlayers ?? null,
      queue: Array.isArray(queue) ? queue.length : 0,
      teams, staff, players: list, verified,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: 'Could not reach the ERLC API.' });
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

const STAFF_FEEDS = { joinlogs: '/server/joinlogs', modcalls: '/server/modcalls', killlogs: '/server/killlogs' };
app.get('/api/staff/:feed', requireStaff, async (req, res) => {
  const endpoint = STAFF_FEEDS[req.params.feed];
  if (!endpoint) return res.status(404).json({ error: 'Unknown feed.' });
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await erlc(endpoint));
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the ERLC API.' });
  }
});

// Render provides PORT and requires listening on 0.0.0.0 (not just localhost)
app.listen(Number(PORT), '0.0.0.0', () => console.log(`Dashboard listening on port ${PORT}`));

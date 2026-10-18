// extras.js: MDT (plate / player lookup). Loaded from server.js with one line.
const fs = require('fs');
const path = require('path');

module.exports = function (app, ctx) {
  const FLAGS = ['Players', 'Queue', 'EmergencyCalls', 'Vehicles']; // same flags as the dashboard, so the API result is shared
  const nameOf = s => String(s || '').split(':')[0];
  const low = s => String(s || '').toLowerCase();

  const candidates = [path.join(__dirname, 'public', 'mdt.html'), path.join(__dirname, 'mdt.html')];
  app.get('/mdt', (req, res) => {
    const file = candidates.find(f => fs.existsSync(f));
    if (!file) return res.status(404).send('mdt.html is missing. Upload it next to server.js and redeploy.');
    res.set('Cache-Control', 'no-store');
    res.sendFile(file);
  });

  app.get('/api/mdt', async (req, res) => {
    const q = low(String(req.query.q || '').trim().slice(0, 40));
    if (q.length < 2) return res.status(400).json({ error: 'Type at least 2 characters.' });
    try {
      const d = await ctx.erlc(FLAGS);
      const players = d.Players || [], vehicles = d.Vehicles || [];
      const online = new Map(players.map(p => [low(nameOf(p.Player)), p]));

      const cars = vehicles
        .filter(v => low(`${v.Plate} ${v.Owner} ${v.Name}`).includes(q)).slice(0, 25)
        .map(v => {
          const o = online.get(low(v.Owner));
          return { plate: v.Plate, name: v.Name, owner: v.Owner, livery: v.Texture || '', color: v.ColorName || '',
                   ownerTeam: o ? (o.Team || '') : null, ownerWanted: o ? (o.WantedStars || 0) : 0 };
        });

      const people = players
        .filter(p => low(nameOf(p.Player)).includes(q) || low(p.Callsign).includes(q)).slice(0, 25)
        .map(p => {
          const loc = p.Location || {}, n = low(nameOf(p.Player));
          return {
            name: nameOf(p.Player), team: p.Team || '', callsign: p.Callsign || '', wanted: p.WantedStars || 0,
            street: [loc.BuildingNumber, loc.StreetName].filter(Boolean).join(' '), postal: loc.PostalCode || '',
            vehicles: vehicles.filter(v => low(v.Owner) === n).map(v => `${v.Name} (${v.Plate})`),
          };
        });

      res.set('Cache-Control', 'no-store');
      res.json({ cars, people });
    } catch {
      res.status(502).json({ error: 'Could not reach the ERLC API.' });
    }
  });

  // ---------- Applications ----------
  const crypto = require('crypto');
  const DEPTS = (process.env.APPLY_DEPARTMENTS || 'Police,Fire/EMS,Dispatch,DOT,Staff').split(',').map(x => x.trim()).filter(Boolean);
  let apps = ctx.loadJson('applications.json', []);
  const save = () => ctx.saveJson('applications.json', apps);
  const text = (v, n) => String(v || '').replace(/\r/g, '').trim().slice(0, n);
  const pub = a => ({ id: a.id, department: a.department, roblox: a.roblox, status: a.status, note: a.note, at: a.at });
  const pages = [path.join(__dirname, 'public', 'apply.html'), path.join(__dirname, 'apply.html')];

  app.get('/apply', (req, res) => {
    const f = pages.find(x => fs.existsSync(x));
    if (!f) return res.status(404).send('apply.html is missing. Upload it next to server.js and redeploy.');
    res.set('Cache-Control', 'no-store'); res.sendFile(f);
  });

  app.get('/api/apply/me', (req, res) => {
    const s = ctx.getSession(req);
    if (!s) return res.status(401).json({ error: 'Log in first.' });
    res.set('Cache-Control', 'no-store');
    res.json({ departments: DEPTS, staff: Boolean(s.staff), mine: apps.filter(a => a.userId === s.id).sort((a, b) => b.at - a.at).map(pub) });
  });

  app.post('/api/apply', (req, res) => {
    const s = ctx.getSession(req);
    if (!s) return res.status(401).json({ error: 'Log in first.' });
    const department = DEPTS.includes(req.body.department) ? req.body.department : null;
    const roblox = text(req.body.roblox, 20), experience = text(req.body.experience, 600), why = text(req.body.why, 600);
    if (!department) return res.status(400).json({ error: 'Pick a department.' });
    if (!/^[A-Za-z0-9_]{3,20}$/.test(roblox)) return res.status(400).json({ error: 'Enter your Roblox username.' });
    if (why.length < 20) return res.status(400).json({ error: 'Tell us a bit more about why you want to join (20+ characters).' });
    if (apps.some(a => a.userId === s.id && a.department === department && a.status === 'pending')) return res.status(409).json({ error: 'You already have a pending application for that department.' });
    if (apps.filter(a => a.status === 'pending').length >= 200) return res.status(503).json({ error: 'The queue is full right now. Try again later.' });
    const a = { id: crypto.randomBytes(6).toString('hex'), userId: s.id, userName: s.name, department, roblox, experience, why, status: 'pending', note: '', at: Date.now() };
    apps.push(a); save();
    ctx.notify({ title: `New application: ${department}`, description: `**${s.name}** (${roblox}) applied.\n${why.slice(0, 200)}`, color: 0x7c6cff });
    res.json({ ok: true });
  });

  app.get('/api/staff/apps', ctx.requireStaff, (req, res) => {
    const rank = a => (a.status === 'pending' ? 0 : 1);
    res.set('Cache-Control', 'no-store');
    res.json([...apps].sort((a, b) => rank(a) - rank(b) || b.at - a.at).slice(0, 100));
  });

  app.post('/api/staff/apps/:id', ctx.requireStaff, (req, res) => {
    const a = apps.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'Application not found.' });
    if (a.status !== 'pending') return res.status(409).json({ error: 'Already decided.' });
    const decision = req.body.decision;
    if (!['approved', 'denied'].includes(decision)) return res.status(400).json({ error: 'Bad decision.' });
    a.status = decision; a.note = text(req.body.note, 200); a.decidedBy = req.staffUser; a.decidedAt = Date.now();
    save();
    ctx.audit(req.staffUser, `Application ${decision}`, `${a.userName} (${a.roblox}) · ${a.department}`);
    ctx.notify({ title: `Application ${decision}`, description: `**${a.userName}** · ${a.department}${a.note ? '\n' + a.note : ''}`, color: decision === 'approved' ? 0x16a34a : 0xdc2626 });
    res.json({ ok: true });
  });

  // ---------- Profiles + settings pages ----------
  for (const [route, name] of [['/profile', 'profile.html'], ['/settings', 'settings.html']]) {
    app.get(route, (req, res) => {
      const f = [path.join(__dirname, 'public', name), path.join(__dirname, name)].find(x => fs.existsSync(x));
      if (!f) return res.status(404).send(name + ' is missing. Upload it next to server.js and redeploy.');
      res.set('Cache-Control', 'no-store'); res.sendFile(f);
    });
  }

  app.get('/api/profile', (req, res) => {
    const s = ctx.getSession(req);
    if (!s) return res.status(401).json({ error: 'Log in first.' });
    const q = String(req.query.name || '').trim().toLowerCase(), own = !q;
    const links = ctx.links(), act = ctx.activity();
    let id, name;
    if (own) {
      const l = links[s.id];
      if (!l) return res.json({ own: true, linked: false, user: { name: s.name, avatar: s.avatar } });
      id = l.robloxId; name = l.robloxUsername;
    } else {
      const hit = Object.entries(act.players).find(([, a]) => a.name.toLowerCase() === q);
      if (!hit) return res.status(404).json({ error: 'No tracked player has that name yet.' });
      id = hit[0]; name = hit[1].name;
    }
    const a = act.players[id];
    res.set('Cache-Control', 'no-store');
    res.json({
      own, linked: true, user: own ? { name: s.name, avatar: s.avatar } : null, roblox: { name, id },
      minutes: a ? a.minutes : 0, week: a ? ctx.minutesSince(a, 7) : 0, month: a ? ctx.minutesSince(a, 30) : 0,
      team: a ? ctx.mainTeam(a) : '', teams: a ? a.teams : {},
      days: a ? Object.entries(a.days || {}).sort().slice(-14).map(([d, m]) => ({ d, m })) : [],
      since: act.since, applications: own ? apps.filter(x => x.userId === s.id).length : undefined,
    });
  });
};
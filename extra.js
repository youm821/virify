<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MDT · Lookup</title>
<style>
  :root { --bg:#f4f5f7; --card:#fff; --text:#14161a; --muted:#5d6573; --line:#e1e4ea; --accent:#2563eb; --bad:#dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e1116; --card:#171b22; --text:#e8eaee; --muted:#98a1b0; --line:#262c36; --accent:#5b8def; --bad:#f26b6b; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:900px; margin:0 auto; padding:24px 16px 48px; }
  a { color:var(--accent); text-decoration:none; font-size:14px; }
  h1 { font-size:22px; margin:8px 0 4px; } p { color:var(--muted); margin:0 0 16px; }
  input { width:100%; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:var(--card); color:var(--text); font:inherit; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-top:14px; }
  h2 { font-size:15px; margin:0 0 8px; } .muted { color:var(--muted); }
  .item { padding:10px 0; border-bottom:1px solid var(--line); } .item:last-child { border:0; }
  .top { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .badge { padding:1px 8px; border-radius:999px; font-size:12px; background:rgba(220,38,38,.14); color:var(--bad); }
</style>
</head>
<body>
<div class="wrap">
  <a href="/">← Back to dashboard</a>
  <h1>MDT lookup</h1>
  <p>Search a license plate, vehicle, player name, or callsign. Results come from the live server.</p>
  <input id="q" type="text" placeholder="e.g. ABC-123, Falcon, Bob, 5D-550" autocomplete="off" aria-label="Search">
  <div class="card"><h2>Vehicles</h2><div id="cars" class="muted">Type to search.</div></div>
  <div class="card"><h2>People online</h2><div id="people" class="muted">Type to search.</div></div>
</div>
<script>
const $ = id => document.getElementById(id);
const el = (t, text, c) => { const e = document.createElement(t); if (text !== undefined) e.textContent = text; if (c) e.className = c; return e; };
function row(title, badgeStars, lines) {
  const r = el('div', undefined, 'item'), top = el('div', undefined, 'top');
  top.append(el('strong', title));
  if (badgeStars > 0) top.append(el('span', '★'.repeat(Math.min(badgeStars, 6)) + ' wanted', 'badge'));
  r.append(top);
  for (const l of lines.filter(Boolean)) r.append(el('div', l, 'muted'));
  return r;
}
function fill(box, rows, empty) { box.textContent = ''; if (!rows.length) box.textContent = empty; else box.append(...rows); }
let timer;
$('q').addEventListener('input', () => {
  clearTimeout(timer);
  const q = $('q').value.trim();
  if (q.length < 2) { $('cars').textContent = 'Type to search.'; $('people').textContent = 'Type to search.'; return; }
  timer = setTimeout(async () => {
    try {
      const r = await fetch('/api/mdt?q=' + encodeURIComponent(q));
      if (r.status === 401) { location.href = '/login'; return; }
      const d = await r.json();
      if (!r.ok) { $('cars').textContent = d.error || 'Something went wrong.'; return; }
      fill($('cars'), d.cars.map(c => row(`${c.plate} · ${c.name}`, c.ownerWanted,
        [`Owner: ${c.owner}${c.ownerTeam !== null ? ' (online' + (c.ownerTeam ? ', ' + c.ownerTeam : '') + ')' : ' (offline)'}`, [c.color, c.livery].filter(Boolean).join(' · ')])), 'No vehicles found.');
      fill($('people'), d.people.map(p => row(p.name, p.wanted,
        [[p.team, p.callsign].filter(Boolean).join(' · '), [p.street, p.postal ? 'Postal ' + p.postal : ''].filter(Boolean).join(', '),
         p.vehicles.length ? 'Vehicles: ' + p.vehicles.join(', ') : ''])), 'Nobody online matches.');
    } catch { $('cars').textContent = 'Can’t reach the server.'; }
  }, 300);
});
</script>
</body>
</html>
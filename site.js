// Shared navigation: the same top bar on every page, showing only what this person is allowed to use.
(async () => {
  try {
    if (localStorage.getItem('reduceMotion') === '1') document.documentElement.classList.add('reduce');
    if (localStorage.getItem('theme') === 'custom') {
      const a = (JSON.parse(localStorage.getItem('themeCustom') || '{}') || {}).accent;
      if (/^#[0-9a-f]{6}$/i.test(a)) document.documentElement.style.setProperty('--accent', a);
    }
  } catch {}
  if (document.getElementById('overview')) return; // the dashboard has its own sidebar
  const get = async u => { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch { return null; } };
  const [me, info] = await Promise.all([get('/api/me'), get('/api/public/info')]);
  const bar = document.createElement('nav'); bar.className = 'topbar';
  const link = (href, text, cls) => { const a = document.createElement('a'); a.className = cls || 'l' + (location.pathname === href ? ' on' : ''); a.href = href; a.textContent = text; bar.append(a); return a; };
  link('/', (info && info.name) || 'Home', 'brand');
  link('/departments', 'Departments'); link('/rules', 'Rules'); link('/privacy', 'Privacy');
  if (me && me.user && me.member) { link('/apply', 'Apply'); link('/link', 'Link Roblox'); link('/profile', 'Profile'); link('/settings', 'Settings'); }
  if (me && me.staff) { link('/dashboard', 'Dashboard'); link('/mdt', 'MDT'); }
  if (me && me.admin) link('/mapsetup', 'Map setup');
  const sp = document.createElement('span'); sp.className = 'sp'; bar.append(sp);
  if (me && me.user) {
    const n = document.createElement('span'); n.className = 'muted'; n.textContent = me.user.name; n.style.cssText = 'white-space:nowrap;font-size:14px;margin:0 8px';
    bar.append(n); link('/auth/logout', 'Log out');
  } else if (me && me.authEnabled) link('/auth/login', 'Sign in with Discord', 'btn');
  document.body.prepend(bar);
})();

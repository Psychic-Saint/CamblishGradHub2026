// Camblish Online Exam: core (config, API, UI helpers, router, auth)
// Author: Eddie Bila
const CFG = {
  SB_URL: 'https://jrbihuegqydoqnsxxvma.supabase.co',
  SB_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyYmlodWVncXlkb3Fuc3h4dm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTgyODksImV4cCI6MjEwNjc3NDI4OX0.7fpz-JDtZI61Z-bl3z0_YiS-rMHF1nbrPg5WoDXB72E',
  get FN_URL() { return this.SB_URL + '/functions/v1/exam-files'; },
  ADMIN_EMAIL: 'bilae@camblish.co.za',
  APP: 'Camblish Online Exam',
  VERSION: '1.0.0',
  STUN: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
const LOGO = window.__LOGOS || { white: '', color: '', fav: '' };
const sb = window.supabase.createClient(CFG.SB_URL, CFG.SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const S = { token: null, user: null, cleanup: [] };

// ---------- storage (safe) ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('cox.' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('cox.' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('cox.' + k); } catch (e) { } },
};

// ---------- API ----------
async function rpc(name, params = {}) {
  const { data, error } = await sb.rpc(name, params);
  if (error) {
    const msg = (error.message || 'Something went wrong').replace(/^.*?ERROR:\s*/, '');
    if (/Session expired|sign in again|Invalid session/i.test(msg) && name !== 'exm_login') {
      store.del('token'); S.token = null; S.user = null;
      toast('Your session has ended. Please sign in again.', 'bad');
      go('#/login');
    }
    throw new Error(msg);
  }
  return data;
}
async function api(name, params = {}) { return rpc(name, { p_token: S.token, ...params }); }
function automark(body) {
  return fetch(CFG.SB_URL + '/functions/v1/exam-automark', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.SB_KEY, Authorization: 'Bearer ' + CFG.SB_KEY },
    body: JSON.stringify({ token: S.token, ...body }), keepalive: true,
  }).then(r => r.json()).catch(() => ({ ok: false }));
}
async function fn(action, body = {}) {
  const res = await fetch(CFG.FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.SB_KEY, Authorization: 'Bearer ' + CFG.SB_KEY },
    body: JSON.stringify({ action, token: S.token, ...body }),
  });
  let j = {};
  try { j = await res.json(); } catch (e) { }
  if (!res.ok || j.ok === false) throw new Error(j.error || ('Server error ' + res.status));
  return j;
}

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtDT = d => d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
const fmtT = d => d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
const fmtDur = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0'); };
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function setApp(html) { const a = $('#app'); a.innerHTML = html; return a; }
function toast(msg, kind = '') {
  const t = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4000);
}
function modal({ title, body, wide = false, actions = [], onClose, closable = true }) {
  const o = el(`<div class="overlay"><div class="modal ${wide ? 'wide' : ''}"><header><h2 style="margin:0">${esc(title)}</h2>${closable ? '<button class="x" aria-label="Close">×</button>' : ''}</header><div class="body"></div><footer class="${actions.length ? '' : 'hidden'}"></footer></div></div>`);
  const b = $('.body', o); typeof body === 'string' ? (b.innerHTML = body) : b.appendChild(body);
  const close = () => { o.remove(); onClose && onClose(); };
  if (closable) { $('.x', o).onclick = close; o.addEventListener('mousedown', e => { if (e.target === o) close(); }); }
  actions.forEach(a => {
    const btn = el(`<button class="btn ${a.cls || ''}">${esc(a.label)}</button>`);
    btn.onclick = async () => { if (a.onClick) { const r = await a.onClick(o, btn); if (r === false) return; } close(); };
    $('footer', o).appendChild(btn);
  });
  document.body.appendChild(o);
  return { el: o, close };
}
function confirmBox(title, text, okLabel = 'Confirm', cls = '') {
  return new Promise(res => modal({ title, body: `<p>${text}</p>`, onClose: () => res(false), actions: [{ label: 'Cancel', cls: 'ghost', onClick: () => res(false) }, { label: okLabel, cls, onClick: () => { res(true); } }] }));
}
function promptBox(title, label, value = '', type = 'text') {
  return new Promise(res => {
    const body = el(`<div><div class="field"><label>${esc(label)}</label>${type === 'textarea' ? `<textarea>${esc(value)}</textarea>` : `<input type="${type}" value="${esc(value)}">`}</div></div>`);
    let done = false;
    const m = modal({ title, body, onClose: () => !done && res(null), actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'OK', onClick: () => { done = true; res($('input,textarea', body).value); } }] });
    setTimeout(() => $('input,textarea', body).focus(), 50);
  });
}
async function busy(btn, f) {
  const old = btn && btn.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '<span>Working…</span>'; }
  try { return await f(); } catch (e) { toast(e.message, 'bad'); throw e; } finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}
function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function fileToB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }
function blobToB64(blob) { return fileToB64(blob); }
function loadScript(src) { return new Promise((res, rej) => { if ($(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
const isStaff = u => u && ['admin', 'invigilator', 'marker'].includes(u.role);
const isAdmin = u => u && u.role === 'admin';
function cleanupAll() { S.cleanup.splice(0).forEach(f => { try { f(); } catch (e) { } }); document.body.className = ''; }

// ---------- platform check ----------
function platformInfo() {
  const uaD = navigator.userAgentData;
  const ua = navigator.userAgent;
  let browser = 'Other', os = 'Other';
  if (uaD && uaD.brands) {
    const b = uaD.brands.map(x => x.brand);
    if (b.includes('Google Chrome')) browser = 'Chrome';
    else if (b.includes('Microsoft Edge')) browser = 'Edge';
    else if (b.some(x => /Opera|Brave|Vivaldi|Yandex/i.test(x))) browser = 'Other Chromium';
    else if (b.includes('Chromium')) browser = 'Chromium';
    os = uaD.platform === 'Windows' ? 'Windows' : uaD.platform === 'macOS' ? 'macOS' : (uaD.platform || 'Other');
  } else {
    if (/Edg\//.test(ua)) browser = 'Edge'; else if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) browser = 'Chrome'; else if (/Firefox\//.test(ua)) browser = 'Firefox'; else if (/Safari\//.test(ua)) browser = 'Safari';
    os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : 'Other';
  }
  const mobile = (uaD && uaD.mobile) || /Android|iPhone|iPad/i.test(ua);
  if (navigator.brave) browser = 'Other Chromium';
  const ok = browser === 'Chrome' && (os === 'Windows' || os === 'macOS') && !mobile;
  return { browser, os, mobile, ok, ua, screen: { w: screen.width, h: screen.height, extended: !!screen.isExtended }, cores: navigator.hardwareConcurrency, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

// ---------- layout ----------
function shell(active, inner) {
  const u = S.user;
  const links = isStaff(u)
    ? [['#/home', 'Exams', 'home'], ...(isAdmin(u) ? [['#/users', 'Users', 'users'], ['#/settings', 'Settings', 'settings']] : [])]
    : [['#/home', 'My exams', 'home'], ['#/results', 'My results', 'results']];
  return `
  <div class="topbar noprint">
    <div class="brand"><img class="crest" src="${LOGO.white}" alt="Camblish Training Institute"><div>Camblish Online Exam<small>Taking the Lead, Shaping the Future</small></div></div>
    <nav class="nav">${links.map(l => `<a href="${l[0]}" class="${active === l[2] ? 'on' : ''}">${l[1]}</a>`).join('')}</nav>
    <div class="who"><span>${esc(u.full_name || u.email)}</span><span class="role">${esc(u.role)}</span><a href="#/account" style="color:#fff">Account</a><a href="#" id="logout" style="color:#fff">Sign out</a></div>
  </div>
  <main class="wrap">${inner}</main>`;
}
function bindShell() {
  const lo = $('#logout');
  if (lo) lo.onclick = async e => { e.preventDefault(); try { await api('exm_logout'); } catch (x) { } store.del('token'); S.token = null; S.user = null; go('#/login'); };
}

// ---------- router ----------
function go(h) { if (location.hash === h) route(); else location.hash = h; }
const ROUTES = [];
function on(re, fnc, opts = {}) { ROUTES.push({ re, fnc, opts }); }
let routing = false;
async function route() {
  if (S.lockNav) return; // exam room holds navigation
  const q = new URLSearchParams(location.search);
  if (q.get('phone') !== null || location.hash.startsWith('#/phone')) { cleanupAll(); return renderPhone(q.get('phone') || location.hash.split('/')[2] || ''); }
  const h = location.hash || '#/home';
  for (const r of ROUTES) {
    const m = h.match(r.re);
    if (!m) continue;
    if (!r.opts.public && !S.user) {
      const ok = await restore();
      if (!ok) { store.set('after', h); return go('#/login'); }
    }
    if (r.opts.staff && !isStaff(S.user)) return go('#/home');
    if (r.opts.admin && !isAdmin(S.user)) return go('#/home');
    cleanupAll();
    try { await r.fnc(...m.slice(1)); } catch (e) { console.error(e); setApp(shell('', `<div class="notice bad">${esc(e.message)}</div>`)); bindShell(); }
    window.scrollTo(0, 0);
    return;
  }
  go('#/home');
}
async function restore() {
  const t = store.get('token');
  if (!t) return false;
  try { S.token = t; const r = await rpc('exm_me', { p_token: t }); S.user = r.user; return true; }
  catch (e) { store.del('token'); S.token = null; return false; }
}
window.addEventListener('hashchange', route);

// ---------- auth views ----------
function authLayout(inner) {
  return `<div class="auth">
    <div class="side">
      <div class="brand big"><img class="crest" src="${LOGO.white}" alt="Camblish Training Institute"><div>Camblish Training Institute<small>Taking the Lead, Shaping the Future</small></div></div>
      <div>
        <div class="tag">ONLINE ASSESSMENT CENTRE</div>
        <h1>Write your assessment from anywhere, under proper invigilation.</h1>
        <p>Before you start, make sure you have:</p>
        <ul>
          <li>Google Chrome on a Windows laptop or MacBook</li>
          <li>A working webcam and microphone</li>
          <li>Your phone and a stand to place it beside you</li>
          <li>Your ID document</li>
        </ul>
      </div>
      <small style="color:#9fb0da">Version ${CFG.VERSION} · Eddie Bila</small>
    </div>
    <div class="formside"><div class="box">${inner}</div></div>
  </div>`;
}
on(/^#\/login$/, async () => {
  if (await restore()) return go('#/home');
  setApp(authLayout(`
    <div class="kicker">Welcome back</div><h1>Sign in</h1>
    <form id="f" class="stack" autocomplete="on">
      <div class="field"><label>Email address</label><input name="email" type="email" required autocomplete="username"></div>
      <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn lg" style="width:100%">Sign in</button>
      <p class="muted" style="text-align:center">New here? <a href="#/signup">Create an account</a></p>
    </form>`));
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button', f);
    await busy(btn, async () => {
      const r = await rpc('exm_login', { p_email: f.email.value.trim(), p_password: f.password.value, p_user_agent: navigator.userAgent });
      if (!r.ok) throw new Error(r.error || 'Could not sign in');
      S.token = r.token; S.user = r.user; store.set('token', r.token);
      const after = store.get('after'); store.del('after');
      go(after && after !== '#/login' ? after : '#/home');
    }).catch(() => { });
  };
}, { public: true });

on(/^#\/signup$/, async () => {
  setApp(authLayout(`
    <div class="kicker">Learner registration</div><h1>Create your account</h1>
    <form id="f" autocomplete="on">
      <div class="field"><label>Full name and surname</label><input name="full_name" required></div>
      <div class="field"><label>Email address</label><input name="email" type="email" required><div class="hint">Your results report will be sent to this address.</div></div>
      <div class="grid2" style="gap:10px"><div class="field"><label>ID number</label><input name="id_number" required maxlength="20"></div>
      <div class="field"><label>Cell number</label><input name="phone" required maxlength="20"></div></div>
      <div class="grid2" style="gap:10px"><div class="field"><label>Password</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label>Confirm password</label><input name="password2" type="password" minlength="8" required autocomplete="new-password"></div></div>
      <label class="check"><input type="checkbox" name="consent" required> <span>I consent to Camblish recording my screen, camera, microphone and phone camera during assessments for invigilation and quality assurance, as required by the AQP. Recordings are kept securely and used only for assessment integrity (POPIA).</span></label>
      <div style="height:14px"></div>
      <button class="btn lg" style="width:100%">Create account</button>
      <p class="muted" style="text-align:center">Already registered? <a href="#/login">Sign in</a></p>
    </form>`));
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button', f);
    if (f.password.value !== f.password2.value) return toast('The passwords do not match', 'bad');
    await busy(btn, async () => {
      const r = await rpc('exm_signup', { p_email: f.email.value.trim(), p_password: f.password.value, p_full_name: f.full_name.value.trim(), p_id_number: f.id_number.value.trim(), p_phone: f.phone.value.trim() });
      S.token = r.token; S.user = r.user; store.set('token', r.token);
      toast(r.user.role === 'admin' ? 'Administrator account created' : 'Account created. Welcome!', 'ok');
      go('#/home');
    }).catch(() => { });
  };
}, { public: true });

on(/^#\/account$/, async () => {
  const u = S.user;
  setApp(shell('', `
    <div class="pagehead"><div><div class="kicker">My account</div><h1>${esc(u.full_name)}</h1><p>${esc(u.email)} · ${esc(u.role)}</p></div></div>
    <div class="card" style="max-width:520px"><h2>Change password</h2>
      <form id="pw"><div class="field"><label>Current password</label><input name="old" type="password" required></div>
      <div class="field"><label>New password</label><input name="nw" type="password" minlength="8" required></div>
      <button class="btn">Update password</button></form></div>`));
  bindShell();
  $('#pw').onsubmit = async e => { e.preventDefault(); const f = e.target; await busy($('button', f), async () => { await api('exm_change_password', { p_old: f.old.value, p_new: f.nw.value }); toast('Password updated', 'ok'); f.reset(); }).catch(() => { }); };
});

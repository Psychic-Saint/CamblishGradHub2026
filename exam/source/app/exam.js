// Camblish Online Exam: pre-exam checks, exam room, proctoring and Python workspace
// Author: Eddie Bila

// ---------- Python runtime client ----------
const PyRT = {
  worker: null, seq: 0, pending: new Map(), readyP: null, status: 'idle', files: [],
  start(onStatus) {
    if (this.readyP) return this.readyP;
    const src = document.getElementById('worker-src').textContent;
    this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'status') { onStatus && onStatus(m.text); return; }
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p(m.result); }
    };
    this.status = 'loading';
    this.readyP = this.call({ type: 'init' }).then(() => { this.status = 'ready'; return true; });
    return this.readyP;
  },
  call(msg, transfer) { return new Promise(res => { const id = ++this.seq; this.pending.set(id, res); this.worker.postMessage({ ...msg, id }, transfer || []); }); },
  async addFile(name, buf) { await this.readyP; return this.call({ type: 'file', name, buf }, [buf]); },
  async run(lang, code, db) {
    await this.readyP;
    let timer;
    const t = new Promise(res => { timer = setTimeout(() => res({ timeout: true }), 120000); });
    const r = await Promise.race([this.call({ type: 'run', lang, code, db }), t]);
    clearTimeout(timer);
    return r;
  },
  async ls() { await this.readyP; return this.call({ type: 'ls' }); },
  async restart(onStatus) {
    if (this.worker) this.worker.terminate();
    this.pending.forEach(p => p({ out: '', err: 'Python was restarted', imgs: [] })); this.pending.clear();
    this.readyP = null; this.worker = null;
    await this.start(onStatus);
    for (const f of this.files) await this.addFile(f.name, f.buf.slice(0));
  },
};

// ---------- media helpers ----------
async function getCamMic() {
  return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, audio: { echoCancellation: true, noiseSuppression: false } });
}
async function getScreen() {
  const st = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor', frameRate: { ideal: 5, max: 10 } }, audio: false,
    monitorTypeSurfaces: 'include', selfBrowserSurface: 'include', surfaceSwitching: 'exclude', preferCurrentTab: false,
  });
  const tr = st.getVideoTracks()[0];
  const surf = tr.getSettings().displaySurface;
  if (surf && surf !== 'monitor') { st.getTracks().forEach(t => t.stop()); throw new Error('You shared a ' + (surf === 'browser' ? 'browser tab' : 'window') + '. You must share your ENTIRE SCREEN.'); }
  return st;
}
function frameJpeg(video, maxW, q) {
  if (!video || !video.videoWidth) return null;
  const w = Math.min(maxW, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', q));
}
function stopStream(st) { if (st) st.getTracks().forEach(t => t.stop()); }

// ---------- pre-exam checks ----------
const XS = {}; // exam session state
on(/^#\/precheck\/([\w-]+)$/, async (examId) => {
  const r = await api('exm_exam_get', { p_exam_id: examId });
  const exam = r.exam;
  const pi = platformInfo();
  const staffTest = isStaff(S.user);
  for (const k of Object.keys(XS)) delete XS[k];
  Object.assign(XS, { examId, exam, cam: null, screen: null, idBlob: null, pi });
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker">Before you start · ${esc(exam.code)}</div><h1>${esc(exam.title)}</h1><p>${exam.duration_min} minutes plus ${exam.grace_min} minutes grace · ${exam.total_marks || ''} marks · pass mark ${exam.pass_mark}%</p></div></div>
  <div class="grid2" style="align-items:start">
    <div class="stack">
      <div class="card"><h2>System checks</h2><div class="checks" id="checks"></div></div>
      <div class="card"><h2>Instructions to candidates</h2><ol style="padding-left:20px;margin:0">${(exam.instructions || []).map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join('') || '<li>Follow the invigilator\'s instructions.</li>'}</ol></div>
    </div>
    <div class="stack">
      <div class="card"><h2>Camera and screen</h2><div class="previews"><div><video id="pvCam" autoplay muted playsinline></video><small>Camera</small></div><div><video id="pvScr" autoplay muted playsinline></video><small>Shared screen</small></div></div>
        <div style="margin-top:10px"><small>Microphone level</small><div class="bars"><div class="track"><div id="mic" class="fill" style="width:0%;background:var(--ok)"></div></div></div></div></div>
      <div class="card"><h2>Identity check</h2><p class="muted">Hold your ID document next to your face so both are clearly visible, then take the photo.</p><div class="row"><button class="btn ghost" id="takeId" disabled>Take ID photo</button><img id="idImg" style="max-width:140px;border-radius:6px" class="hidden"></div></div>
      <div class="card"><h2>Declaration</h2>
        <label class="check"><input type="checkbox" id="decl"> <span>I am ${esc(S.user.full_name)}. I will write this exam on my own, with only the exam tab open, my phone on its stand as a side camera, and no notes, other people, websites or AI tools. I understand that my screen, camera, microphone and phone camera are monitored and recorded, and that misconduct leads to disqualification.</span></label>
        <div style="height:14px"></div>
        <button class="btn gold lg" id="startBtn" disabled style="width:100%">Start exam</button>
        <p class="hint" id="startHint">Complete all checks to start. The timer starts when you click Start.</p></div>
    </div>
  </div>`));
  bindShell();
  S.cleanup.push(() => { if (!XS.started) { stopStream(XS.cam); stopStream(XS.screen); } });

  const C = {
    device: { t: 'Chrome on Windows or macOS', ok: null },
    monitors: { t: 'Single screen only', ok: null },
    cam: { t: 'Camera and microphone', ok: null },
    screen: { t: 'Share your entire screen', ok: null },
    python: { t: 'Python and SQL workspace', ok: null },
    id: { t: 'ID photo', ok: null },
  };
  const draw = () => {
    $('#checks').innerHTML = Object.entries(C).map(([k, c]) => `<div class="chk ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : c.run ? 'run' : ''}"><div class="ic">${c.ok === true ? '✓' : c.ok === false ? '!' : c.run ? '…' : '·'}</div><div class="grow"><div class="t1">${c.t}</div><div class="t2">${esc(c.msg || '')}</div></div>${c.btn ? `<button class="btn sm ${c.ok ? 'ghost' : ''}" data-k="${k}">${c.btn}</button>` : ''}</div>`).join('');
    $$('#checks [data-k]').forEach(b => b.onclick = () => actions[b.dataset.k]());
    const allOk = Object.values(C).every(c => c.ok === true);
    $('#startBtn').disabled = !(allOk && $('#decl').checked);
    $('#takeId').disabled = !XS.cam;
  };
  $('#decl').onchange = draw;

  // device
  C.device.ok = pi.ok || staffTest; C.device.msg = `${pi.browser} on ${pi.os}` + (!pi.ok && staffTest ? ' (staff test mode, learners must use Chrome on Windows/macOS)' : !pi.ok ? '. Please open this page in Google Chrome on a Windows laptop or MacBook.' : '');
  const checkMon = () => { const ext = !!(window.screen && screen.isExtended); C.monitors.ok = !ext; C.monitors.msg = ext ? 'A second monitor is connected. Disconnect it, then re-check.' : 'One screen detected'; C.monitors.btn = ext ? 'Re-check' : null; draw(); };
  const actions = {
    monitors: checkMon,
    cam: async () => {
      C.cam.run = true; C.cam.msg = 'Allow camera and microphone in the browser prompt…'; draw();
      try {
        stopStream(XS.cam); XS.cam = await getCamMic();
        $('#pvCam').srcObject = XS.cam;
        C.cam.ok = true; C.cam.msg = XS.cam.getVideoTracks()[0].label || 'Working'; C.cam.btn = null;
        micMeter(XS.cam, v => { const m = $('#mic'); if (m) m.style.width = Math.min(100, v * 400) + '%'; });
      } catch (e) { C.cam.ok = false; C.cam.msg = 'Blocked or not found. Click the camera icon in the address bar, allow access, then try again.'; C.cam.btn = 'Try again'; }
      C.cam.run = false; draw();
    },
    screen: async () => {
      C.screen.run = true; C.screen.msg = 'Choose "Entire screen" in the sharing window…'; draw();
      try {
        stopStream(XS.screen); XS.screen = await getScreen();
        $('#pvScr').srcObject = XS.screen;
        C.screen.ok = true; C.screen.msg = 'Entire screen is shared'; C.screen.btn = 'Share again';
        XS.screen.getVideoTracks()[0].onended = () => { if (!XS.started) { C.screen.ok = false; C.screen.msg = 'Sharing stopped'; C.screen.btn = 'Share screen'; draw(); } };
      } catch (e) { C.screen.ok = false; C.screen.msg = e.message.includes('ENTIRE') ? e.message : 'Sharing was cancelled. You must share your entire screen.'; C.screen.btn = 'Share screen'; }
      C.screen.run = false; draw();
    },
    python: async () => {
      C.python.run = true; C.python.msg = 'Downloading the Python environment (about 30 MB, once)…'; draw();
      try {
        await PyRT.start(t => { C.python.msg = t; draw(); });
        C.python.ok = true; C.python.msg = 'Python 3 with pandas, numpy, matplotlib, scikit-learn and SQLite is ready'; C.python.btn = null;
      } catch (e) { C.python.ok = false; C.python.msg = 'Could not load: ' + e.message; C.python.btn = 'Retry'; PyRT.readyP = null; }
      C.python.run = false; draw();
    },
  };
  C.cam.btn = 'Allow camera'; C.screen.btn = 'Share screen'; C.id.msg = 'Take the photo on the right';
  checkMon(); draw();
  actions.python();
  if (window.screen && screen.addEventListener) { const f = () => checkMon(); screen.addEventListener('change', f); S.cleanup.push(() => screen.removeEventListener('change', f)); }

  $('#takeId').onclick = async () => {
    const b = await frameJpeg($('#pvCam'), 640, 0.8); if (!b) return toast('Camera not ready', 'bad');
    XS.idBlob = b; const img = $('#idImg'); img.src = URL.createObjectURL(b); img.classList.remove('hidden');
    C.id.ok = true; C.id.msg = 'Photo taken (you can retake it)'; draw();
  };
  $('#startBtn').onclick = async e => {
    if (!XS.screen || XS.screen.getVideoTracks()[0].readyState !== 'live') { C.screen.ok = false; draw(); return toast('Share your entire screen again', 'bad'); }
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (x) { }
    await busy(e.currentTarget, () => startExam()).catch(() => { try { document.exitFullscreen(); } catch (x) { } });
  };
});

// ---------- staff preview (no timer, no proctoring, nothing saved) ----------
on(/^#\/preview\/([\w-]+)$/, async (examId) => {
  const r = await api('exm_exam_get', { p_exam_id: examId });
  const exam = r.exam;
  const strip = q => { const o = { ...q }; ['answer', 'answers', 'correct', 'model_answer', 'tip', 'marking_guide'].forEach(k => delete o[k]); return o; };
  const qs = ((exam.paper && exam.paper.questions) || []).map(strip);
  if (!qs.length) { toast('Upload a question paper first', 'bad'); return go('#/exam/' + examId); }
  const t0 = Date.now();
  for (const k of Object.keys(XS)) delete XS[k];
  Object.assign(XS, {
    preview: true, examId, exam, examMeta: exam, attempt: { id: 'preview', phone_code: 'PREVIEW' }, paper: { questions: qs }, datasets: exam.datasets || [],
    offset: 0, deadline: t0 + exam.duration_min * 60000, hard: t0 + (exam.duration_min + exam.grace_min) * 60000,
    answers: {}, dirty: new Set(), cur: 0, events: [], seenWarn: new Set(), recentWarnText: {}, ended: false, cam: null, screen: null,
  });
  PyRT.start(() => { });
  if (shuffleOn()) orderQuestions('preview:0');
  buildRoom();
  const sb2 = $('#submitBtn'); sb2.textContent = 'Exit preview'; sb2.onclick = () => go(isAdmin(S.user) ? '#/exam/' + examId : '#/home');
  $('.xbar .title small').textContent = 'Staff preview · nothing is saved · timer and proctoring are off';
  $('#stat').innerHTML = '<span class="pill" style="background:var(--gold);color:var(--navy)">PREVIEW</span><button class="btn xs ghost" id="simShuf" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.3)">Simulate: learner leaves screen</button>';
  $('#simShuf').onclick = () => { XS.lastShuffle = 0; reshuffle('you left the exam screen'); };
  $('.side > div:first-child').innerHTML = '<h4>Learner camera</h4><div class="notice" style="font-size:13px">In the real exam the learner sees their own webcam here.</div>';
  $('#phoneStat').innerHTML = '<span class="pill">Paired by QR in the real exam</span>';
  loadDatasets();
  S.cleanup.push(() => { XS.ended = true; document.removeEventListener('copy', onCopy, true); document.removeEventListener('cut', onCopy, true); document.removeEventListener('paste', onPaste, true); document.removeEventListener('contextmenu', blockCtx, true); document.removeEventListener('keydown', onKeys, true); });
}, { staff: true });

function micMeter(stream, cb) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const d = new Float32Array(an.fftSize);
    let alive = true;
    const tick = () => { if (!alive) return; an.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; cb(Math.sqrt(s / d.length)); requestAnimationFrame(tick); };
    tick();
    const stop = () => { alive = false; ac.close(); };
    S.cleanup.push(stop);
    return { an, ac, stop };
  } catch (e) { return null; }
}

// ---------- exam room ----------
async function startExam() {
  const r = await api('exm_attempt_start', { p_exam_id: XS.examId, p_device: { ...XS.pi, started_ua: navigator.userAgent } });
  if (!r.paper) { toast(r.message || 'This exam has ended', 'bad'); try { document.exitFullscreen(); } catch (e) { } return go('#/home'); }
  XS.started = true;
  Object.assign(XS, {
    attempt: r.attempt, paper: r.paper, datasets: r.datasets || [], examMeta: r.exam || XS.exam,
    offset: new Date(r.server_now).getTime() - Date.now(),
    deadline: new Date(r.attempt.deadline_at).getTime(), hard: new Date(r.attempt.hard_deadline_at).getTime(),
    answers: r.attempt.answers || {}, dirty: new Set(), cur: 0, events: [], seenWarn: new Set(), recentWarnText: {}, clips: 0, ended: false,
    lastInternalCopy: '', phonePaired: !!r.attempt.phone_paired_at, phoneLastSeen: r.attempt.phone_last_seen,
  });
  // merge local backup (answers typed while offline)
  const local = store.get('ans.' + XS.attempt.id) || {};
  Object.entries(local).forEach(([k, v]) => { if (!XS.answers[k] || (v.t || 0) > (XS.answers[k].t || 0)) { XS.answers[k] = { ...(XS.answers[k] || {}), ...v }; XS.dirty.add(k); } });
  applyStoredOrder();
  S.lockNav = true;
  window.onbeforeunload = e => { if (!XS.ended) { e.preventDefault(); e.returnValue = ''; return ''; } };
  buildRoom();
  initProctoring();
  loadDatasets();
  if (XS.idBlob) uploadEvidence('snapshot_cam', XS.idBlob, { kind: 'id_check', severity: 'info', detail: { note: 'ID photo at start' } });
  logEv('device', 'info', { browser: XS.pi.browser, os: XS.pi.os, screen: XS.pi.screen });
  const needPhone = XS.examMeta.settings ? XS.examMeta.settings.require_phone !== false : true;
  if (needPhone && !XS.phonePaired) showPairing(true);
}

const Q = () => XS.paper.questions;

// ---------- question order: per-learner shuffle and reshuffle on integrity events ----------
function seededRand(seed) { let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffleArr(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const shuffleOn = () => !XS.examMeta || !XS.examMeta.settings || XS.examMeta.settings.shuffle !== false;
const reshuffleOn = () => !XS.examMeta || !XS.examMeta.settings || XS.examMeta.settings.reshuffle_on_flag !== false;
function orderQuestions(seed) {
  // keep sections in their order (A, B, C ...) and shuffle the questions and MCQ options inside each section
  const rnd = seededRand(seed);
  const qs = XS.original || (XS.original = XS.paper.questions.map(q => ({ ...q, options: q.options ? q.options.slice() : undefined })));
  const secs = [], by = {};
  qs.forEach(q => { const s = q.section || q.id[0]; if (!by[s]) { by[s] = []; secs.push(s); } by[s].push(q); });
  XS.paper.questions = secs.flatMap(s => shuffleArr(by[s].map(q => ({ ...q, options: q.options ? shuffleArr(q.options.slice(), rnd) : undefined })), rnd));
}
function applyStoredOrder() {
  if (!shuffleOn()) return;
  const n = (store.get('shuf.' + XS.attempt.id) || 0);
  XS.shuffleCount = n;
  orderQuestions(XS.attempt.id + ':' + n);
}
function reshuffle(reason) {
  if (XS.ended || !reshuffleOn() || !XS.paper) return;
  if (XS.lastShuffle && Date.now() - XS.lastShuffle < 15000) return;
  XS.lastShuffle = Date.now();
  const curId = Q()[XS.cur] && Q()[XS.cur].id;
  XS.shuffleCount = (XS.shuffleCount || 0) + 1;
  if (!XS.preview) store.set('shuf.' + XS.attempt.id, XS.shuffleCount);
  orderQuestions(XS.attempt.id + ':' + XS.shuffleCount + ':' + Date.now());
  const firstOpen = Q().findIndex(q => !answered(q));
  XS.cur = firstOpen >= 0 ? firstOpen : Math.max(0, Q().findIndex(q => q.id === curId));
  drawNav(); drawQ();
  logEv('questions_reshuffled', 'info', { reason, count: XS.shuffleCount });
  const box = $('#shufNote');
  if (box) { box.innerHTML = `<b>Questions reshuffled</b> because ${esc(reason)}. Your answers are saved; use the question numbers on the left to find any question.`; box.classList.remove('hidden'); clearTimeout(XS.shufT); XS.shufT = setTimeout(() => box.classList.add('hidden'), 12000); }
}
function answered(q) {
  const a = XS.answers[q.id]; if (!a) return false;
  if (q.type === 'mcq') return !!a.choice;
  return !!((a.text && a.text.trim()) || (a.cells && a.cells.some(c => c.code && c.code.trim())));
}

function buildRoom() {
  document.body.className = 'examroom';
  const ex = XS.examMeta;
  setApp(`
  <div class="xbar">
    <div class="brand"><img class="crest" src="${LOGO.white}" alt="Camblish Training Institute"></div>
    <div class="title grow">${esc(ex.title)}<small>${esc(S.user.full_name)} · ${esc(ex.code || '')}</small></div>
    <div class="status" id="stat"></div>
    <div class="timer" id="timer"><small>Time left</small><span>--:--</span></div>
    <button class="btn gold" id="submitBtn">Submit exam</button>
  </div>
  <div class="xmain">
    <aside class="qnav" id="qnav"></aside>
    <section class="qpane"><div id="shufNote" class="notice warn hidden" style="margin-bottom:14px"></div><div id="qpane"></div></section>
    <aside class="side">
      <div><h4>Your camera</h4><video id="selfCam" autoplay muted playsinline></video></div>
      <div class="card tight"><h4>Phone side camera</h4><div id="phoneStat" class="row"></div></div>
      <div class="card tight"><h4>Data files</h4><ul class="files" id="dfiles"><li class="muted">Loading…</li></ul><div class="hint">Files are in the working folder, so <code>pd.read_csv('file.csv')</code> works.</div></div>
      <div class="card tight"><h4>Python workspace</h4><div class="kernel" id="kernel">Starting…</div><div class="row" style="margin-top:8px"><button class="btn xs ghost" id="lsBtn">Show files</button><button class="btn xs ghost" id="rsBtn">Restart Python</button></div><div class="hint">All code cells share one Python session, like a notebook. Run the cell that loads your data before cells that use it.</div></div>
      <div class="card tight"><h4>Help</h4><div class="hint">Raise your hand on camera or type a message to the invigilator.</div><button class="btn xs ghost" id="helpBtn" style="margin-top:8px">Message invigilator</button></div>
    </aside>
  </div>
  <div id="lock" class="lock hidden"><div class="box"></div></div>`);
  $('#selfCam').srcObject = XS.cam;
  $('#submitBtn').onclick = () => confirmSubmit();
  $('#lsBtn').onclick = async () => { const fs = await PyRT.ls(); modal({ title: 'Files in your workspace', body: `<ul class="files">${fs.map(f => `<li>${esc(f.path)} <small class="muted">${fmtSize(f.size)}</small></li>`).join('') || '<li>No files</li>'}</ul>` }); };
  $('#rsBtn').onclick = async () => { if (!await confirmBox('Restart Python', 'This clears all variables. Your code stays. Data files are reloaded.', 'Restart')) return; $('#kernel').textContent = 'Restarting…'; await PyRT.restart(); $('#kernel').innerHTML = '<span class="dot ok"></span> Ready (restarted)'; logEv('python_restart', 'info'); };
  $('#helpBtn').onclick = async () => { const m = await promptBox('Message the invigilator', 'Your message', '', 'textarea'); if (m) { logEv('learner_message', 'warn', { message: m }); XS.live && XS.live.flag({ kind: 'learner_message', severity: 'warn', detail: { message: m } }); toast('Message sent to the invigilator', 'ok'); } };
  PyRT.readyP.then(() => { $('#kernel').innerHTML = '<span class="dot ok"></span> Ready'; }).catch(e => { $('#kernel').innerHTML = '<span class="dot bad"></span> Not available: ' + esc(e.message); });
  drawNav(); drawQ(); drawStatus(); drawPhone();
  tickTimer(); const tm = setInterval(tickTimer, 1000); S.cleanup.push(() => clearInterval(tm));
  // copy/paste control
  document.addEventListener('copy', onCopy, true); document.addEventListener('cut', onCopy, true); document.addEventListener('paste', onPaste, true);
  document.addEventListener('contextmenu', blockCtx, true); document.addEventListener('keydown', onKeys, true);
}

function drawNav() {
  const secs = {};
  Q().forEach((q, i) => { const s = q.section || q.id[0]; (secs[s] = secs[s] || []).push([q, i]); });
  const done = Q().filter(answered).length;
  $('#qnav').innerHTML = `<div class="row between" style="padding:0 6px"><b>${done}/${Q().length} answered</b></div>` + Object.entries(secs).map(([s, arr]) => `<h4>Section ${esc(s)} · ${arr.reduce((t, [q]) => t + (+q.marks || 0), 0)} marks</h4><div class="qs">${arr.map(([q, i]) => `<button class="qbtn ${answered(q) ? 'done' : ''} ${i === XS.cur ? 'on' : ''} ${XS.answers[q.id] && XS.answers[q.id].flag ? 'flag' : ''}" data-i="${i}" title="${esc(q.text.slice(0, 80))}">${esc(q.id)}</button>`).join('')}</div>`).join('') +
    `<div class="hint" style="margin:14px 6px">Green = answered. Gold dot = marked for review.</div>`;
  $$('#qnav [data-i]').forEach(b => b.onclick = () => { XS.cur = +b.dataset.i; drawQ(); drawNav(); });
}

function setAns(qid, patch) {
  XS.answers[qid] = { ...(XS.answers[qid] || {}), ...patch, t: Date.now() };
  XS.dirty.add(qid);
  if (!XS.preview) try { const lite = {}; Object.entries(XS.answers).forEach(([k, v]) => { lite[k] = { ...v, cells: v.cells ? v.cells.map(c => ({ ...c, imgs: [] })) : undefined }; }); store.set('ans.' + XS.attempt.id, lite); } catch (e) { }
  clearTimeout(XS.saveT); XS.saveT = setTimeout(() => saveNow(), 2500);
}

function drawQ() {
  const q = Q()[XS.cur]; if (!q) return;
  const a = XS.answers[q.id] || {};
  const prev = Q()[XS.cur - 1];
  const showCtx = q.context && (!prev || prev.context !== q.context || true);
  const pane = $('#qpane');
  pane.innerHTML = `
    <div class="qhead"><div class="row"><span class="qid">${esc(q.id)}</span><span class="muted">${esc(q.group || '')}</span></div><span class="pill gold">${q.marks} mark${q.marks == 1 ? '' : 's'}</span></div>
    ${showCtx ? `<details class="ctx" ${!prev || prev.context !== q.context ? 'open' : ''}><summary>Scenario and instructions</summary><div style="margin-top:8px">${esc(q.context)}</div></details>` : ''}
    <div class="qtext">${esc(q.text)}</div>
    <div id="ansArea"></div>
    <div class="row between" style="margin-top:20px">
      <button class="btn ghost" id="prevQ" ${XS.cur === 0 ? 'disabled' : ''}>← Previous</button>
      <label class="check" style="margin:0"><input type="checkbox" id="flagQ" ${a.flag ? 'checked' : ''}> Mark for review</label>
      <button class="btn" id="nextQ">${XS.cur === Q().length - 1 ? 'Review and submit' : 'Next →'}</button>
    </div>`;
  $('#prevQ').onclick = () => { XS.cur--; drawQ(); drawNav(); };
  $('#nextQ').onclick = () => { if (XS.cur === Q().length - 1) return confirmSubmit(); XS.cur++; drawQ(); drawNav(); };
  $('#flagQ').onchange = e => { setAns(q.id, { flag: e.target.checked }); drawNav(); };
  const area = $('#ansArea');
  if (q.type === 'mcq') {
    area.innerHTML = `<div class="opts">${(q.options || []).map((o, oi) => `<div class="opt ${a.choice === o.key ? 'sel' : ''}" data-k="${esc(o.key)}"><span class="k">${'abcdefgh'[oi]}</span><span>${esc(o.text)}</span></div>`).join('')}</div>`;
    $$('.opt', area).forEach(o => o.onclick = () => { setAns(q.id, { choice: o.dataset.k }); drawQ(); drawNav(); });
    return;
  }
  if (q.type === 'code') {
    const cells = a.cells && a.cells.length ? a.cells : [{ lang: /\bsql\b|query/i.test(q.text) && !/python/i.test(q.text) ? 'sql' : 'python', code: '', out: '', err: '', imgs: [] }];
    area.innerHTML = `<label>Your code</label><div class="cells" id="cells"></div><button class="btn xs ghost" id="addCell">+ Add code cell</button>
      <div class="field" style="margin-top:16px"><label>Your written answer / explanation of the output</label><textarea id="txt" placeholder="Explain your result, answer any written part of the question here.">${esc(a.text || '')}</textarea></div>`;
    const drawCells = () => {
      $('#cells').innerHTML = '';
      cells.forEach((c, ci) => $('#cells').appendChild(cellEl(q, cells, ci, drawCells)));
    };
    drawCells();
    $('#addCell').onclick = () => { cells.push({ lang: 'python', code: '', out: '', err: '', imgs: [] }); setAns(q.id, { cells }); drawCells(); };
    $('#txt').oninput = e => setAns(q.id, { text: e.target.value, cells });
    return;
  }
  area.innerHTML = `<label>Your answer</label><textarea id="txt" style="min-height:260px" placeholder="Type your answer here.">${esc(a.text || '')}</textarea><div class="hint" id="wc"></div>`;
  const wc = () => { const n = ($('#txt').value.trim().match(/\S+/g) || []).length; $('#wc').textContent = n + ' words'; };
  $('#txt').oninput = e => { setAns(q.id, { text: e.target.value }); wc(); drawNavLater(); };
  wc();
}
let navT; function drawNavLater() { clearTimeout(navT); navT = setTimeout(drawNav, 800); }

function cellEl(q, cells, ci, redraw) {
  const c = cells[ci];
  const dbs = PyRT.files.filter(f => /\.(db|sqlite3?)$/i.test(f.name)).map(f => f.name).concat(XS.extraDbs || []);
  const uniq = [...new Set(dbs)];
  const e = el(`<div class="cell"><div class="bar">
    <select class="lang"><option value="python" ${c.lang === 'python' ? 'selected' : ''}>Python</option><option value="sql" ${c.lang === 'sql' ? 'selected' : ''}>SQL</option></select>
    <span class="dbw ${c.lang === 'sql' ? '' : 'hidden'}">on <select class="db">${uniq.map(d => `<option ${c.db === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}<option value="__other">other file…</option></select></span>
    <span class="grow muted">Ctrl/Cmd + Enter to run</span>
    <button class="btn xs run">▶ Run</button>${cells.length > 1 ? '<button class="btn xs ghost del">Remove</button>' : ''}</div>
    <textarea class="code" spellcheck="false" placeholder="${c.lang === 'sql' ? 'SELECT ...' : '# Python code'}">${esc(c.code)}</textarea>
    <div class="out ${c.out || c.err || (c.imgs && c.imgs.length) ? '' : 'empty'}"></div></div>`);
  const ta = $('textarea', e), out = $('.out', e);
  const paintOut = () => {
    out.innerHTML = (c.out ? esc(c.out) : '') + (c.err ? `<span class="err">${esc(c.err)}</span>` : '') + (c.imgs || []).map(b => `<img src="data:image/png;base64,${b}">`).join('');
    out.classList.toggle('empty', !(c.out || c.err || (c.imgs && c.imgs.length)));
  };
  paintOut();
  const autoH = () => { ta.style.height = 'auto'; ta.style.height = Math.max(120, Math.min(600, ta.scrollHeight + 4)) + 'px'; };
  setTimeout(autoH, 0);
  ta.oninput = () => { c.code = ta.value; setAns(q.id, { cells }); autoH(); drawNavLater(); };
  ta.onkeydown = ev => {
    if (ev.key === 'Tab') { ev.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); ta.oninput(); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) { ev.preventDefault(); runIt(); }
  };
  $('.lang', e).onchange = ev => { c.lang = ev.target.value; if (c.lang === 'sql' && !c.db) c.db = uniq[0] || ''; setAns(q.id, { cells }); redraw(); };
  const dbSel = $('.db', e);
  if (dbSel) { if (!c.db && uniq[0]) c.db = uniq[0]; dbSel.onchange = async ev => { if (ev.target.value === '__other') { const n = await promptBox('SQLite database file', 'File name in your workspace (e.g. electronics.db created by your Python code)', ''); if (n) { XS.extraDbs = [...(XS.extraDbs || []), n]; c.db = n; } setAns(q.id, { cells }); redraw(); } else { c.db = ev.target.value; setAns(q.id, { cells }); } }; }
  const del = $('.del', e); if (del) del.onclick = async () => { if (await confirmBox('Remove cell', 'Remove this code cell and its output?', 'Remove', 'danger')) { cells.splice(ci, 1); setAns(q.id, { cells }); redraw(); } };
  const runIt = async () => {
    const btn = $('.run', e); btn.disabled = true; btn.textContent = 'Running…';
    out.classList.remove('empty'); out.innerHTML = '<span style="color:#8fa0c8">Running…</span>';
    if (PyRT.status !== 'ready') out.innerHTML = '<span style="color:#8fa0c8">Waiting for Python to finish loading…</span>';
    const r = await PyRT.run(c.lang, c.code, c.db);
    if (r.timeout) { c.out = ''; c.err = 'This cell ran for more than 2 minutes and was stopped. Python will restart; run your earlier cells again.'; c.imgs = []; PyRT.restart(); }
    else { c.out = r.out || ''; c.err = r.err || ''; c.imgs = (r.imgs || []).slice(0, 4); if (!c.out && !c.err && !c.imgs.length) c.out = '(ran with no output)'; }
    setAns(q.id, { cells }); paintOut(); btn.disabled = false; btn.textContent = '▶ Run';
  };
  $('.run', e).onclick = runIt;
  return e;
}

async function loadDatasets() {
  const ds = XS.datasets || [];
  if (!ds.length) { $('#dfiles').innerHTML = '<li class="muted">No data files for this exam</li>'; return; }
  try {
    const { urls } = await fn('sign', { paths: ds.map(d => d.path), expires: 3600 * 5 });
    $('#dfiles').innerHTML = ds.map(d => `<li data-n="${esc(d.name)}">${esc(d.name)} <small class="muted">loading…</small></li>`).join('');
    for (const d of ds) {
      const li = $(`#dfiles [data-n="${CSS.escape(d.name)}"] small`);
      try {
        const res = await fetch(urls[d.path]); if (!res.ok) throw new Error(res.status);
        const buf = await res.arrayBuffer();
        PyRT.files = PyRT.files.filter(f => f.name !== d.name).concat([{ name: d.name, buf: buf.slice(0) }]);
        await PyRT.addFile(d.name, buf);
        if (li) li.textContent = fmtSize(d.size || buf.byteLength) + ' ✓';
      } catch (e) { if (li) li.innerHTML = '<span style="color:var(--bad)">failed</span>'; }
    }
    if (Q()[XS.cur] && Q()[XS.cur].type === 'code') drawQ();
  } catch (e) { $('#dfiles').innerHTML = `<li style="color:var(--bad)">Could not load data files: ${esc(e.message)}</li>`; }
}

// ---------- timer, saving ----------
function now() { return Date.now() + XS.offset; }
function tickTimer() {
  if (XS.ended) return;
  if (XS.preview) { const tm = $('#timer'); if (tm) tm.innerHTML = `<small>Duration</small><span>${XS.examMeta.duration_min} min</span>`; return; }
  const t = now(), tm = $('#timer'); if (!tm) return;
  if (t < XS.deadline) {
    const left = XS.deadline - t;
    tm.className = 'timer' + (left < 10 * 60000 ? ' low' : '');
    tm.innerHTML = `<small>Time left</small><span>${fmtDur(left)}</span>`;
    [30, 10, 5, 1].forEach(m => { if (left < m * 60000 && !XS['w' + m]) { XS['w' + m] = true; if (left > (m - 1) * 60000) toast(`${m} minute${m > 1 ? 's' : ''} left`, m <= 5 ? 'bad' : ''); } });
  } else if (t < XS.hard) {
    tm.className = 'timer grace';
    tm.innerHTML = `<small>Grace period · submit now</small><span>${fmtDur(XS.hard - t)}</span>`;
    if (!XS.graceShown) { XS.graceShown = true; modal({ title: 'Time is up: grace period', body: `<p>The ${XS.examMeta.duration_min} minutes are over. You have <b>${Math.round((XS.hard - XS.deadline) / 60000)} minutes</b> grace to finish and submit. The exam will then submit itself automatically.</p>`, actions: [{ label: 'OK' }] }); logEv('grace_started', 'info'); }
  } else {
    if (!XS.autoSubmitting) { XS.autoSubmitting = true; doSubmit(true); }
  }
}
async function saveNow() {
  if (XS.preview) { XS.dirty.clear(); return; }
  if (XS.ended || XS.saving) return;
  XS.saving = true;
  const keys = [...XS.dirty]; XS.dirty.clear();
  const patch = {}; keys.forEach(k => patch[k] = XS.answers[k]);
  try {
    const r = await api('exm_attempt_save', { p_attempt_id: XS.attempt.id, p_answers: patch });
    XS.offset = new Date(r.server_now).getTime() - Date.now();
    XS.deadline = new Date(r.deadline_at).getTime(); XS.hard = new Date(r.hard_deadline_at).getTime();
    XS.phonePaired = !!r.phone_paired_at; XS.phoneLastSeen = r.phone_last_seen; drawPhone();
    XS.lastSaved = Date.now(); XS.saveErr = null;
    (r.warnings || []).forEach(w => { if (!XS.seenWarn.has(w.id)) { XS.seenWarn.add(w.id); if (!XS.recentWarnText[w.message] || Date.now() - XS.recentWarnText[w.message] > 120000) showWarn(w.message); } });
    if (r.status !== 'in_progress') endExam(r.status);
  } catch (e) { keys.forEach(k => XS.dirty.add(k)); XS.saveErr = e.message; }
  XS.saving = false; drawStatus();
}
function showWarn(message) {
  XS.recentWarnText[message] = Date.now();
  try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=').play(); } catch (e) { }
  modal({ title: 'Message from the invigilator', body: `<div class="notice warn" style="font-size:16px">${esc(message)}</div>`, actions: [{ label: 'I understand', onClick: () => logEv('warning_acknowledged', 'info', { message }) }], closable: false });
}
function drawStatus() {
  const s = $('#stat'); if (!s) return;
  const live = st => st && st.getTracks().some(t => t.readyState === 'live');
  const scr = live(XS.screen), cam = XS.cam && XS.cam.getVideoTracks().some(t => t.readyState === 'live'), mic = XS.cam && XS.cam.getAudioTracks().some(t => t.readyState === 'live');
  const saved = XS.saveErr ? '<span class="pill bad">Not saved, retrying</span>' : XS.lastSaved ? `<span class="pill">Saved ${fmtT(XS.lastSaved)}</span>` : '';
  s.innerHTML = `<span class="pill"><span class="dot ${scr ? 'ok' : 'bad'}"></span>Screen</span><span class="pill"><span class="dot ${cam ? 'ok' : 'bad'}"></span>Camera</span><span class="pill"><span class="dot ${mic ? 'ok' : 'bad'}"></span>Mic</span><span class="pill"><span class="dot ${phoneOk() ? 'ok' : 'warn'}"></span>Phone</span>${saved}`;
}
function phoneOk() { return XS.phonePaired && XS.phoneLastSeen && (now() - new Date(XS.phoneLastSeen).getTime() < 90000); }
function drawPhone() {
  const p = $('#phoneStat'); if (!p) return;
  p.innerHTML = phoneOk() ? '<span class="pill ok">Connected</span>' : XS.phonePaired ? '<span class="pill warn">Not seen recently</span><button class="btn xs ghost" id="rePair">Show QR</button>' : '<span class="pill bad">Not paired</span><button class="btn xs" id="rePair">Pair phone</button>';
  const b = $('#rePair'); if (b) b.onclick = () => showPairing(false);
  drawStatus();
}
async function showPairing(first) {
  await loadScript(LIBS.qr).catch(() => { });
  const base = location.origin + location.pathname;
  const url = base + '?phone=' + XS.attempt.phone_code;
  const body = el(`<div style="text-align:center">
    <p>Scan this code with your phone's camera. Place the phone on a stand to your side, about 1 m away, so it shows <b>you, your hands, your desk and your laptop screen</b>. Keep it plugged in.</p>
    <div class="qr" id="qrbox"></div>
    <p>Or type <b>${esc(base)}?phone</b> into your phone's browser and enter this code:</p><div class="code-big">${esc(XS.attempt.phone_code)}</div>
    <p id="pairState" class="muted" style="margin-top:12px">Waiting for your phone…</p></div>`);
  const m = modal({
    title: 'Pair your phone as a side camera', body, closable: !first,
    actions: [{ label: first ? 'Continue without phone (the invigilator is notified)' : 'Close', cls: 'ghost', onClick: () => { if (first && !phoneOk()) { logEv('phone_not_paired', 'high', { note: 'Learner continued without pairing a phone' }); XS.live && XS.live.flag({ kind: 'phone_not_paired', severity: 'high' }); } } }],
  });
  try { new QRCode($('#qrbox', body), { text: url, width: 200, height: 200, colorDark: '#0B1F4B' }); } catch (e) { $('#qrbox', body).textContent = url; }
  const iv = setInterval(async () => {
    await saveNow();
    if (phoneOk()) { $('#pairState', body).innerHTML = '<span class="pill ok">Phone connected</span>'; clearInterval(iv); setTimeout(() => m.close(), 1200); }
  }, 4000);
  S.cleanup.push(() => clearInterval(iv));
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { clearInterval(iv); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

// ---------- submit ----------
async function confirmSubmit() {
  const un = Q().filter(q => !answered(q));
  const fl = Q().filter(q => XS.answers[q.id] && XS.answers[q.id].flag);
  const ok = await confirmBox('Submit your exam?', `You answered <b>${Q().length - un.length} of ${Q().length}</b> questions.${un.length ? `<br><br>Not answered: ${un.map(q => esc(q.id)).join(', ')}` : ''}${fl.length ? `<br><br>Marked for review: ${fl.map(q => esc(q.id)).join(', ')}` : ''}<br><br>After submitting you cannot change your answers.`, 'Submit final answers', 'gold');
  if (ok) doSubmit(false);
}
async function doSubmit(auto) {
  if (XS.ended) return;
  clearTimeout(XS.saveT);
  const lock = $('#lock'); lock.classList.remove('hidden'); $('.box', lock).innerHTML = `<h2>${auto ? 'Time is up' : 'Submitting'}…</h2><p>Saving your final answers. Do not close this tab.</p>`;
  const patch = {}; [...XS.dirty].forEach(k => patch[k] = XS.answers[k]);
  for (let i = 0; i < 5; i++) {
    try {
      await api('exm_attempt_submit', { p_attempt_id: XS.attempt.id, p_answers: patch, p_auto: !!auto });
      automark({ attempt_id: XS.attempt.id }); // silent: marks are saved as an unreleased draft for staff only
      logEv('submitted', 'info', { auto }); await flushEvents();
      return endExam(auto ? 'auto_submitted' : 'submitted');
    } catch (e) {
      if (/already submitted/i.test(e.message)) return endExam('submitted');
      $('.box', lock).innerHTML = `<h2>Retrying…</h2><p>${esc(e.message)}. Check your internet connection. Do not close this tab.</p>`;
      await sleep(3000 * (i + 1));
    }
  }
  $('.box', lock).innerHTML = `<h2>Could not submit</h2><p>Your answers are saved on the server up to ${fmtT(XS.lastSaved)}. Tell the invigilator immediately.</p><button class="btn gold" id="retrySub">Try again</button>`;
  $('#retrySub').onclick = () => doSubmit(auto);
}
function endExam(status) {
  if (XS.ended) return;
  XS.ended = true;
  stopProctoring();
  window.onbeforeunload = null; S.lockNav = false;
  store.del('ans.' + XS.attempt.id);
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { }
  document.removeEventListener('copy', onCopy, true); document.removeEventListener('cut', onCopy, true); document.removeEventListener('paste', onPaste, true);
  document.removeEventListener('contextmenu', blockCtx, true); document.removeEventListener('keydown', onKeys, true);
  document.body.className = '';
  $$('.overlay').forEach(o => o.remove());
  const msg = { submitted: 'Your exam has been submitted.', auto_submitted: 'Time ran out and your exam was submitted automatically.', terminated: 'Your exam was ended by the invigilator.' }[status] || 'Your exam has ended.';
  setApp(`<div class="auth"><div class="side"><div class="brand"><img class="crest" src="${LOGO.white}" alt="Camblish Training Institute"><div>Camblish Training Institute<small>Taking the Lead, Shaping the Future</small></div></div><div><div class="tag">${esc(XS.examMeta.title)}</div><h1>${esc(msg)}</h1><p>Thank you, ${esc(S.user.full_name)}. Your answers are saved. Once your work has been marked and moderated, your results and a short report with ways to improve will be emailed to ${esc(S.user.email)}.</p></div><small></small></div>
    <div class="formside"><div class="box"><h2>You may now close this tab.</h2><p>Stop screen sharing if Chrome still shows the sharing bar, and close the phone camera page.</p><a class="btn" href="#/home" onclick="setTimeout(()=>location.reload(),50)">Back to my exams</a></div></div></div>`);
}

// ---------- proctoring ----------
function logEv(kind, severity = 'info', detail = {}) {
  if (!XS.attempt || XS.preview) return;
  XS.events.push({ kind, severity, detail, at: new Date(now()).toISOString() });
  if (severity !== 'info' && XS.live) XS.live.flag({ kind, severity, detail });
  if (XS.events.length > 40) flushEvents();
}
async function flushEvents() {
  if (!XS.events.length || !XS.attempt) return;
  const batch = XS.events.splice(0, 150);
  try { await api('exm_event_log', { p_attempt_id: XS.attempt.id, p_events: batch }); } catch (e) { XS.events.unshift(...batch); }
}
async function uploadEvidence(kind, blob, event) {
  if (!blob || !XS.attempt) return;
  try {
    const r = await fn('upload', { attempt_id: XS.attempt.id, kind, content_type: blob.type || 'image/jpeg', data_base64: await blobToB64(blob), ...(event ? { event } : {}) });
    if (event && XS.live) XS.live.flag({ kind: event.kind, severity: event.severity, detail: event.detail, evidence_path: r.path });
    return r.path;
  } catch (e) { if (event) logEv(event.kind, event.severity, { ...(event.detail || {}), evidence_failed: true }); }
}
const throttle = {};
function once(key, ms) { const t = Date.now(); if (throttle[key] && t - throttle[key] < ms) return false; throttle[key] = t; return true; }
async function flagWithEvidence(kind, severity, detail, { screen = false, clip = false } = {}) {
  const v = screen ? XS.scrVideo : $('#selfCam');
  const b = await frameJpeg(v, screen ? 1280 : 480, 0.6);
  if (b) uploadEvidence(screen ? 'snapshot_screen' : 'snapshot_cam', b, { kind, severity, detail });
  else logEv(kind, severity, detail);
  if (clip) recordClip(kind);
}
function recordClip(kind) {
  if (XS.clips >= 25 || XS.recording || !XS.cam || typeof MediaRecorder === 'undefined') return;
  XS.recording = true; XS.clips++;
  try {
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(XS.cam, { mimeType: mime, videoBitsPerSecond: 250000, audioBitsPerSecond: 32000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => { XS.recording = false; const b = new Blob(chunks, { type: 'video/webm' }); uploadEvidence('clip', b, { kind: kind + '_clip', severity: 'info', detail: { seconds: 12 } }); };
    rec.start(); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 12000);
  } catch (e) { XS.recording = false; }
}

function lockScreen(html, btnLabel, onBtn) {
  const lock = $('#lock'); if (!lock) return;
  lock.classList.remove('hidden');
  $('.box', lock).innerHTML = html + (btnLabel ? `<div style="margin-top:16px"><button class="btn gold lg" id="lockBtn">${esc(btnLabel)}</button></div>` : '');
  if (btnLabel) $('#lockBtn').onclick = onBtn;
}
function unlock() { const l = $('#lock'); if (l && !XS.ended) l.classList.add('hidden'); }
function checkLocks() {
  if (XS.ended) return;
  const scrLive = XS.screen && XS.screen.getVideoTracks().some(t => t.readyState === 'live');
  const camLive = XS.cam && XS.cam.getVideoTracks().some(t => t.readyState === 'live');
  if (!scrLive) return lockScreen('<h2>Screen sharing stopped</h2><p>Your exam is paused on this screen until you share your <b>entire screen</b> again. The timer keeps running and the invigilator has been notified.</p>', 'Share entire screen', async () => {
    try { XS.screen = await getScreen(); XS.scrVideo.srcObject = XS.screen; XS.screen.getVideoTracks()[0].onended = onScreenEnded; XS.live && XS.live.setStreams({ cam: XS.cam, screen: XS.screen }); logEv('screen_share_restored', 'info'); checkLocks(); drawStatus(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  if (!camLive) return lockScreen('<h2>Camera stopped</h2><p>Your camera must stay on for the whole exam.</p>', 'Turn camera on', async () => {
    try { stopStream(XS.cam); XS.cam = await getCamMic(); $('#selfCam').srcObject = XS.cam; watchCam(); XS.live && XS.live.setStreams({ cam: XS.cam, screen: XS.screen }); startAudioWatch(); logEv('camera_restored', 'info'); checkLocks(); drawStatus(); }
    catch (e) { toast('Camera blocked. Allow it in the address bar.', 'bad'); }
  });
  if (!document.fullscreenElement) return lockScreen('<h2>Return to full screen</h2><p>The exam must stay in full screen. Leaving full screen has been recorded.</p>', 'Return to full screen', async () => { try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { } checkLocks(); });
  unlock();
}
function onScreenEnded() { if (XS.ended) return; flagWithEvidence('screen_share_stopped', 'high', {}); checkLocks(); drawStatus(); }
function watchCam() { XS.cam.getVideoTracks().forEach(t => { t.onended = () => { if (XS.ended) return; logEv('camera_stopped', 'high'); checkLocks(); drawStatus(); }; t.onmute = () => !XS.ended && once('cammute', 30000) && logEv('camera_muted', 'warn'); }); XS.cam.getAudioTracks().forEach(t => { t.onended = () => !XS.ended && logEv('microphone_stopped', 'high'); }); }

function initProctoring() {
  XS.scrVideo = document.createElement('video'); XS.scrVideo.muted = true; XS.scrVideo.playsInline = true; XS.scrVideo.srcObject = XS.screen; XS.scrVideo.play().catch(() => { });
  XS.screen.getVideoTracks()[0].onended = onScreenEnded;
  watchCam();
  // focus, visibility, fullscreen
  const onVis = () => { if (XS.ended) return; if (document.hidden) { XS.hiddenAt = Date.now(); flagWithEvidence('left_exam_tab', 'high', {}, { screen: true }); } else if (XS.hiddenAt) { logEv('returned_to_tab', 'warn', { seconds: Math.round((Date.now() - XS.hiddenAt) / 1000) }); XS.hiddenAt = null; reshuffle('you left the exam screen'); } };
  const onBlur = () => { if (XS.ended) return; XS.blurAt = Date.now(); setTimeout(() => { if (XS.blurAt && !document.hasFocus() && !document.hidden && once('blur', 20000)) flagWithEvidence('focus_left_exam', 'warn', { note: 'Clicked outside the exam (another window or app)' }, { screen: true }); }, 2500); };
  const onFocus = () => { if (XS.blurAt) { const s = Math.round((Date.now() - XS.blurAt) / 1000); if (s >= 3) { logEv('focus_returned', 'info', { seconds: s }); reshuffle('you clicked outside the exam window'); } XS.blurAt = null; } };
  const onFs = () => { if (XS.ended) return; if (!document.fullscreenElement) { logEv('fullscreen_exit', 'warn'); } checkLocks(); };
  const onScr = () => { if (screen.isExtended && once('mon', 30000)) flagWithEvidence('second_monitor_connected', 'high', {}, { screen: true }); };
  const onResize = () => { if (once('rs', 15000) && window.outerWidth - window.innerWidth > 200) logEv('window_resized', 'info', { note: 'Possible developer tools or side panel' }); };
  document.addEventListener('visibilitychange', onVis); window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
  document.addEventListener('fullscreenchange', onFs); window.addEventListener('resize', onResize);
  if (screen.addEventListener) screen.addEventListener('change', onScr);
  window.addEventListener('online', () => { logEv('back_online', 'info'); saveNow(); });
  window.addEventListener('offline', () => { XS.offAt = Date.now(); toast('You are offline. Keep working; your answers will save when you reconnect.', 'bad'); });
  S.cleanup.push(() => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('resize', onResize); if (screen.removeEventListener) screen.removeEventListener('change', onScr); });
  checkLocks();
  // loops
  const snapSec = Math.max(10, (XS.examMeta.settings && XS.examMeta.settings.snapshot_sec) || 30);
  XS.loops = [
    setInterval(() => saveNow(), 20000),
    setInterval(() => flushEvents(), 10000),
    setInterval(() => { drawStatus(); drawPhone(); checkLocks(); }, 5000),
    setInterval(async () => { if (XS.ended) return; const [c, s] = await Promise.all([frameJpeg($('#selfCam'), 320, 0.55), frameJpeg(XS.scrVideo, 1024, 0.5)]); uploadEvidence('snapshot_cam', c); uploadEvidence('snapshot_screen', s); }, snapSec * 1000),
    setInterval(() => { if (XS.phonePaired && !phoneOk() && once('phonegone', 120000)) logEv('phone_camera_offline', 'warn'); }, 30000),
  ];
  startAudioWatch();
  startFaceWatch();
  // live view for invigilators
  XS.live = new LiveSender({ examId: XS.examId, attemptId: XS.attempt.id, role: 'laptop', name: S.user.full_name });
  XS.live.on('phoneflag', p => { if (/phone_moved|picked_up|phone_page_hidden|orientation/.test(p.kind || '')) reshuffle(p.kind === 'phone_page_hidden' ? 'your phone left the camera page' : 'movement was detected on your phone'); }).on('warn', p => { showWarn(p.message); }).on('extend', () => { saveNow(); toast('The invigilator changed your time', 'ok'); }).on('end', () => saveNow());
  XS.live.setStreams({ cam: XS.cam, screen: XS.screen });
  XS.live.start().catch(e => console.warn(e));
  setTimeout(() => saveNow(), 3000);
}
function stopProctoring() {
  (XS.loops || []).forEach(clearInterval);
  flushEvents();
  if (XS.live) XS.live.stop();
  if (XS.audio) XS.audio.stop();
  XS.faceStop && XS.faceStop();
  stopStream(XS.cam); stopStream(XS.screen);
}
function startAudioWatch() {
  if (XS.audio) XS.audio.stop();
  let base = [], loud = 0;
  XS.audio = micMeter(XS.cam, v => {
    if (XS.ended) return;
    if (base.length < 600) { base.push(v); return; }
    const sorted = XS._bs || (XS._bs = base.slice().sort((a, b) => a - b));
    const thr = Math.max(0.03, sorted[Math.floor(sorted.length * 0.9)] * 3);
    loud = v > thr ? loud + 1 : Math.max(0, loud - 0.5);
    if (loud > 240 && once('sound', 60000)) { loud = 0; flagWithEvidence('sustained_speech_or_noise', 'warn', { level: +v.toFixed(3) }, { clip: true }); }
  });
}
async function startFaceWatch() {
  try {
    const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const vision = await import(V + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(V + '/wasm');
    const det = await vision.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.55 });
    let none = 0, many = 0, away = 0, stop = false;
    XS.faceStop = () => { stop = true; try { det.close(); } catch (e) { } };
    const loop = () => {
      if (stop || XS.ended) return;
      const v = $('#selfCam');
      if (v && v.readyState >= 2) {
        try {
          const r = det.detectForVideo(v, performance.now());
          const n = r.detections.length;
          none = n === 0 ? none + 1 : 0;
          many = n > 1 ? many + 1 : 0;
          if (n === 1) { const b = r.detections[0].boundingBox; const cx = (b.originX + b.width / 2) / v.videoWidth; away = (cx < 0.18 || cx > 0.82) ? away + 1 : 0; } else away = 0;
          if (none === 5 && once('noface', 45000)) flagWithEvidence('no_face_visible', 'warn', { seconds: 8 });
          if (many === 2 && once('many', 45000)) flagWithEvidence('more_than_one_person', 'high', { faces: n }, { clip: true });
          if (away === 8 && once('away', 60000)) flagWithEvidence('face_turned_away', 'warn', {});
        } catch (e) { }
      }
      setTimeout(loop, 1600);
    };
    loop();
    logEv('face_monitor_on', 'info');
  } catch (e) { logEv('face_monitor_unavailable', 'info', { error: String(e.message || e).slice(0, 120) }); }
}
function onCopy(e) { const s = String(window.getSelection() || '') || (e.target && e.target.value ? e.target.value.substring(e.target.selectionStart, e.target.selectionEnd) : ''); XS.lastInternalCopy = s; }
function onPaste(e) {
  if (XS.preview) return;
  const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (!t) return;
  const norm = s => s.replace(/\s+/g, ' ').trim();
  if (XS.lastInternalCopy && norm(XS.lastInternalCopy).includes(norm(t))) return;
  e.preventDefault();
  toast('Pasting from outside the exam is not allowed. This has been recorded.', 'bad');
  flagWithEvidence('paste_from_outside_blocked', 'high', { chars: t.length, sample: t.slice(0, 200) }, { screen: true });
}
function blockCtx(e) { if (!e.target.closest('textarea,input')) e.preventDefault(); }
function onKeys(e) {
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && ['p', 's', 'u'].includes(k)) { e.preventDefault(); }
  if (k === 'printscreen') { logEv('printscreen_key', 'warn'); }
  if (e.key === 'F12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(k))) { e.preventDefault(); logEv('developer_tools_attempt', 'warn'); }
}

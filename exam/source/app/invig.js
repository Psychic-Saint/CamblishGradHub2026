// Camblish Online Exam: invigilator wall
// Author: Eddie Bila
const EV_LABEL = {
  started: 'Started the exam', resumed: 'Resumed the exam', submitted: 'Submitted', auto_submitted: 'Auto-submitted at time limit', device: 'Device details', id_check: 'ID photo taken',
  left_exam_tab: 'Left the exam tab', returned_to_tab: 'Returned to the exam tab', focus_left_exam: 'Clicked outside the exam window', focus_returned: 'Focus returned',
  fullscreen_exit: 'Left full screen', screen_share_stopped: 'Stopped screen sharing', screen_share_restored: 'Screen sharing restored', camera_stopped: 'Camera stopped', camera_muted: 'Camera blocked or covered', camera_restored: 'Camera restored', microphone_stopped: 'Microphone stopped',
  second_monitor_connected: 'Second monitor connected', paste_from_outside_blocked: 'Tried to paste text from outside', no_face_visible: 'No face visible', more_than_one_person: 'More than one person in view', face_turned_away: 'Face turned away from screen',
  sustained_speech_or_noise: 'Talking or noise detected', phone_not_paired: 'Continued without a phone camera', phone_paired: 'Phone camera paired', phone_camera_on: 'Phone camera on', phone_camera_offline: 'Phone camera offline', phone_page_hidden: 'Left the camera page on the phone',
  phone_page_returned: 'Returned to the phone camera page', phone_moved_or_picked_up: 'Phone moved or picked up', phone_orientation_changed: 'Phone rotated', phone_camera_stopped: 'Phone camera stopped', phone_motion_sensor_blocked: 'Phone motion sensor blocked',
  learner_message: 'Message from learner', warning_acknowledged: 'Learner acknowledged a warning', warn: 'Warning sent', note: 'Invigilator note', extend: 'Time changed', terminate: 'Exam terminated', reopen: 'Exam reopened',
  grace_started: 'Entered grace period', python_restart: 'Restarted Python', printscreen_key: 'Pressed Print Screen', developer_tools_attempt: 'Tried to open developer tools', window_resized: 'Window resized', back_online: 'Back online',
  questions_reshuffled: 'Questions reshuffled', face_monitor_on: 'Face monitor running', face_monitor_unavailable: 'Face monitor unavailable on this laptop', heartbeat: 'Phone heartbeat',
};
const evLabel = k => EV_LABEL[k] || (k || '').replace(/_clip$/, ' (video clip)').replace(/_/g, ' ');
const evDetail = d => { if (!d) return ''; const x = []; if (d.message) x.push('"' + d.message + '"'); if (d.text) x.push(d.text); if (d.seconds) x.push(d.seconds + ' s'); if (d.minutes) x.push((d.minutes > 0 ? '+' : '') + d.minutes + ' min'); if (d.reason) x.push(d.reason); if (d.by) x.push('by ' + d.by); if (d.note) x.push(d.note); if (d.sample) x.push('pasted: "' + String(d.sample).slice(0, 60) + '"'); return x.join(' · '); };

on(/^#\/invig\/([\w-]+)$/, async (examId) => {
  const W = { examId, attempts: [], events: [], media: {}, sound: true, live: null, server: 0, offset: 0 };
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker">Invigilation · live</div><h1 id="xt">Loading…</h1><p id="xs"></p></div>
    <div class="row"><label class="check" style="margin:0"><input type="checkbox" id="snd" checked> Sound on alerts</label><button class="btn ghost" id="msgAll">Message all learners</button><a class="btn ghost" href="#/mark/${examId}">Marking</a></div></div>
  <div class="wall"><div><div class="tiles" id="tiles"></div></div>
  <div class="card tight"><div class="row between"><h3 style="margin:0">Alerts</h3><select id="fsev" style="width:auto"><option value="warn">Warnings and above</option><option value="high">Serious only</option><option value="info">Everything</option></select></div><div class="feed" id="feed"></div></div></div>`));
  bindShell();
  $('#snd').onchange = e => W.sound = e.target.checked;
  $('#fsev').onchange = () => drawFeed();
  const beep = () => { if (!W.sound) return; try { const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .5); o.start(); o.stop(ac.currentTime + .5); setTimeout(() => ac.close(), 800); } catch (e) { } };

  const load = async () => {
    const r = await api('exm_invig_overview', { p_exam_id: examId });
    W.exam = r.exam; W.attempts = r.attempts || []; W.offset = new Date(r.server_now).getTime() - Date.now();
    const known = new Set(W.events.map(e => e.id));
    (r.events || []).forEach(e => { if (!known.has(e.id)) W.events.push(e); });
    W.events = W.events.filter(e => e.kind !== 'heartbeat').sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 500);
    $('#xt').textContent = W.exam.title;
    const c = s => W.attempts.filter(a => a.status === s).length;
    $('#xs').innerHTML = `Code <b>${esc(W.exam.code)}</b> · ${statusPill(W.exam.status)} · <b>${c('in_progress')}</b> writing · <b>${c('submitted') + c('auto_submitted')}</b> submitted · <b>${c('terminated')}</b> terminated`;
    drawTiles(); drawFeed();
  };
  const timeLeft = a => {
    if (a.status !== 'in_progress') return attemptPill(a.status);
    const t = Date.now() + W.offset, d = new Date(a.deadline_at).getTime(), h = new Date(a.hard_deadline_at).getTime();
    return t < d ? `<span class="pill">${fmtDur(d - t)} left</span>` : `<span class="pill bad">Grace ${fmtDur(h - t)}</span>`;
  };
  const phoneP = a => { if (!a.phone_paired_at) return '<span class="pill bad">No phone</span>'; const ago = Date.now() + W.offset - new Date(a.phone_last_seen).getTime(); return ago < 90000 ? '<span class="pill ok">Phone ✓</span>' : '<span class="pill warn">Phone offline</span>'; };
  const drawTiles = () => {
    const box = $('#tiles');
    if (!W.attempts.length) { box.innerHTML = '<div class="card">No learner has started yet. Tiles appear as soon as learners start.</div>'; return; }
    const order = W.attempts.slice().sort((a, b) => (a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1) || (a.full_name || '').localeCompare(b.full_name || ''));
    order.forEach(a => {
      let t = $(`.tile[data-a="${a.id}"]`, box);
      if (!t) {
        t = el(`<div class="tile" data-a="${a.id}"><div class="media"><div class="placeholder">Connecting to live video…</div><video class="scr" autoplay muted playsinline></video><video class="cam" autoplay muted playsinline></video><video class="ph hidden" autoplay muted playsinline></video></div><span class="flags hidden"></span><div class="info"></div></div>`);
        t.onclick = () => openDetail(a.id);
        box.appendChild(t);
        attachMedia(a.id);
      }
      const recent = W.events.filter(e => e.attempt_id === a.id && e.severity === 'high' && Date.now() - new Date(e.at).getTime() < 120000).length;
      t.classList.toggle('alert', recent > 0);
      const f = $('.flags', t); f.textContent = a.flags_count + ' flags'; f.classList.toggle('hidden', !a.flags_count);
      const seen = a.last_seen_at ? Math.round((Date.now() + W.offset - new Date(a.last_seen_at).getTime()) / 1000) : null;
      $('.info', t).innerHTML = `<div class="row between"><span class="nm">${esc(a.full_name)}</span>${timeLeft(a)}</div><div class="row" style="margin-top:6px;gap:6px">${phoneP(a)}<span class="pill">${a.answered_count || 0} answered</span>${a.status === 'in_progress' && seen != null && seen > 60 ? `<span class="pill bad">No signal ${seen}s</span>` : ''}</div>`;
    });
  };
  const attachMedia = (aid) => {
    const t = $(`.tile[data-a="${aid}"]`); if (!t) return;
    const m = W.media[aid] || {};
    const set = (sel, st) => { const v = $(sel, t); if (st && v.srcObject !== st) { v.srcObject = st; v.play().catch(() => { }); } v.classList.toggle('hidden', !st); };
    set('.scr', m.screen); set('.cam', m.cam); set('.ph', m.phone);
    $('.placeholder', t).classList.toggle('hidden', !!(m.screen || m.cam));
  };
  const drawFeed = () => {
    const min = $('#fsev').value, rank = { info: 0, warn: 1, high: 2 };
    const names = Object.fromEntries(W.attempts.map(a => [a.id, a.full_name]));
    const list = W.events.filter(e => rank[e.severity || 'info'] >= rank[min]).slice(0, 200);
    $('#feed').innerHTML = list.map(e => `<div class="ev ${e.severity}" data-a="${e.attempt_id}"><div class="when">${fmtT(e.at)} · ${esc(e.source || '')}</div><b>${esc(names[e.attempt_id] || e.name || '')}</b>: ${esc(evLabel(e.kind))}${e.evidence_path ? ' 📷' : ''}<div class="muted" style="font-size:12px">${esc(evDetail(e.detail))}</div></div>`).join('') || '<p class="muted">No alerts yet.</p>';
    $$('#feed .ev').forEach(d => d.onclick = () => d.dataset.a && d.dataset.a !== 'undefined' && openDetail(d.dataset.a));
  };

  // live
  W.live = new LiveReceiver(examId);
  W.live.on('stream', ({ attemptId, role, kind, stream }) => {
    W.media[attemptId] = W.media[attemptId] || {};
    if (role === 'phone') W.media[attemptId].phone = stream; else W.media[attemptId][kind] = stream;
    attachMedia(attemptId); W.onMedia && W.onMedia(attemptId);
  }).on('flag', p => {
    W.events.unshift({ id: 'rt' + Math.random(), attempt_id: p.attemptId, at: p.at, kind: p.kind, severity: p.severity, detail: p.detail, source: p.role, evidence_path: p.evidence_path, name: p.name });
    if (p.severity === 'high') { beep(); toast(`${p.name}: ${evLabel(p.kind)}`, 'bad'); }
    drawFeed(); drawTiles();
  }).on('present', () => { });
  W.live.start().catch(e => console.warn('live video unavailable', e));
  setTimeout(() => { if (!W.live.ch || W.live.ch.state !== 'joined') toast('Live video is not connected yet. Snapshots and alerts still work; check the network if this persists.', 'bad'); }, 15000);
  await load();
  const iv = setInterval(() => load().catch(() => { }), 10000);
  const iv2 = setInterval(drawTiles, 1000);
  S.cleanup.push(() => { clearInterval(iv); clearInterval(iv2); W.live.stop(); });

  $('#msgAll').onclick = async () => {
    const m = await promptBox('Message all learners', 'This appears on every learner\'s screen who is writing.', '', 'textarea'); if (!m) return;
    for (const a of W.attempts.filter(a => a.status === 'in_progress')) { W.live.warn(a.id, m); api('exm_invig_action', { p_attempt_id: a.id, p_action: 'warn', p_value: { message: m } }).catch(() => { }); }
    toast('Message sent', 'ok');
  };

  async function openDetail(aid) {
    const a = W.attempts.find(x => x.id === aid); if (!a) return;
    const body = el(`<div>
      <div class="bigview"><div><video id="dScr" autoplay muted playsinline controls></video><small>Learner's screen</small></div>
      <div class="stack"><div><video id="dCam" autoplay muted playsinline></video><small>Webcam <a href="#" id="listen">🔈 Listen</a></small></div><div><video id="dPh" autoplay muted playsinline></video><small>Phone side camera</small></div></div></div>
      <div class="row" style="margin:14px 0">
        <button class="btn sm" id="aWarn">Send warning</button><button class="btn sm ghost" id="aExt">Change time</button><button class="btn sm ghost" id="aNote">Add note</button>
        <button class="btn sm ghost" id="aEv">Evidence gallery</button>
        ${a.status === 'in_progress' ? '<button class="btn sm danger" id="aTerm">Terminate exam</button>' : '<button class="btn sm ghost" id="aReopen">Reopen exam</button>'}
      </div>
      <div class="grid2"><div><h3>Timeline</h3><div id="tl" class="feed" style="max-height:340px">Loading…</div></div>
      <div><h3>Learner</h3><p>${esc(a.full_name)}<br><small>${esc(a.email)}</small></p><p>${timeLeft(a)} ${phoneP(a)}</p><p><small>Started ${fmtDT(a.started_at)}<br>Deadline ${fmtT(a.deadline_at)} · hard stop ${fmtT(a.hard_deadline_at)}${a.extra_min ? ` · extra ${a.extra_min} min` : ''}<br>Device: ${esc(a.device ? (a.device.browser + ' / ' + a.device.os) : '–')}<br>Phone code: <code>${esc(a.phone_code || '')}</code></small></p></div></div></div>`);
    const md = modal({ title: a.full_name, body, wide: true, onClose: () => { W.onMedia = null; } });
    const paint = () => { const m = W.media[aid] || {}; [['#dScr', m.screen], ['#dCam', m.cam], ['#dPh', m.phone]].forEach(([s, st]) => { const v = $(s, body); if (st && v.srcObject !== st) { v.srcObject = st; v.play().catch(() => { }); } }); };
    paint(); W.onMedia = id => id === aid && paint();
    $('#listen', body).onclick = e => { e.preventDefault(); const v = $('#dCam', body); v.muted = !v.muted; e.target.textContent = v.muted ? '🔈 Listen' : '🔇 Mute'; };
    const act = async (action, value, label) => { try { await api('exm_invig_action', { p_attempt_id: aid, p_action: action, p_value: value }); toast(label, 'ok'); load(); tl(); } catch (e) { toast(e.message, 'bad'); } };
    $('#aWarn', body).onclick = async () => { const m = await promptBox('Warning to ' + a.full_name, 'Message shown on the learner\'s screen', 'Please keep your face in view of the camera.', 'textarea'); if (m) { W.live.warn(aid, m); act('warn', { message: m }, 'Warning sent'); } };
    $('#aNote', body).onclick = async () => { const m = await promptBox('Invigilator note', 'Recorded in the report (not shown to the learner)', '', 'textarea'); if (m) act('note', { text: m }, 'Note saved'); };
    $('#aExt', body).onclick = async () => { const m = await promptBox('Change time', 'Minutes to add (use a negative number to remove time)', '10', 'number'); if (m && +m) { await act('extend', { minutes: +m }, 'Time changed'); W.live.notify('extend', aid); } };
    const t = $('#aTerm', body); if (t) t.onclick = async () => { const reason = await promptBox('Terminate exam', 'Reason (recorded in the report)', '', 'textarea'); if (reason) { await act('terminate', { reason }, 'Exam terminated'); W.live.notify('end', aid); automark({ attempt_id: aid }); md.close(); } };
    const ro = $('#aReopen', body); if (ro) ro.onclick = async () => { const m = await promptBox('Reopen exam', 'Minutes to give the learner if the time has run out', '15', 'number'); if (m !== null) { await act('reopen', { minutes: +m || 15 }, 'Exam reopened. The learner can resume from My exams.'); md.close(); } };
    $('#aEv', body).onclick = () => evidenceGallery(examId, aid, a.full_name);
    const tl = async () => {
      const r = await api('exm_attempt_events', { p_attempt_id: aid });
      const evs = (r.events || []).filter(e => e.kind !== 'heartbeat').reverse();
      const paths = evs.filter(e => e.evidence_path).map(e => e.evidence_path).slice(0, 60);
      let urls = {}; if (paths.length) { try { urls = (await fn('sign', { paths })).urls; } catch (e) { } }
      $('#tl', body).innerHTML = evs.map(e => `<div class="ev ${e.severity}"><div class="when">${fmtT(e.at)} · ${esc(e.source)}</div>${esc(evLabel(e.kind))}<div class="muted" style="font-size:12px">${esc(evDetail(e.detail))}</div>${e.evidence_path && urls[e.evidence_path] ? (/\.webm$/.test(e.evidence_path) ? `<video src="${urls[e.evidence_path]}" controls style="width:220px;border-radius:6px"></video>` : `<img src="${urls[e.evidence_path]}" style="width:160px;border-radius:6px;cursor:zoom-in" onclick="window.open(this.src)">`) : ''}</div>`).join('') || '<p class="muted">No events.</p>';
    };
    tl();
  }
}, { staff: true });

async function evidenceGallery(examId, aid, name) {
  const body = el('<div>Loading…</div>');
  modal({ title: 'Evidence: ' + name, body, wide: true });
  try {
    const r = await fn('list', { prefix: `evidence/${examId}/${aid}` });
    const files = (r.files || []).sort((a, b) => b.name.localeCompare(a.name));
    if (!files.length) { body.innerHTML = '<p>No snapshots yet.</p>'; return; }
    const kinds = { snapshot_cam: 'Webcam', snapshot_screen: 'Screen', snapshot_phone: 'Phone', clip: 'Video clips' };
    let filter = 'snapshot_screen';
    const draw = async () => {
      const list = files.filter(f => f.name.includes(filter)).slice(0, 48);
      const { urls } = list.length ? await fn('sign', { paths: list.map(f => f.path) }) : { urls: {} };
      body.innerHTML = `<div class="row" style="margin-bottom:12px">${Object.entries(kinds).map(([k, l]) => `<button class="btn xs ${k === filter ? '' : 'ghost'}" data-k="${k}">${l} (${files.filter(f => f.name.includes(k)).length})</button>`).join('')}</div>
        <div class="thumbs">${list.map(f => { const ts = (f.name.match(/^(\d{4}-\d\d-\d\dT[\d-]+)/) || [])[1]; const lbl = ts ? fmtT(ts.slice(0, 10) + 'T' + ts.slice(11, 19).replace(/-/g, ':') + 'Z') : ''; return f.name.endsWith('.webm') ? `<div><video src="${urls[f.path]}" controls style="width:240px;border-radius:6px"></video><br><small>${lbl}</small></div>` : `<div><img src="${urls[f.path]}" onclick="window.open(this.src)" style="width:${filter === 'snapshot_screen' ? 260 : 160}px"><br><small>${lbl}</small></div>`; }).join('') || '<p class="muted">None.</p>'}</div>`;
      $$('[data-k]', body).forEach(b => b.onclick = () => { filter = b.dataset.k; draw(); });
    };
    draw();
  } catch (e) { body.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
}

// Camblish Online Exam: phone side camera (opened by scanning the QR code)
// Author: Eddie Bila
async function renderPhone(code) {
  document.body.className = 'phone';
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const P = { code, stream: null, live: null, info: null, ended: false };
  setApp(`<div class="phonewrap">
    <div class="brand" style="margin-bottom:14px"><img class="crest" src="${LOGO.white}" alt="Camblish Training Institute"><div>Camblish Online Exam<small>Phone side camera</small></div></div>
    <div id="pbody"></div></div>`);
  const body = $('#pbody');
  const step1 = () => {
    body.innerHTML = `<div class="card"><h2>Pair this phone</h2><p>Enter the 8-character code shown on your laptop.</p>
      <div class="field"><input id="pc" value="${esc(code)}" maxlength="8" style="font:700 24px var(--mono);letter-spacing:4px;text-transform:uppercase;text-align:center" autocomplete="off"></div>
      <button class="btn gold lg" id="go" style="width:100%">Start side camera</button>
      <p class="hint">Use your phone's normal browser (Chrome on Android, Safari on iPhone). Allow camera and motion access when asked. Plug the phone in and keep this page open for the whole exam.</p></div>`;
    $('#go').onclick = start;
  };
  const start = async () => {
    const btn = $('#go');
    // motion permission must be requested straight from the tap (iPhone)
    const motionP = (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) ? DeviceMotionEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
    await busy(btn, async () => {
      P.code = $('#pc').value.trim().toUpperCase();
      P.info = await rpc('exm_phone_pair', { p_code: P.code });
      P.motion = await motionP;
      try { P.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); }
      catch (e) { throw new Error('Camera access was blocked. Allow the camera for this site and try again.'); }
      running();
    }).catch(() => { });
  };
  const send = async (events) => { try { const r = await rpc('exm_phone_event', { p_code: P.code, p_events: events }); if (r.status && r.status !== 'in_progress') finish(); } catch (e) { if (/not valid|not in progress/i.test(e.message)) finish(); } };
  const flag = async (kind, severity, detail = {}) => {
    const v = $('#pv');
    const b = await frameJpeg(v, 480, 0.6);
    if (P.live) P.live.flag({ kind, severity, detail });
    if (b) { try { await fn('phone_upload', { code: P.code, kind: 'snapshot_phone', content_type: 'image/jpeg', data_base64: await blobToB64(b), event: { kind, severity, detail } }); return; } catch (e) { } }
    send([{ kind, severity, detail }]);
  };
  const running = () => {
    body.innerHTML = `<div class="bigstatus ok" id="st">Side camera is on</div>
      <p style="text-align:center;margin:10px 0">${esc(P.info.learner_name)} · ${esc(P.info.exam_title)}</p>
      <video id="pv" autoplay muted playsinline></video>
      <div class="card" style="margin-top:12px"><b>Set-up</b><ul style="padding-left:18px;margin:6px 0 0"><li>Place the phone on a stand to your side, about 1 m away.</li><li>The view must show you, your hands, your desk and your laptop screen.</li><li>Do not touch the phone during the exam. Movement is detected and recorded.</li><li>Keep this page open and the screen on.</li></ul>
      <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="flip">Switch camera</button></div></div>`;
    $('#pv').srcObject = P.stream;
    let facing = 'environment';
    $('#flip').onclick = async () => {
      facing = facing === 'environment' ? 'user' : 'environment';
      try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); P.stream.getTracks().forEach(t => t.stop()); P.stream = s; $('#pv').srcObject = s; P.live.setStreams({ cam: s }); } catch (e) { toast('Could not switch camera', 'bad'); }
    };
    // keep screen awake
    const wake = async () => { try { P.lock = await navigator.wakeLock.request('screen'); } catch (e) { } };
    wake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    // live
    P.live = new LiveSender({ examId: P.info.exam_id, attemptId: P.info.attempt_id, role: 'phone', name: P.info.learner_name });
    P.live.setStreams({ cam: P.stream });
    P.live.on('end', () => send([{ kind: 'heartbeat' }]));
    P.live.start();
    // heartbeat + snapshots
    send([{ kind: 'phone_camera_on', severity: 'info', detail: { ua: navigator.userAgent, motion: P.motion } }].concat(P.motion === 'denied' ? [{ kind: 'phone_motion_sensor_blocked', severity: 'warn', detail: { note: 'Motion access was refused, so phone pick-up cannot be detected' } }] : []));
    setInterval(() => !P.ended && send([{ kind: 'heartbeat' }]), 15000);
    setInterval(async () => { if (P.ended) return; const b = await frameJpeg($('#pv'), 480, 0.55); if (b) fn('phone_upload', { code: P.code, kind: 'snapshot_phone', content_type: 'image/jpeg', data_base64: await blobToB64(b) }).catch(() => { }); }, Math.max(15, P.info.snapshot_sec || 30) * 1000);
    // page hidden = learner switched app on phone
    document.addEventListener('visibilitychange', () => {
      if (P.ended) return;
      if (document.hidden) { P.hiddenAt = Date.now(); send([{ kind: 'phone_page_hidden', severity: 'high', detail: { note: 'Learner left the camera page on the phone (switched app or locked phone)' } }]); P.live && P.live.flag({ kind: 'phone_page_hidden', severity: 'high' }); }
      else if (P.hiddenAt) { send([{ kind: 'phone_page_returned', severity: 'warn', detail: { seconds: Math.round((Date.now() - P.hiddenAt) / 1000) } }]); P.hiddenAt = null; }
    });
    // movement detection (phone picked up or moved)
    let baseG = null, moved = 0, lastFlag = 0;
    window.addEventListener('devicemotion', e => {
      if (P.ended) return;
      const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
      const a = e.acceleration || {};
      const lin = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      if (!baseG) baseG = { x: g.x, y: g.y, z: g.z };
      const tilt = Math.sqrt((g.x - baseG.x) ** 2 + (g.y - baseG.y) ** 2 + (g.z - baseG.z) ** 2);
      if (lin > 1.6 || tilt > 3.5) moved++; else moved = Math.max(0, moved - 1);
      if (moved > 12 && Date.now() - lastFlag > 30000) {
        lastFlag = Date.now(); moved = 0;
        $('#st').className = 'bigstatus bad'; $('#st').textContent = 'Movement detected and recorded';
        setTimeout(() => { if (!P.ended) { $('#st').className = 'bigstatus ok'; $('#st').textContent = 'Side camera is on'; } }, 6000);
        flag('phone_moved_or_picked_up', 'high', { tilt: +tilt.toFixed(2), accel: +lin.toFixed(2) });
        setTimeout(() => { baseG = null; }, 4000);
      }
    });
    window.addEventListener('orientationchange', () => !P.ended && flag('phone_orientation_changed', 'warn', {}));
    P.stream.getVideoTracks()[0].onended = () => !P.ended && send([{ kind: 'phone_camera_stopped', severity: 'high' }]);
  };
  const finish = () => {
    if (P.ended) return; P.ended = true;
    if (P.live) P.live.stop(); if (P.stream) P.stream.getTracks().forEach(t => t.stop()); try { P.lock && P.lock.release(); } catch (e) { }
    body.innerHTML = '<div class="card"><h2>The exam has ended</h2><p>You can close this page.</p></div>';
  };
  step1();
  if (code.length === 8) setTimeout(() => $('#pc').focus(), 100);
}

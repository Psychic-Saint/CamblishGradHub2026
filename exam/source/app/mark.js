// Camblish Online Exam: marking, release, emails and reports
// Author: Eddie Bila
const markOf = s => s == null ? null : (typeof s === 'number' ? s : num(s.mark));
function sectionsOf(exam, scores) {
  const out = {};
  (exam.paper.questions || []).forEach(q => {
    const s = q.section || q.id[0];
    out[s] = out[s] || { section: s, mark: 0, max: 0, label: (q.group || '').startsWith('Section') ? q.group : 'Section ' + s };
    out[s].max += +q.marks || 0; out[s].mark += markOf(scores && scores[q.id]) || 0;
  });
  return Object.values(out);
}
function memoMap(exam) { return Object.fromEntries(((exam.memo && exam.memo.answers) || []).map(a => [a.id, a])); }
function autoFeedback(exam, a, scores) {
  const qs = exam.paper.questions || [], mm = memoMap(exam);
  const total = qs.reduce((s, q) => s + (markOf(scores[q.id]) || 0), 0), max = exam.total_marks || qs.reduce((s, q) => s + (+q.marks || 0), 0);
  const p = pct(total, max);
  const secs = sectionsOf(exam, scores).map(s => ({ ...s, p: pct(s.mark, s.max) })).sort((x, y) => y.p - x.p);
  const first = (a.full_name || '').split(' ')[0];
  let t = `${first}, you scored ${total} out of ${max} (${p}%). `;
  t += p >= exam.pass_mark ? `This meets the ${exam.pass_mark}% pass mark. ` : `The pass mark is ${exam.pass_mark}%, so you are not yet competent on this assessment. `;
  if (secs.length > 1) t += `Your strongest area was Section ${secs[0].section} (${secs[0].p}%) and the area that needs the most work is Section ${secs[secs.length - 1].section} (${secs[secs.length - 1].p}%). `;
  const lost = qs.map(q => ({ q, lost: (+q.marks || 0) - (markOf(scores[q.id]) || 0) })).filter(x => x.lost > 0 && mm[x.q.id] && mm[x.q.id].tip).sort((x, y) => y.lost - x.lost).slice(0, 4);
  if (lost.length) t += '\n\nFocus on:\n' + lost.map(x => `- ${x.q.id}: ${mm[x.q.id].tip}`).join('\n');
  return t;
}
function renderAnswer(q, ans) {
  if (!ans) return '<span class="muted">No answer</span>';
  let h = '';
  if (q.type === 'mcq' || ans.choice) {
    const o = (q.options || []).find(o => o.key === ans.choice);
    h += ans.choice ? `<b>${esc(ans.choice)})</b> ${esc(o ? o.text : '')}` : '<span class="muted">No option chosen</span>';
  }
  (ans.cells || []).forEach((c, i) => {
    if (!c.code || !c.code.trim()) return;
    h += `<div style="margin-top:8px"><small class="muted">Cell ${i + 1} · ${c.lang === 'sql' ? 'SQL on ' + esc(c.db || '') : 'Python'}</small><pre>${esc(c.code)}</pre>${c.out || c.err ? `<pre style="background:#0d1630;color:#dce6ff">${esc((c.out || '').slice(0, 6000))}${c.err ? '\n' + esc(c.err) : ''}</pre>` : ''}${(c.imgs || []).map(b => `<img src="data:image/png;base64,${b}">`).join('')}</div>`;
  });
  if (ans.text && ans.text.trim()) h += `<div style="margin-top:8px">${esc(ans.text)}</div>`;
  return h || '<span class="muted">No answer</span>';
}

// ---------- auto-marking + sign-off helpers ----------
const ROLE_LABEL = { assessor: 'Assessor', facilitator: 'Facilitator', moderator: 'Moderator' };
function autoScores(exam, a, overwriteAuto = true) {
  const g = Grader.gradeScript(exam, a.answers || {});
  const cur = a.scores || {}, out = {};
  (exam.paper.questions || []).forEach(q => {
    const s = cur[q.id], r = g[q.id];
    const manual = s && typeof s === 'object' && s.auto === false && markOf(s) != null;
    if (manual || (!overwriteAuto && s && markOf(s) != null)) { out[q.id] = s; return; }
    if (r && r.mark != null) out[q.id] = { mark: r.mark, auto: true, conf: r.confidence, hits: r.hits, misses: r.misses, notes: r.notes, ...(s && s.comment ? { comment: s.comment } : {}) };
    else if (s) out[q.id] = s;
  });
  return out;
}
function cleanScores(scores) {
  const clean = {};
  Object.entries(scores).forEach(([k, v]) => {
    if (v == null) return;
    if (typeof v === 'number') { clean[k] = { mark: v }; return; }
    if (markOf(v) == null && !v.comment) return;
    clean[k] = { mark: markOf(v) ?? 0 };
    ['comment', 'auto', 'conf', 'hits', 'misses', 'notes'].forEach(f => { if (v[f] != null && !(Array.isArray(v[f]) && !v[f].length) && v[f] !== '') clean[k][f] = v[f]; });
  });
  return clean;
}
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d'); let drawing = false, dirty = false, last = null;
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B1F4B';
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => canvas.addEventListener(t, () => drawing = false));
  return { isEmpty: () => !dirty, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }, toDataURL: () => canvas.toDataURL('image/png') };
}
function signDialog(role, extra = '') {
  return new Promise(res => {
    const saved = store.get('sig.' + role) || {};
    const body = el(`<div>${extra}
      <div class="grid2" style="gap:10px"><div class="field"><label>Full name</label><input id="sgName" value="${esc(saved.name || S.user.full_name || '')}"></div>
      <div class="field"><label>${ROLE_LABEL[role]} registration number</label><input id="sgReg" value="${esc(saved.reg_no || '')}" placeholder="e.g. ETQA / QCTO reg. no."></div></div>
      <label>Signature</label><canvas id="sgPad" width="520" height="150" style="width:100%;height:150px;border:1px dashed #9aa6c0;border-radius:8px;background:#fff;touch-action:none;cursor:crosshair"></canvas>
      <div class="row between" style="margin-top:6px"><small class="muted">Sign with your mouse, trackpad or finger.</small><button class="btn xs ghost" id="sgClear">Clear</button></div>
      <div class="field" style="margin-top:10px"><label>Comment (optional)</label><input id="sgCmt" placeholder="e.g. Marks verified against the memorandum"></div>
      <label class="check"><input type="checkbox" id="sgOk"> I confirm that I ${role === 'assessor' ? 'assessed this work against the memorandum and the marks are a true reflection of the evidence' : role === 'facilitator' ? 'facilitated this learner and the assessment was conducted under the stated conditions' : 'moderated this assessment'}.</label></div>`);
    let done = false;
    const pad = signaturePad($('#sgPad', body));
    $('#sgClear', body).onclick = () => pad.clear();
    modal({
      title: 'Sign as ' + ROLE_LABEL[role], body, onClose: () => !done && res(null), actions: [{ label: 'Cancel', cls: 'ghost' }, {
        label: 'Sign', cls: 'gold', onClick: () => {
          const name = $('#sgName', body).value.trim();
          if (!name) { toast('Enter your full name', 'bad'); return false; }
          if (pad.isEmpty()) { toast('Draw your signature first', 'bad'); return false; }
          if (!$('#sgOk', body).checked) { toast('Tick the confirmation', 'bad'); return false; }
          store.set('sig.' + role, { name, reg_no: $('#sgReg', body).value.trim() });
          done = true; res({ name, reg_no: $('#sgReg', body).value.trim(), comment: $('#sgCmt', body).value.trim(), signature: pad.toDataURL() });
        }
      }]
    });
  });
}
function autoTag(s) {
  if (!s || typeof s !== 'object') return '';
  if (s.auto) return `<span class="pill ${s.conf === 'low' ? 'warn' : 'blue'}" title="Suggested by auto-marking">Auto${s.conf ? ' · ' + esc(s.conf) : ''}</span>`;
  if (s.auto === false && markOf(s) != null) return '<span class="pill">Assessor</span>';
  return '';
}
function autoWhy(s) {
  if (!s || !s.auto || (!s.hits && !s.misses)) return '';
  return `<div style="margin-top:10px;font-size:12.5px;line-height:1.5">${(s.hits || []).map(h => `<div style="color:var(--ok)">✓ ${esc(h)}</div>`).join('')}${(s.misses || []).map(h => `<div style="color:var(--bad)">✗ ${esc(h)}</div>`).join('')}${(s.notes || []).map(h => `<div style="color:var(--warn)">! ${esc(h)}</div>`).join('')}</div>`;
}
function signBadges(so) {
  so = so || {};
  return ['assessor', 'facilitator', 'moderator'].filter(r => so[r]).map(r => `<span class="pill ok" title="${esc(so[r].name)} · ${fmtDT(so[r].signed_at)}">${ROLE_LABEL[r][0]} ✓</span>`).join(' ') || '<span class="muted">–</span>';
}

// ---------- marking list ----------
on(/^#\/mark\/([\w-]+)$/, async (examId) => {
  const r = await api('exm_marking_list', { p_exam_id: examId });
  const exam = r.exam, list = r.attempts || [];
  const pending = list.filter(a => a.status !== 'in_progress' && !a.finalised && !a.marked_at && !(a.scores && Object.values(a.scores).some(s => s && s.conf)));
  if (pending.length && exam.memo && (exam.memo.answers || []).length && !S._autoRan) {
    S._autoRan = true;
    toast(`Auto-marking ${pending.length} new script(s)…`);
    await Promise.all(pending.map(a => automark({ attempt_id: a.id })));
    setTimeout(() => { S._autoRan = false; }, 5000);
    return route();
  }
  const done = list.filter(a => a.finalised).length;
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker">Marking · ${esc(exam.code)}</div><h1>${esc(exam.title)}</h1><p>${list.length} scripts · ${done} finalised · MCQs are marked automatically on submission.</p></div>
    <div class="row"><a class="btn ghost" href="#/reports/${examId}">Reports</a><button class="btn navy" id="autoAll">Auto-mark all scripts</button><button class="btn ghost" id="signSel">Sign selected</button>${isAdmin(S.user) ? '<button class="btn" id="rel">Release selected</button><button class="btn gold" id="mail">Email reports to selected</button>' : ''}</div></div>
  <div class="notice" style="margin-bottom:14px">Auto-marking scores every answer against the memo's key figures, concepts and code techniques and saves the marks as a draft. The assessor then reviews each script, adjusts where needed, finalises and signs. Learners only see results after they are released.</div>
  <div class="card"><div class="tablewrap"><table class="t"><thead><tr><th><input type="checkbox" id="all"></th><th>Learner</th><th>Status</th><th>Mark</th><th>Result</th><th>Marking</th><th>Signed</th><th>Released</th><th>Emailed</th><th>Flags</th><th></th></tr></thead><tbody>
  ${list.map(a => `<tr><td><input type="checkbox" class="sel" value="${a.id}"></td><td><b>${esc(a.full_name)}</b><br><small>${esc(a.email)}</small></td><td>${attemptPill(a.status)}</td>
    <td>${a.total != null ? `${a.total} / ${exam.total_marks} <small>(${a.percent ?? '–'}%)</small>` : '–'}</td><td>${a.result && a.finalised ? `<span class="pill ${a.result === 'Competent' ? 'ok' : 'bad'}">${esc(a.result)}</span>` : ''}</td>
    <td>${a.finalised ? '<span class="pill ok">Finalised</span>' : a.marked_at ? '<span class="pill warn">Draft</span>' : a.status === 'in_progress' ? '<span class="muted">Writing</span>' : '<span class="pill">To mark</span>'}</td>
    <td>${signBadges(a.signoff)}</td><td>${a.released_at ? fmtDT(a.released_at) : '–'}</td><td>${a.emailed_at ? fmtDT(a.emailed_at) : '–'}</td><td>${a.flags_count ? `<span class="pill ${a.flags_count > 5 ? 'bad' : 'warn'}">${a.flags_count}</span>` : '0'}</td>
    <td>${a.status !== 'in_progress' ? `<a class="btn xs" href="#/mark/${examId}/${a.id}">${a.finalised ? 'Review' : 'Mark'}</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="11">No scripts yet.</td></tr>'}
  </tbody></table></div></div>`));
  bindShell();
  $('#all').onchange = e => $$('.sel').forEach(c => c.checked = e.target.checked);
  const sel = () => $$('.sel:checked').map(c => c.value);
  $('#autoAll').onclick = e => { const btn = e.currentTarget; busy(btn, async () => {
    const todo = list.filter(a => a.status !== 'in_progress' && !a.finalised);
    if (!todo.length) throw new Error('No unfinalised submitted scripts to mark');
    if (!(exam.memo && exam.memo.answers && exam.memo.answers.length)) throw new Error('Upload the memo first (Edit exam, step 3)');
    if (!await confirmBox('Auto-mark scripts', `Auto-mark ${todo.length} submitted script(s) against the memo? Marks you entered by hand are kept. Results stay as drafts until an assessor finalises them.`, 'Auto-mark')) return;
    let n = 0;
    for (const a of todo) {
      const sc = autoScores(exam, a);
      await api('exm_marking_save', { p_attempt_id: a.id, p_scores: cleanScores(sc), p_feedback: a.feedback || autoFeedback(exam, a, sc), p_finalise: false });
      n++; btn.textContent = `Marked ${n} of ${todo.length}…`;
    }
    toast(`${n} script(s) auto-marked as drafts. Review and finalise each one.`, 'ok'); route();
  }).catch(() => { }); };
  $('#signSel').onclick = async () => {
    const ids = sel(); if (!ids.length) return toast('Select learners first', 'bad');
    const chosen = list.filter(a => ids.includes(a.id) && a.status !== 'in_progress');
    const notFin = chosen.filter(a => !a.finalised).length;
    const roleBody = el(`<div><p>Sign ${chosen.length} script(s) in one go.${notFin ? ` <b>${notFin} are not finalised yet</b> and will be skipped.` : ''}</p><div class="field"><label>Sign as</label><select id="rl"><option value="assessor">Assessor</option><option value="facilitator">Facilitator</option><option value="moderator">Moderator</option></select></div></div>`);
    let role = null;
    await new Promise(r => modal({ title: 'Sign selected scripts', body: roleBody, onClose: r, actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Continue', onClick: () => { role = $('#rl', roleBody).value; } }] }));
    if (!role) return;
    const sig = await signDialog(role, `<p class="muted">This signature is applied to ${chosen.length - notFin} finalised script(s).</p>`);
    if (!sig) return;
    let n = 0;
    for (const a of chosen.filter(a => a.finalised)) { try { await api('exm_signoff', { p_attempt_id: a.id, p_role: role, p_data: sig }); n++; } catch (err) { toast(a.full_name + ': ' + err.message, 'bad'); } }
    toast(`Signed ${n} script(s) as ${ROLE_LABEL[role].toLowerCase()}`, 'ok'); route();
  };
  if ($('#rel')) $('#rel').onclick = e => busy(e.currentTarget, async () => {
    const ids = sel(); if (!ids.length) throw new Error('Select learners first');
    const unsigned = list.filter(a => ids.includes(a.id) && a.finalised && !(a.signoff && a.signoff.assessor));
    if (unsigned.length && !await confirmBox('Not signed by an assessor', `${unsigned.map(a => esc(a.full_name)).join(', ')} ${unsigned.length > 1 ? 'have' : 'has'} no assessor signature yet. Release anyway?`, 'Release anyway')) return;
    const r = await api('exm_release', { p_attempt_ids: ids });
    toast(`${r.released} result(s) released${r.not_finalised ? `, ${r.not_finalised} not finalised yet` : ''}`, 'ok'); route();
  }).catch(() => { });
  if ($('#mail')) $('#mail').onclick = e => busy(e.currentTarget, async () => {
    const ids = sel(); if (!ids.length) throw new Error('Select learners first');
    const notRel = list.filter(a => ids.includes(a.id) && !a.released_at);
    if (notRel.length && !await confirmBox('Release first?', `${notRel.length} of the selected results are not released yet. Release them now and email everyone selected?`, 'Release and email')) return;
    if (notRel.length) await api('exm_release', { p_attempt_ids: notRel.map(a => a.id) });
    const r = await fn('email', { attempt_ids: ids });
    const bad = (r.results || []).filter(x => !x.ok);
    toast(`${r.sent} email(s) sent${bad.length ? `, ${bad.length} failed: ${bad[0].error}` : ''}`, bad.length ? 'bad' : 'ok'); route();
  }).catch(() => { });
}, { staff: true });

// ---------- mark one script ----------
on(/^#\/mark\/([\w-]+)\/([\w-]+)$/, async (examId, aid) => {
  const r = await api('exm_marking_list', { p_exam_id: examId });
  const exam = r.exam, list = r.attempts.filter(a => a.status !== 'in_progress');
  const a = list.find(x => x.id === aid); if (!a) throw new Error('Script not found');
  const idx = list.indexOf(a), next = list[idx + 1];
  const qs = exam.paper.questions || [], mm = memoMap(exam);
  let scores = JSON.parse(JSON.stringify(a.scores || {}));
  const answers = a.answers || {};
  const hasMemo = !!(exam.memo && exam.memo.answers && exam.memo.answers.length);
  const unmarkedBefore = qs.filter(q => markOf(scores[q.id]) == null).length;
  let autoApplied = false;
  if (hasMemo && !a.finalised && unmarkedBefore) { scores = autoScores(exam, { ...a, scores }, false); autoApplied = true; }
  const signoff = a.signoff || {};
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker"><a href="#/mark/${examId}">← All scripts</a> · ${idx + 1} of ${list.length}</div><h1>${esc(a.full_name)}</h1><p>${esc(a.email)} · ${attemptPill(a.status)} · submitted ${fmtDT(a.submitted_at)}</p></div>
    <div class="row"><button class="btn ghost" id="rerun" ${hasMemo ? '' : 'disabled title="Upload the memo first"'}>Re-run auto-marking</button><button class="btn ghost" id="ev">Integrity: ${a.flags_count || 0} flags</button></div></div>
  ${autoApplied ? `<div class="notice" style="margin-bottom:14px">Auto-marking filled in suggested marks for ${unmarkedBefore} question(s). Each shows what it found and what was missing. Check them, adjust where your judgement differs, then finalise and sign.</div>` : ''}
  ${!hasMemo ? '<div class="notice warn" style="margin-bottom:14px">No memo uploaded for this exam, so only multiple-choice answers can be auto-marked. Upload the memo in Edit exam, step 3.</div>' : ''}
  <div id="qs"></div>
  <div class="card" id="signoff" style="margin-bottom:14px"></div>
  <div class="card" style="position:sticky;bottom:0;z-index:5;border-top:3px solid var(--gold)">
    <div class="row between"><h2 style="margin:0">Total: <span id="tot"></span></h2><span id="res"></span></div>
    <div class="field" style="margin-top:10px"><label>Overall feedback to the learner (included in the emailed report)</label><textarea id="fb" style="min-height:90px">${esc(a.feedback || '')}</textarea></div>
    <div class="row end"><button class="btn ghost" id="gen">Write feedback from the memo tips</button><button class="btn ghost" id="sd">Save draft</button><button class="btn gold" id="fin">Save and finalise${next ? ' → next' : ''}</button></div>
  </div>`));
  bindShell();
  const total = () => qs.reduce((s, q) => s + (markOf(scores[q.id]) || 0), 0);
  const upd = () => {
    const t = total(), p = pct(t, exam.total_marks);
    $('#tot').textContent = `${t} / ${exam.total_marks} (${p}%)`;
    const un = qs.filter(q => scores[q.id] == null || markOf(scores[q.id]) == null).length;
    $('#res').innerHTML = `${un ? `<span class="pill warn">${un} unmarked</span> ` : ''}<span class="pill ${p >= exam.pass_mark ? 'ok' : 'bad'}">${p >= exam.pass_mark ? 'Competent' : 'Not Yet Competent'}</span>`;
  };
  $('#qs').innerHTML = qs.map(q => {
    const m = mm[q.id] || {}, s = scores[q.id];
    const auto = s && s.auto;
    const correct = q.type === 'mcq' && m.answer ? (answers[q.id] && answers[q.id].choice === m.answer) : null;
    return `<div class="mq" data-q="${esc(q.id)}"><div class="mh"><span class="qid">${esc(q.id)}</span><span class="grow" style="font-size:14px">${esc(q.text.slice(0, 160))}${q.text.length > 160 ? '…' : ''}</span>
      ${correct === true ? '<span class="pill ok">Correct</span>' : correct === false ? '<span class="pill bad">Incorrect</span>' : ''}<span class="autotag">${autoTag(s)}</span>
      <input class="markin" type="number" min="0" max="${q.marks}" step="0.5" value="${markOf(s) ?? ''}"><b>/ ${q.marks}</b></div>
      <div class="mb"><div><small class="kicker">Learner's answer</small><div class="ans">${renderAnswer(q, answers[q.id])}</div></div>
      <div><small class="kicker">Memo</small><div class="memo">${q.type === 'mcq' && m.answer ? `<b>Answer: ${esc(m.answer)}</b>\n` : ''}${esc(m.model_answer || '–')}</div>${m.marking_guide ? `<div class="memo" style="margin-top:8px"><b>Marking guide:</b> ${esc(m.marking_guide)}</div>` : ''}
        <div class="autowhy">${autoWhy(s)}</div>
        <div class="quick" style="margin-top:10px">${Array.from({ length: Math.floor(q.marks) + 1 }, (_, i) => `<button class="btn xs ghost" data-v="${i}">${i}</button>`).join('')}</div>
        <input class="cmt" placeholder="Comment for this question (optional)" value="${esc((s && s.comment) || '')}" style="margin-top:8px"></div></div></div>`;
  }).join('');
  $$('.mq').forEach(box => {
    const id = box.dataset.q, q = qs.find(x => x.id === id), inp = $('.markin', box);
    const set = v => { v = num(v); if (v != null) v = Math.max(0, Math.min(q.marks, v)); scores[id] = { ...(scores[id] || {}), mark: v, auto: false }; if (v == null) delete scores[id].mark; $('.autotag', box).innerHTML = autoTag(scores[id]); upd(); };
    inp.oninput = () => set(inp.value);
    $$('[data-v]', box).forEach(b => b.onclick = () => { inp.value = b.dataset.v; set(b.dataset.v); });
    $('.cmt', box).oninput = e => { scores[id] = { ...(scores[id] || {}), comment: e.target.value }; };
  });
  upd();
  $('#rerun').onclick = async () => {
    if (!await confirmBox('Re-run auto-marking', 'Recalculate the suggested marks for every question? Marks you changed by hand are kept.', 'Re-run')) return;
    scores = autoScores(exam, { ...a, scores }, true);
    $$('.mq').forEach(box => { const id = box.dataset.q, s = scores[id]; $('.markin', box).value = markOf(s) ?? ''; $('.autotag', box).innerHTML = autoTag(s); $('.autowhy', box).innerHTML = autoWhy(s); });
    upd(); toast('Suggested marks updated', 'ok');
  };
  const drawSign = () => {
    const box = $('#signoff');
    const cur = total();
    box.innerHTML = `<h2>Sign-off</h2><p class="muted" style="margin-top:-4px">The assessor signs to confirm the marks; the facilitator signs to confirm the assessment conditions. Signatures appear on the learner report and the class report.</p>
      <div class="grid3">${['assessor', 'facilitator', 'moderator'].map(r => { const x = signoff[r];
        return `<div class="stat" style="min-height:150px"><div class="l">${ROLE_LABEL[r]}${r === 'moderator' ? ' (optional)' : ''}</div>${x ? `
          <img src="${x.signature}" style="max-width:100%;height:60px;object-fit:contain;display:block;margin:6px 0">
          <div><b>${esc(x.name)}</b>${x.reg_no ? ` · ${esc(x.reg_no)}` : ''}</div><small class="muted">${fmtDT(x.signed_at)}</small>
          ${x.total_at_signing != null && +x.total_at_signing !== +cur ? `<div class="pill warn" style="margin-top:6px">Marks changed since signing (${x.total_at_signing} → ${cur}). Sign again.</div>` : ''}
          <div class="row" style="margin-top:8px;gap:6px"><button class="btn xs ghost" data-sign="${r}">Sign again</button><button class="btn xs ghost" data-unsign="${r}">Remove</button></div>`
          : `<p class="muted" style="margin:8px 0 12px">Not signed</p><button class="btn sm ${r === 'assessor' ? 'gold' : 'ghost'}" data-sign="${r}">Sign as ${ROLE_LABEL[r].toLowerCase()}</button>`}</div>`; }).join('')}</div>`;
    $$('[data-sign]', box).forEach(b => b.onclick = () => doSign(b.dataset.sign));
    $$('[data-unsign]', box).forEach(b => b.onclick = async () => { if (!await confirmBox('Remove signature', 'Remove this signature?', 'Remove', 'danger')) return; const r2 = await api('exm_signoff', { p_attempt_id: aid, p_role: b.dataset.unsign, p_data: null }); Object.keys(signoff).forEach(k => delete signoff[k]); Object.assign(signoff, r2.signoff); drawSign(); });
  };
  const doSign = async role => {
    if (role === 'assessor' && JSON.stringify(cleanScores(scores)) !== JSON.stringify(cleanScores(a.scores || {}))) {
      if (!await confirmBox('Save marks first', 'You have unsaved mark changes. Save them as a draft before signing?', 'Save and sign')) return;
      await save(false, true);
    }
    const sig = await signDialog(role); if (!sig) return;
    try { const r2 = await api('exm_signoff', { p_attempt_id: aid, p_role: role, p_data: sig }); Object.keys(signoff).forEach(k => delete signoff[k]); Object.assign(signoff, r2.signoff); drawSign(); toast('Signed', 'ok'); }
    catch (err) { toast(err.message, 'bad'); }
  };
  drawSign();
  $('#ev').onclick = () => evidenceTimeline(examId, a);
  $('#gen').onclick = () => { $('#fb').value = autoFeedback(exam, a, scores); };
  async function save(fin, stay) {
    const clean = cleanScores(scores);
    if (fin) { const un = qs.filter(q => markOf(scores[q.id]) == null); if (un.length && !await confirmBox('Unmarked questions', `${un.map(q => q.id).join(', ')} have no mark and will count as 0. Finalise anyway?`, 'Finalise')) return; }
    if (fin && !$('#fb').value.trim()) $('#fb').value = autoFeedback(exam, a, scores);
    const r3 = await api('exm_marking_save', { p_attempt_id: aid, p_scores: clean, p_feedback: $('#fb').value, p_finalise: !!fin });
    a.scores = clean; a.total = r3.attempt.total; drawSign();
    if (stay) return;
    if (fin && !signoff.assessor) {
      toast('Finalised', 'ok');
      if (await confirmBox('Assessor signature', 'Marks are finalised. Sign now as the assessor?', 'Sign now', 'gold')) { await doSign('assessor'); }
    } else toast(fin ? 'Finalised' : 'Draft saved', 'ok');
    if (fin) go(next ? `#/mark/${examId}/${next.id}` : `#/mark/${examId}`);
  }
  $('#sd').onclick = e => busy(e.currentTarget, () => save(false)).catch(() => { });
  $('#fin').onclick = e => busy(e.currentTarget, () => save(true)).catch(() => { });
}, { staff: true });

async function evidenceTimeline(examId, a) {
  const r = await api('exm_attempt_events', { p_attempt_id: a.id });
  const evs = (r.events || []).filter(e => e.kind !== 'heartbeat');
  const counts = {}; evs.filter(e => e.severity !== 'info').forEach(e => counts[e.kind] = (counts[e.kind] || 0) + 1);
  const body = el(`<div><div class="row" style="margin-bottom:12px">${Object.entries(counts).map(([k, n]) => `<span class="pill warn">${esc(evLabel(k))}: ${n}</span>`).join('') || '<span class="pill ok">No warnings</span>'}<button class="btn xs" id="gal">Open evidence gallery</button></div>
    <div class="feed" style="max-height:60vh">${evs.slice().reverse().map(e => `<div class="ev ${e.severity}"><div class="when">${fmtDT(e.at)} · ${esc(e.source)}</div>${esc(evLabel(e.kind))} <span class="muted">${esc(evDetail(e.detail))}</span>${e.evidence_path ? ' 📷' : ''}</div>`).join('')}</div></div>`);
  modal({ title: 'Integrity record: ' + a.full_name, body, wide: true });
  $('#gal', body).onclick = () => evidenceGallery(examId, a.id, a.full_name);
}

// ---------- reports ----------
on(/^#\/reports\/([\w-]+)$/, async (examId) => {
  const r = await api('exm_report_data', { p_exam_id: examId });
  const exam = r.exam, all = r.attempts || [];
  const done = all.filter(a => a.status !== 'in_progress');
  const fin = done.filter(a => a.finalised);
  const qs = exam.paper.questions || [];
  const pcts = fin.map(a => +a.percent || 0);
  const avg = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length * 10) / 10 : 0;
  const passN = fin.filter(a => a.result === 'Competent').length;
  const qStats = qs.map(q => { const ms = done.map(a => markOf(a.scores && a.scores[q.id])).filter(x => x != null); return { q, avg: ms.length ? pct(ms.reduce((s, x) => s + x, 0), ms.length * (+q.marks || 1)) : null }; });
  const secNames = [...new Set(qs.map(q => q.section || q.id[0]))];
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker">Reports · ${esc(exam.code)}</div><h1>${esc(exam.title)}</h1><p>Generated ${fmtDT(r.generated_at)}</p></div>
    <div class="row"><button class="btn gold" id="pAll">Class report (PDF)</button><button class="btn" id="pEach">All learner reports (PDF)</button><button class="btn ghost" id="csv">Download spreadsheet (CSV)</button></div></div>
  <div class="grid3" style="margin-bottom:16px">
    <div class="stat"><div class="l">Candidates</div><div class="v">${all.length}</div><small>${done.length} submitted · ${fin.length} finalised</small></div>
    <div class="stat"><div class="l">Average</div><div class="v">${fin.length ? avg + '%' : '–'}</div><small>finalised scripts</small></div>
    <div class="stat"><div class="l">Competent</div><div class="v">${fin.length ? passN + ' / ' + fin.length : '–'}</div><small>pass mark ${exam.pass_mark}%</small></div>
    <div class="stat"><div class="l">Highest / lowest</div><div class="v">${pcts.length ? Math.max(...pcts) + '% / ' + Math.min(...pcts) + '%' : '–'}</div></div>
  </div>
  <div class="grid2" style="align-items:start">
  <div class="card"><h2>Learners</h2><div class="tablewrap"><table class="t"><thead><tr><th>Learner</th>${secNames.map(s => `<th>${esc(s)}</th>`).join('')}<th>Total</th><th>%</th><th>Result</th><th>Flags</th><th></th></tr></thead><tbody>
    ${all.map(a => { const secs = sectionsOf(exam, a.scores || {}); return `<tr><td><b>${esc(a.full_name)}</b><br><small>${esc(a.id_number || '')}</small></td>${secNames.map(s => { const x = secs.find(y => y.section === s); return `<td>${x ? x.mark : '–'}</td>`; }).join('')}<td>${a.total ?? '–'}</td><td>${a.percent ?? '–'}</td><td>${a.finalised ? `<span class="pill ${a.result === 'Competent' ? 'ok' : 'bad'}">${a.result === 'Competent' ? 'C' : 'NYC'}</span>` : attemptPill(a.status)}</td><td>${a.flags_count || 0}</td><td><button class="btn xs ghost" data-p="${a.id}">PDF</button></td></tr>`; }).join('') || '<tr><td colspan="9">No candidates yet.</td></tr>'}
  </tbody></table></div></div>
  <div class="card"><h2>Question analysis</h2><p class="muted">Average mark per question across submitted scripts. Low bars point to topics to re-teach.</p><div class="bars">${qStats.map(x => `<div class="b"><code>${esc(x.q.id)}</code><div class="track"><div class="fill" style="width:${x.avg || 0}%;background:${x.avg == null ? 'transparent' : x.avg < 40 ? 'var(--bad)' : x.avg < 60 ? 'var(--gold)' : 'var(--ok)'}"></div></div><span>${x.avg == null ? '–' : x.avg + '%'}</span></div>`).join('')}</div></div>
  </div>`));
  bindShell();
  $$('[data-p]').forEach(b => b.onclick = () => printReports(exam, all.filter(a => a.id === b.dataset.p), false));
  $('#pAll').onclick = () => printReports(exam, all, true, qStats);
  $('#pEach').onclick = () => printReports(exam, all.filter(a => a.status !== 'in_progress'), false);
  $('#csv').onclick = () => {
    const head = ['Learner', 'Email', 'ID number', 'Cell', 'Status', 'Started', 'Submitted', ...qs.map(q => q.id + ' (' + q.marks + ')'), ...secNames.map(s => 'Section ' + s), 'Total', 'Percent', 'Result', 'Finalised', 'Released', 'Emailed', 'Flags', 'Feedback'];
    const rows = all.map(a => { const secs = sectionsOf(exam, a.scores || {}); return [a.full_name, a.email, a.id_number, a.phone, a.status, a.started_at, a.submitted_at, ...qs.map(q => markOf(a.scores && a.scores[q.id]) ?? ''), ...secNames.map(s => (secs.find(x => x.section === s) || {}).mark ?? ''), a.total ?? '', a.percent ?? '', a.result || '', a.finalised ? 'Yes' : 'No', a.released_at || '', a.emailed_at || '', a.flags_count || 0, a.feedback || '']; });
    const csv = [head, ...rows].map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    download(`${exam.code}_results.csv`, '﻿' + csv, 'text/csv');
  };
}, { staff: true });

// ---------- printable reports ----------
const PRINT_CSS = `
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}body{font:11pt/1.45 'IBM Plex Sans',Arial,sans-serif;color:#14203a;margin:0}
h1,h2,h3{color:#0B1F4B;margin:0 0 6px}h1{font-size:20pt}h2{font-size:14pt;margin-top:14px}h3{font-size:11.5pt;margin-top:12px}
.cover{background:#0B1F4B;color:#fff;padding:22px 24px 22px 116px;border-bottom:5px solid #C9A227;margin-bottom:16px;position:relative;min-height:112px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover .clogo{position:absolute;left:22px;top:18px;width:78px}
.cover h1{color:#fff}.cover .tag{color:#C9A227;font-weight:600;font-size:9.5pt;letter-spacing:.5px}
.cover small{color:#c8d3f0}
table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:9.5pt}
th{background:#eef2fb;color:#0B1F4B;text-align:left;padding:5px 7px;border-bottom:2px solid #C9A227}
td{padding:5px 7px;border-bottom:1px solid #dfe4ef;vertical-align:top}
.kv td:first-child{width:34%;color:#5d6b86}
.big{font-size:26pt;font-weight:700;color:#0B1F4B}
.res{display:inline-block;padding:3px 12px;border-radius:14px;font-weight:700}
.ok{background:#e5f5ec;color:#17834a}.bad{background:#fdecec;color:#c62828}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.box{border:1px solid #dfe4ef;border-left:4px solid #1F4FD1;padding:8px 10px}
.box b{display:block;font-size:15pt;color:#0B1F4B}
.page{page-break-after:always}.page:last-child{page-break-after:auto}
.bar{background:#eef2fb;height:8px;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:#1F4FD1}
.foot{margin-top:18px;font-size:8.5pt;color:#5d6b86;border-top:1px solid #dfe4ef;padding-top:6px}
ul{margin:4px 0;padding-left:18px}
.sign td{border:1px solid #c9d1e3;vertical-align:middle}.sign th{border:1px solid #c9d1e3}
.diag{height:6px;background:repeating-linear-gradient(135deg,#C9A227 0 10px,transparent 10px 20px);opacity:.5;margin:10px 0}
`;
function signBlock(so, cls) {
  so = so || {};
  const row = r => { const x = so[r];
    return `<tr><td style="width:18%"><b>${ROLE_LABEL[r]}</b></td><td style="width:28%">${x ? esc(x.name) : ''}</td><td style="width:16%">${x && x.reg_no ? esc(x.reg_no) : ''}</td>
      <td style="width:22%;height:46px">${x && x.signature ? `<img src="${x.signature}" style="height:42px;max-width:100%;object-fit:contain">` : ''}</td><td style="width:16%">${x ? new Date(x.signed_at).toLocaleDateString('en-ZA') : ''}</td></tr>`; };
  return `<div class="diag"></div><h2>Sign-off</h2>${cls ? '<p style="font-size:9.5pt;color:#5d6b86;margin:0 0 4px">Signed by hand where blank, or printed from the e-signatures captured when every script carries the same signatory.</p>' : ''}
    <table class="sign"><tr><th>Role</th><th>Full name</th><th>Reg. no.</th><th>Signature</th><th>Date</th></tr>${['assessor', 'facilitator', 'moderator'].map(row).join('')}</table>
    ${['assessor', 'facilitator', 'moderator'].filter(r => so[r] && so[r].comment).map(r => `<p style="font-size:9.5pt"><b>${ROLE_LABEL[r]} comment:</b> ${esc(so[r].comment)}</p>`).join('')}`;
}
function commonSignoff(attempts) {
  const out = {};
  ['assessor', 'facilitator', 'moderator'].forEach(r => {
    const sig = attempts.filter(a => a.status !== 'in_progress').map(a => a.signoff && a.signoff[r]);
    if (sig.length && sig.every(x => x && x.name === sig[0].name)) out[r] = sig.slice().sort((p, q) => new Date(q.signed_at) - new Date(p.signed_at))[0];
  });
  return out;
}
function printDoc(title, html) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to export PDFs', 'bad');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="author" content="Eddie Bila"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet"><style>${PRINT_CSS}</style></head><body>${html}<script>setTimeout(()=>{window.print()},700)<\/script></body></html>`);
  w.document.close();
}
function learnerPage(exam, a, staff) {
  const qs = exam.paper.questions || [], mm = memoMap(exam), sc = a.scores || {};
  const secs = sectionsOf(exam, sc);
  const ok = a.result === 'Competent';
  const lost = qs.filter(q => (markOf(sc[q.id]) || 0) < (+q.marks || 0) && mm[q.id] && mm[q.id].tip);
  const flags = a.severity_counts || {};
  return `<div class="page">
    <div class="cover"><img class="clogo" src="${LOGO.white}" alt=""><div class="tag">CAMBLISH TRAINING INSTITUTE · TAKING THE LEAD, SHAPING THE FUTURE</div><h1>Learner Assessment Report</h1><small>${esc(exam.title)} · ${esc(exam.qualification || '')}${exam.saqa_id ? ' · SAQA ID ' + esc(exam.saqa_id) : ''}</small></div>
    <table class="kv"><tr><td>Learner</td><td><b>${esc(a.full_name)}</b></td></tr><tr><td>ID number</td><td>${esc(a.id_number || '')}</td></tr><tr><td>Email</td><td>${esc(a.email || '')}</td></tr>
    <tr><td>Exam code</td><td>${esc(exam.code)}</td></tr><tr><td>Written</td><td>${fmtDT(a.started_at)} to ${fmtDT(a.submitted_at)} (${esc({ submitted: 'submitted', auto_submitted: 'auto-submitted at time limit', terminated: 'terminated by invigilator' }[a.status] || a.status)})</td></tr>
    ${a.marked_by_name ? `<tr><td>Assessor</td><td>${esc(a.marked_by_name)} · ${fmtDT(a.marked_at)}</td></tr>` : ''}</table>
    <div class="grid"><div class="box">Total<b>${a.total ?? '–'} / ${exam.total_marks}</b></div><div class="box">Percentage<b>${a.percent ?? '–'}%</b></div><div class="box">Result<b><span class="res ${ok ? 'ok' : 'bad'}">${esc(a.finalised ? a.result : 'Not finalised')}</span></b></div></div>
    <h2>Performance by section</h2><table><tr><th>Section</th><th>Marks</th><th>Out of</th><th style="width:40%">%</th></tr>${secs.map(s => `<tr><td>${esc(s.label)}</td><td>${s.mark}</td><td>${s.max}</td><td><div class="bar"><i style="width:${pct(s.mark, s.max)}%"></i></div>${pct(s.mark, s.max)}%</td></tr>`).join('')}</table>
    <h2>Marks per question</h2><table><tr><th>No.</th><th>Mark</th><th>Out of</th><th>Assessor comment</th></tr>${qs.map(q => { const s = sc[q.id]; return `<tr><td>${esc(q.id)}</td><td>${markOf(s) ?? '–'}</td><td>${q.marks}</td><td>${esc((s && s.comment) || '')}</td></tr>`; }).join('')}</table>
    ${a.feedback ? `<h2>Assessor feedback</h2><p style="white-space:pre-wrap">${esc(a.feedback)}</p>` : ''}
    ${lost.length ? `<h2>Ways to improve</h2><ul>${lost.slice(0, 10).map(q => `<li><b>${esc(q.id)}</b>: ${esc(mm[q.id].tip)}</li>`).join('')}</ul>` : ''}
    ${staff ? `<div class="diag"></div><h3>Invigilation record (internal)</h3><p>${a.flags_count || 0} flagged events · ${flags.high || 0} serious · ${flags.warn || 0} warnings${a.phone_paired_at ? ' · phone side camera paired' : ' · phone camera not paired'}.${a.event_counts ? ' Main events: ' + esc(Object.entries(a.event_counts).filter(([k]) => !/heartbeat|device|started|submitted|face_monitor|phone_camera_on|focus_returned|warning_ack/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => evLabel(k) + ' (' + n + ')').join(', ')) : ''}</p>` : ''}
    ${signBlock(a.signoff)}
    <div class="foot">Camblish Training Institute · Online Assessment Centre · Report generated ${fmtDT(new Date())} · Author: Eddie Bila</div></div>`;
}
function printReports(exam, attempts, summary, qStats) {
  if (!attempts.length) return toast('Nothing to export yet', 'bad');
  let html = '';
  if (summary) {
    const fin = attempts.filter(a => a.finalised);
    html += `<div class="page"><div class="cover"><img class="clogo" src="${LOGO.white}" alt=""><div class="tag">CAMBLISH TRAINING INSTITUTE · TAKING THE LEAD, SHAPING THE FUTURE</div><h1>Class Results Report</h1><small>${esc(exam.title)} · ${esc(exam.qualification || '')} · code ${esc(exam.code)}</small></div>
      <div class="grid"><div class="box">Candidates<b>${attempts.length}</b></div><div class="box">Competent<b>${fin.filter(a => a.result === 'Competent').length} / ${fin.length}</b></div><div class="box">Average<b>${fin.length ? Math.round(fin.reduce((s, a) => s + (+a.percent || 0), 0) / fin.length * 10) / 10 : '–'}%</b></div></div>
      <h2>Results</h2><table><tr><th>#</th><th>Learner</th><th>ID number</th>${[...new Set((exam.paper.questions || []).map(q => q.section || q.id[0]))].map(s => `<th>${esc(s)}</th>`).join('')}<th>Total</th><th>%</th><th>Result</th><th>Flags</th></tr>
      ${attempts.slice().sort((x, y) => (x.full_name || '').localeCompare(y.full_name || '')).map((a, i) => { const secs = sectionsOf(exam, a.scores || {}); return `<tr><td>${i + 1}</td><td>${esc(a.full_name)}</td><td>${esc(a.id_number || '')}</td>${secs.map(s => `<td>${s.mark}</td>`).join('')}<td>${a.total ?? '–'}</td><td>${a.percent ?? '–'}</td><td>${a.finalised ? esc(a.result) : esc(a.status)}</td><td>${a.flags_count || 0}</td></tr>`; }).join('')}</table>
      ${qStats ? `<h2>Question analysis</h2><table><tr><th>No.</th><th>Marks</th><th style="width:55%">Average achieved</th></tr>${qStats.map(x => `<tr><td>${esc(x.q.id)}</td><td>${x.q.marks}</td><td><div class="bar"><i style="width:${x.avg || 0}%"></i></div>${x.avg == null ? '–' : x.avg + '%'}</td></tr>`).join('')}</table>` : ''}
      ${signBlock(commonSignoff(attempts), true)}
      <div class="foot">Pass mark ${exam.pass_mark}% · C = Competent, NYC = Not Yet Competent · Generated ${fmtDT(new Date())} · Author: Eddie Bila</div></div>`;
  }
  attempts.filter(a => a.status !== 'in_progress').forEach(a => html += learnerPage(exam, a, true));
  printDoc(summary ? `${exam.code} Class Report` : attempts.length === 1 ? `${attempts[0].full_name} - ${exam.code} Report` : `${exam.code} Learner Reports`, html);
}
function printLearnerResult(x) {
  const exam = { title: x.exam_title, qualification: x.qualification, code: x.exam_code, total_marks: x.total_marks, pass_mark: x.pass_mark, paper: { questions: (x.questions || []).map(q => ({ id: q.id, section: q.section, marks: q.max })) }, memo: { answers: (x.questions || []).filter(q => q.tip).map(q => ({ id: q.id, tip: q.tip })) } };
  const scores = Object.fromEntries((x.questions || []).map(q => [q.id, { mark: q.mark }]));
  printDoc(`${x.learner_name} - ${x.exam_code} Report`, learnerPage(exam, { full_name: x.learner_name, email: x.learner_email, id_number: x.learner_id_number, signoff: x.signoff, total: x.total, percent: x.percent, result: x.result, finalised: true, feedback: x.feedback, scores, submitted_at: x.submitted_at, status: 'submitted' }, false));
}

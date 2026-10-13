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

// ---------- marking list ----------
on(/^#\/mark\/([\w-]+)$/, async (examId) => {
  const r = await api('exm_marking_list', { p_exam_id: examId });
  const exam = r.exam, list = r.attempts || [];
  const done = list.filter(a => a.finalised).length;
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker">Marking · ${esc(exam.code)}</div><h1>${esc(exam.title)}</h1><p>${list.length} scripts · ${done} finalised · MCQs are marked automatically on submission.</p></div>
    <div class="row"><a class="btn ghost" href="#/reports/${examId}">Reports</a>${isAdmin(S.user) ? '<button class="btn" id="rel">Release selected</button><button class="btn gold" id="mail">Email reports to selected</button>' : ''}</div></div>
  <div class="card"><div class="tablewrap"><table class="t"><thead><tr><th><input type="checkbox" id="all"></th><th>Learner</th><th>Status</th><th>Mark</th><th>Result</th><th>Marking</th><th>Released</th><th>Emailed</th><th>Flags</th><th></th></tr></thead><tbody>
  ${list.map(a => `<tr><td><input type="checkbox" class="sel" value="${a.id}"></td><td><b>${esc(a.full_name)}</b><br><small>${esc(a.email)}</small></td><td>${attemptPill(a.status)}</td>
    <td>${a.total != null ? `${a.total} / ${exam.total_marks} <small>(${a.percent ?? '–'}%)</small>` : '–'}</td><td>${a.result && a.finalised ? `<span class="pill ${a.result === 'Competent' ? 'ok' : 'bad'}">${esc(a.result)}</span>` : ''}</td>
    <td>${a.finalised ? '<span class="pill ok">Finalised</span>' : a.marked_at ? '<span class="pill warn">Draft</span>' : a.status === 'in_progress' ? '<span class="muted">Writing</span>' : '<span class="pill">To mark</span>'}</td>
    <td>${a.released_at ? fmtDT(a.released_at) : '–'}</td><td>${a.emailed_at ? fmtDT(a.emailed_at) : '–'}</td><td>${a.flags_count ? `<span class="pill ${a.flags_count > 5 ? 'bad' : 'warn'}">${a.flags_count}</span>` : '0'}</td>
    <td>${a.status !== 'in_progress' ? `<a class="btn xs" href="#/mark/${examId}/${a.id}">${a.finalised ? 'Review' : 'Mark'}</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="10">No scripts yet.</td></tr>'}
  </tbody></table></div></div>`));
  bindShell();
  $('#all').onchange = e => $$('.sel').forEach(c => c.checked = e.target.checked);
  const sel = () => $$('.sel:checked').map(c => c.value);
  if ($('#rel')) $('#rel').onclick = e => busy(e.currentTarget, async () => {
    const ids = sel(); if (!ids.length) throw new Error('Select learners first');
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
  const scores = JSON.parse(JSON.stringify(a.scores || {}));
  const answers = a.answers || {};
  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker"><a href="#/mark/${examId}">← All scripts</a> · ${idx + 1} of ${list.length}</div><h1>${esc(a.full_name)}</h1><p>${esc(a.email)} · ${attemptPill(a.status)} · submitted ${fmtDT(a.submitted_at)}</p></div>
    <div class="row"><button class="btn ghost" id="ev">Integrity: ${a.flags_count || 0} flags</button></div></div>
  <div id="qs"></div>
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
      ${correct === true ? '<span class="pill ok">Correct</span>' : correct === false ? '<span class="pill bad">Incorrect</span>' : ''}${auto ? '<span class="pill">auto</span>' : ''}
      <input class="markin" type="number" min="0" max="${q.marks}" step="0.5" value="${markOf(s) ?? ''}"><b>/ ${q.marks}</b></div>
      <div class="mb"><div><small class="kicker">Learner's answer</small><div class="ans">${renderAnswer(q, answers[q.id])}</div></div>
      <div><small class="kicker">Memo</small><div class="memo">${q.type === 'mcq' && m.answer ? `<b>Answer: ${esc(m.answer)}</b>\n` : ''}${esc(m.model_answer || '–')}</div>${m.marking_guide ? `<div class="memo" style="margin-top:8px"><b>Marking guide:</b> ${esc(m.marking_guide)}</div>` : ''}
        <div class="quick" style="margin-top:10px">${Array.from({ length: Math.floor(q.marks) + 1 }, (_, i) => `<button class="btn xs ghost" data-v="${i}">${i}</button>`).join('')}</div>
        <input class="cmt" placeholder="Comment for this question (optional)" value="${esc((s && s.comment) || '')}" style="margin-top:8px"></div></div></div>`;
  }).join('');
  $$('.mq').forEach(box => {
    const id = box.dataset.q, q = qs.find(x => x.id === id), inp = $('.markin', box);
    const set = v => { v = num(v); if (v != null) v = Math.max(0, Math.min(q.marks, v)); scores[id] = { ...(scores[id] || {}), mark: v, auto: false }; if (v == null) delete scores[id].mark; upd(); };
    inp.oninput = () => set(inp.value);
    $$('[data-v]', box).forEach(b => b.onclick = () => { inp.value = b.dataset.v; set(b.dataset.v); });
    $('.cmt', box).oninput = e => { scores[id] = { ...(scores[id] || {}), comment: e.target.value }; };
  });
  upd();
  $('#ev').onclick = () => evidenceTimeline(examId, a);
  $('#gen').onclick = () => { $('#fb').value = autoFeedback(exam, a, scores); };
  const save = async fin => {
    const clean = {}; Object.entries(scores).forEach(([k, v]) => { if (markOf(v) != null || (v && v.comment)) clean[k] = { mark: markOf(v) ?? 0, ...(v.comment ? { comment: v.comment } : {}), ...(v.auto ? { auto: true } : {}) }; });
    if (fin) { const un = qs.filter(q => markOf(scores[q.id]) == null); if (un.length && !await confirmBox('Unmarked questions', `${un.map(q => q.id).join(', ')} have no mark and will count as 0. Finalise anyway?`, 'Finalise')) return; }
    if (fin && !$('#fb').value.trim()) $('#fb').value = autoFeedback(exam, a, scores);
    await api('exm_marking_save', { p_attempt_id: aid, p_scores: clean, p_feedback: $('#fb').value, p_finalise: !!fin });
    toast(fin ? 'Finalised' : 'Draft saved', 'ok');
    if (fin) go(next ? `#/mark/${examId}/${next.id}` : `#/mark/${examId}`);
  };
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
.diag{height:6px;background:repeating-linear-gradient(135deg,#C9A227 0 10px,transparent 10px 20px);opacity:.5;margin:10px 0}
`;
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
      <div class="foot">Pass mark ${exam.pass_mark}% · C = Competent, NYC = Not Yet Competent · Generated ${fmtDT(new Date())} · Author: Eddie Bila</div></div>`;
  }
  attempts.filter(a => a.status !== 'in_progress').forEach(a => html += learnerPage(exam, a, true));
  printDoc(summary ? `${exam.code} Class Report` : attempts.length === 1 ? `${attempts[0].full_name} - ${exam.code} Report` : `${exam.code} Learner Reports`, html);
}
function printLearnerResult(x) {
  const exam = { title: x.exam_title, qualification: x.qualification, code: x.exam_code, total_marks: x.total_marks, pass_mark: x.pass_mark, paper: { questions: (x.questions || []).map(q => ({ id: q.id, section: q.section, marks: q.max })) }, memo: { answers: (x.questions || []).filter(q => q.tip).map(q => ({ id: q.id, tip: q.tip })) } };
  const scores = Object.fromEntries((x.questions || []).map(q => [q.id, { mark: q.mark }]));
  printDoc(`${x.learner_name} - ${x.exam_code} Report`, learnerPage(exam, { full_name: x.learner_name, email: x.learner_email, total: x.total, percent: x.percent, result: x.result, finalised: true, feedback: x.feedback, scores, submitted_at: x.submitted_at, status: 'submitted' }, false));
}

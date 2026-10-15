// Camblish Online Exam: dashboards, exam editor, users, settings
// Author: Eddie Bila
const LIBS = {
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  qr: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
};
const statusPill = s => ({ draft: '<span class="pill">Draft</span>', open: '<span class="pill ok">Open</span>', closed: '<span class="pill warn">Closed</span>', archived: '<span class="pill">Archived</span>' }[s] || `<span class="pill">${esc(s)}</span>`);
const attemptPill = s => ({ in_progress: '<span class="pill blue">Writing</span>', submitted: '<span class="pill ok">Submitted</span>', auto_submitted: '<span class="pill gold">Auto-submitted</span>', terminated: '<span class="pill bad">Terminated</span>' }[s] || `<span class="pill">${esc(s || 'Not started')}</span>`);

// ---------- home ----------
on(/^#\/home$/, async () => {
  if (isStaff(S.user)) return staffHome();
  return learnerHome();
});

async function staffHome() {
  setApp(shell('home', `<div class="pagehead"><div><div class="kicker">Assessments</div><h1>Exams</h1><p>Create, invigilate, mark and report.</p></div>${isAdmin(S.user) ? '<a class="btn gold" href="#/exam/new">+ New exam</a>' : ''}</div><div id="list" class="card">Loading…</div>`));
  bindShell();
  const r = await api('exm_exam_list');
  const ex = r.exams || [];
  $('#list').innerHTML = ex.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Exam</th><th>Code</th><th>Status</th><th>Duration</th><th>Writing</th><th>Submitted</th><th>Marked</th><th></th></tr></thead><tbody>
    ${ex.map(e => `<tr><td><b>${esc(e.title)}</b><br><small>${esc(e.qualification || '')} ${e.question_count ? '· ' + e.question_count + ' questions · ' + (e.total_marks || 0) + ' marks' : ''}</small></td>
      <td><code>${esc(e.code)}</code></td><td>${statusPill(e.status)}</td><td>${e.duration_min} min + ${e.grace_min}</td>
      <td>${e.counts?.in_progress || 0}</td><td>${e.counts?.submitted || 0}</td><td>${e.counts?.marked || 0}</td>
      <td><div class="row" style="gap:6px;justify-content:flex-end">
        ${isAdmin(S.user) ? `<a class="btn xs ghost" href="#/exam/${e.id}">Edit</a>` : ''}
        ${e.question_count ? `<a class="btn xs ghost" href="#/preview/${e.id}">Preview</a>` : ''}
        ${S.user.role !== 'marker' ? `<a class="btn xs navy" href="#/invig/${e.id}">Invigilate</a>` : ''}
        ${S.user.role !== 'invigilator' ? `<a class="btn xs" href="#/mark/${e.id}">Mark</a>` : ''}
        <a class="btn xs gold" href="#/reports/${e.id}">Reports</a></div></td></tr>`).join('')}
    </tbody></table></div>` : `<p>No exams yet.</p>${isAdmin(S.user) ? '<a class="btn" href="#/exam/new">Create the first exam</a>' : ''}`;
}

async function learnerHome() {
  setApp(shell('home', `<div class="pagehead"><div><div class="kicker">Learner</div><h1>My exams</h1><p>Exams open to you appear here. You can only start an exam when the invigilator opens it.</p></div></div><div id="list" class="grid2">Loading…</div>`));
  bindShell();
  const pi = platformInfo();
  if (!pi.ok) $('#list').insertAdjacentHTML('beforebegin', `<div class="notice bad" style="margin-bottom:14px"><b>This device cannot be used for exams.</b> You are on ${esc(pi.browser)} / ${esc(pi.os)}. Exams must be written in Google Chrome on a Windows laptop or a MacBook.</div>`);
  const r = await api('exm_exam_list');
  const ex = r.exams || [];
  $('#list').innerHTML = ex.length ? ex.map(e => {
    const a = e.attempt;
    let action = '';
    if (!a && e.can_start) action = `<a class="btn gold" href="#/precheck/${e.id}">Start exam</a>`;
    else if (a && a.status === 'in_progress') action = `<a class="btn" href="#/precheck/${e.id}">Resume exam</a>`;
    else if (a && a.released) action = `<a class="btn ghost" href="#/results">View result</a>`;
    else if (a) action = `<span class="muted">Submitted ${fmtDT(a.submitted_at)}. Results will be emailed once marked.</span>`;
    else action = '<span class="muted">Not open yet</span>';
    return `<div class="card"><div class="row between"><span class="kicker">${esc(e.code)}</span>${a ? attemptPill(a.status) : statusPill(e.status)}</div>
      <h2 style="margin-top:6px">${esc(e.title)}</h2><p class="muted">${esc(e.qualification || '')}</p>
      <div class="row" style="margin-bottom:14px"><span class="pill">${e.duration_min} minutes</span><span class="pill">+${e.grace_min} min grace</span><span class="pill">${e.total_marks || '–'} marks</span><span class="pill">Pass ${e.pass_mark}%</span></div>
      ${a && a.released ? `<p><b>${a.percent}%</b> · ${esc(a.result)}</p>` : ''}${action}</div>`;
  }).join('') : '<div class="card">There are no exams open to you right now.</div>';
}

// ---------- learner results ----------
on(/^#\/results$/, async () => {
  setApp(shell('results', `<div class="pagehead"><div><div class="kicker">Learner</div><h1>My results</h1></div></div><div id="res">Loading…</div>`));
  bindShell();
  const r = await api('exm_my_results');
  const list = r.results || [];
  $('#res').innerHTML = list.length ? list.map((x, i) => `<div class="card" style="margin-bottom:14px">
    <div class="row between"><div><div class="kicker">${esc(x.exam_code)}</div><h2>${esc(x.exam_title)}</h2></div>
    <div style="text-align:right"><div style="font-size:32px;font-weight:700;color:var(--navy)">${x.percent}%</div><span class="pill ${x.result === 'Competent' ? 'ok' : 'bad'}">${esc(x.result)}</span></div></div>
    <p>${x.total} / ${x.total_marks} marks · pass mark ${x.pass_mark}%</p>
    <div class="grid3">${(x.sections || []).map(s => `<div class="stat"><div class="l">Section ${esc(s.section)}</div><div class="v">${s.mark}/${s.max}</div></div>`).join('')}</div>
    ${x.feedback ? `<h3 style="margin-top:16px">Assessor feedback</h3><p style="white-space:pre-wrap">${esc(x.feedback)}</p>` : ''}
    ${(x.questions || []).some(q => q.tip) ? `<h3 style="margin-top:16px">Areas to improve</h3><ul>${x.questions.filter(q => q.tip).slice(0, 12).map(q => `<li><b>${esc(q.id)}</b> (${q.mark}/${q.max}): ${esc(q.tip)}</li>`).join('')}</ul>` : ''}
    <button class="btn ghost sm" data-i="${i}">Download my report (PDF)</button></div>`).join('') : '<div class="card">No results have been released yet.</div>';
  $$('#res [data-i]').forEach(b => b.onclick = () => printLearnerResult(list[+b.dataset.i]));
});

// ---------- exam editor ----------
on(/^#\/exam\/([\w-]+)$/, async (id) => {
  let exam = { title: '', qualification: 'Occupational Certificate: Data Science Practitioner', saqa_id: '118708', duration_min: 180, grace_min: 15, pass_mark: 60, status: 'draft', instructions: [], paper: { questions: [] }, memo: { answers: [] }, datasets: [], settings: { snapshot_sec: 120, require_phone: true, allowed_emails: [] } };
  if (id !== 'new') { const r = await api('exm_exam_get', { p_exam_id: id }); exam = r.exam; }
  exam.paper = exam.paper || { questions: [] }; exam.paper.questions = exam.paper.questions || [];
  exam.memo = exam.memo || { answers: [] }; exam.memo.answers = exam.memo.answers || [];
  exam.settings = Object.assign({ snapshot_sec: 120, require_phone: true, allowed_emails: [] }, exam.settings || {});
  exam.datasets = exam.datasets || [];
  const toLocal = d => d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

  setApp(shell('home', `
  <div class="pagehead"><div><div class="kicker">${id === 'new' ? 'New exam' : 'Exam code ' + esc(exam.code)}</div><h1>${esc(exam.title || 'New exam')}</h1></div>
    <div class="row">${id !== 'new' ? `<a class="btn ghost" href="#/preview/${id}">Preview paper</a><a class="btn ghost" href="#/precheck/${id}" title="Sit the exam yourself with full proctoring (exam must be Open)">Test run</a><a class="btn ghost" href="#/invig/${id}">Invigilate</a><a class="btn ghost" href="#/mark/${id}">Mark</a>` : ''}<button class="btn gold" id="save">Save exam</button></div></div>
  <div class="stack">
  <div class="card"><h2>1. Exam details</h2>
    <div class="grid2">
      <div class="field"><label>Title</label><input id="title" value="${esc(exam.title)}" placeholder="EISA Practice Assessment (Version B)"></div>
      <div class="field"><label>Qualification</label><input id="qual" value="${esc(exam.qualification || '')}"></div>
      <div class="field"><label>SAQA ID</label><input id="saqa" value="${esc(exam.saqa_id || '')}"></div>
      <div class="field"><label>Status</label><select id="status">${['draft', 'open', 'closed', 'archived'].map(s => `<option ${exam.status === s ? 'selected' : ''} value="${s}">${s[0].toUpperCase() + s.slice(1)}${s === 'open' ? ' (learners can start)' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Duration (minutes)</label><input id="dur" type="number" min="5" max="600" value="${exam.duration_min}"></div>
      <div class="field"><label>Grace period (minutes)</label><input id="grace" type="number" min="0" max="60" value="${exam.grace_min}"><div class="hint">Extra time after the duration to finish and submit. The exam then submits itself.</div></div>
      <div class="field"><label>Pass mark (%)</label><input id="pass" type="number" min="0" max="100" value="${exam.pass_mark}"></div>
      <div class="field"><label>Total marks</label><input id="total" type="number" value="${exam.total_marks || ''}" placeholder="Calculated from questions"></div>
      <div class="field"><label>Opens (optional)</label><input id="opens" type="datetime-local" value="${toLocal(exam.opens_at)}"></div>
      <div class="field"><label>Closes (optional)</label><input id="closes" type="datetime-local" value="${toLocal(exam.closes_at)}"></div>
    </div>
  </div>
  <div class="card"><h2>2. Question paper</h2>
    <p class="muted">Upload the question paper as Word (.docx) or PDF. Questions are detected from their numbers (A1, B1.1, C2.3.1 …), marks in brackets like (4), and options like a) b) c). Check the preview and fix anything before opening the exam.</p>
    <div class="row"><input type="file" id="paperFile" accept=".docx,.pdf,.json" style="max-width:360px"><span id="paperMsg" class="muted"></span></div>
    <div id="qprev" style="margin-top:14px"></div>
  </div>
  <div class="card"><h2>3. Memorandum</h2>
    <p class="muted">Upload the memo (Word, PDF or JSON). Each answer starts with the question number. MCQ answers like "A1 Answer: b" are marked automatically; the rest is shown to the marker next to the learner's answer. "Improvement tip:" lines are used in the learner's emailed report.</p>
    <div class="row"><input type="file" id="memoFile" accept=".docx,.pdf,.json" style="max-width:360px"><span id="memoMsg" class="muted"></span></div>
    <div id="mprev" style="margin-top:14px"></div>
  </div>
  <div class="card"><h2>4. Data files for learners</h2>
    <p class="muted">These are loaded into each learner's Python workspace in the exam (folder <code>/data</code>), e.g. <code>pd.read_csv('sales.csv')</code>.</p>
    <div class="row"><input type="file" id="dataFiles" multiple style="max-width:360px"><span id="dataMsg" class="muted"></span></div>
    <ul id="dlist" class="files" style="margin-top:12px"></ul>
  </div>
  <div class="card"><h2>5. Instructions to candidates</h2><p class="muted">One instruction per line. Shown before the learner starts.</p>
    <textarea id="instr" style="min-height:200px">${esc((exam.instructions || []).join('\n'))}</textarea></div>
  <div class="card"><h2>6. Invigilation settings</h2>
    <div class="grid2">
      <div class="field"><label>Evidence snapshot every (seconds)</label><input id="snap" type="number" min="10" max="300" value="${exam.settings.snapshot_sec}"></div>
      <div class="field"><label>Question order</label>
        <label class="check"><input type="checkbox" id="shuf" ${exam.settings.shuffle !== false ? 'checked' : ''}> Give every learner a different question order and MCQ option order</label>
        <label class="check" style="margin-top:6px"><input type="checkbox" id="reshuf" ${exam.settings.reshuffle_on_flag !== false ? 'checked' : ''}> Reshuffle the questions each time a learner leaves the exam screen or their phone moves</label></div>
      <div class="field"><label>Phone camera</label><label class="check"><input type="checkbox" id="reqphone" ${exam.settings.require_phone ? 'checked' : ''}> Learners must pair their phone as a side camera</label></div>
    </div>
    <div class="field"><label>Only allow these learner emails (optional, one per line)</label><textarea id="allowed" placeholder="Leave empty to allow any registered learner">${esc((exam.settings.allowed_emails || []).join('\n'))}</textarea></div>
  </div>
  </div>`));
  bindShell();

  const renderQ = () => {
    const qs = exam.paper.questions;
    const tot = qs.reduce((s, q) => s + (+q.marks || 0), 0);
    const bySec = {}; qs.forEach(q => bySec[q.section || q.id[0]] = (bySec[q.section || q.id[0]] || 0) + (+q.marks || 0));
    $('#qprev').innerHTML = qs.length ? `
      <div class="row" style="margin-bottom:10px"><span class="pill blue">${qs.length} questions</span><span class="pill ${exam.total_marks && +exam.total_marks !== tot ? 'bad' : 'ok'}">${tot} marks</span>${Object.entries(bySec).map(([k, v]) => `<span class="pill">Section ${k}: ${v}</span>`).join('')}<span class="pill">${qs.filter(q => q.type === 'mcq').length} MCQ · ${qs.filter(q => q.type === 'code').length} coding · ${qs.filter(q => q.type === 'text').length} written</span><button class="btn xs ghost" id="addq">+ Add question</button></div>
      <div class="tablewrap"><table class="t"><thead><tr><th style="width:80px">No.</th><th>Question</th><th style="width:110px">Type</th><th style="width:80px">Marks</th><th style="width:70px"></th></tr></thead><tbody>
      ${qs.map((q, i) => `<tr><td><code>${esc(q.id)}</code></td><td><div style="max-height:4.6em;overflow:hidden">${esc(q.text)}</div>${q.options ? `<small>${q.options.map(o => esc(o.key + ') ' + o.text)).join(' · ')}</small>` : ''}</td>
        <td><select data-type="${i}">${['mcq', 'code', 'text'].map(t => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${{ mcq: 'Multiple choice', code: 'Code + answer', text: 'Written' }[t]}</option>`).join('')}</select></td>
        <td><input data-marks="${i}" type="number" step="0.5" min="0" value="${q.marks}" style="width:70px"></td>
        <td><button class="btn xs ghost" data-edit="${i}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No questions yet. Upload a paper.</p>';
    $$('[data-type]').forEach(s => s.onchange = () => { qs[+s.dataset.type].type = s.value; });
    $$('[data-marks]').forEach(s => s.onchange = () => { qs[+s.dataset.marks].marks = +s.value; renderQ(); });
    $$('[data-edit]').forEach(b => b.onclick = () => editQuestion(qs, +b.dataset.edit, renderQ));
    const add = $('#addq'); if (add) add.onclick = () => { qs.push({ id: 'Q' + (qs.length + 1), section: 'A', group: '', context: '', text: '', marks: 1, type: 'text' }); editQuestion(qs, qs.length - 1, renderQ); };
    renderM();
  };
  const renderM = () => {
    const qs = exam.paper.questions, ans = exam.memo.answers;
    const map = Object.fromEntries(ans.map(a => [a.id, a]));
    const missing = qs.filter(q => !map[q.id]);
    const mcqNoKey = qs.filter(q => q.type === 'mcq' && !(map[q.id] && map[q.id].answer));
    $('#mprev').innerHTML = ans.length ? `<div class="row" style="margin-bottom:8px"><span class="pill ok">${ans.length} memo answers</span>${missing.length ? `<span class="pill warn">No memo for ${missing.map(q => q.id).join(', ')}</span>` : '<span class="pill ok">Every question has a memo</span>'}${mcqNoKey.length ? `<span class="pill bad">MCQ without answer key: ${mcqNoKey.map(q => q.id).join(', ')}</span>` : ''}</div>
      <div class="tablewrap"><table class="t"><thead><tr><th>No.</th><th>Key</th><th>Model answer</th><th>Tip</th><th></th></tr></thead><tbody>
      ${qs.map(q => { const a = map[q.id] || {}; return `<tr><td><code>${esc(q.id)}</code></td><td>${q.type === 'mcq' ? `<b>${esc(a.answer || '–')}</b>` : ''}</td><td><div style="max-height:3em;overflow:hidden;font-size:13px">${esc(a.model_answer || '')}</div></td><td><small>${esc((a.tip || '').slice(0, 90))}</small></td><td><button class="btn xs ghost" data-medit="${esc(q.id)}">Edit</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted">No memo yet.</p>';
    $$('[data-medit]').forEach(b => b.onclick = () => editMemo(exam, b.dataset.medit, renderM));
  };
  const renderD = () => {
    $('#dlist').innerHTML = exam.datasets.length ? exam.datasets.map((d, i) => `<li>${esc(d.name)} <small class="muted">${fmtSize(d.size || 0)}</small> <a href="#" data-rm="${i}">remove</a></li>`).join('') : '<li class="muted" style="font-family:inherit">No data files yet.</li>';
    $$('[data-rm]').forEach(a => a.onclick = e => { e.preventDefault(); exam.datasets.splice(+a.dataset.rm, 1); renderD(); });
  };
  renderQ(); renderD();

  const collect = () => {
    const v = id => $('#' + id).value;
    const iso = x => x ? new Date(x).toISOString() : null;
    const o = {
      title: v('title').trim(), qualification: v('qual').trim(), saqa_id: v('saqa').trim(), status: v('status'),
      duration_min: +v('dur') || 180, grace_min: +v('grace') || 0, pass_mark: +v('pass') || 60,
      opens_at: iso(v('opens')), closes_at: iso(v('closes')),
      instructions: v('instr').split('\n').map(s => s.trim()).filter(Boolean),
      paper: exam.paper, memo: exam.memo, datasets: exam.datasets,
      settings: { ...exam.settings, snapshot_sec: +v('snap') || 30, require_phone: $('#reqphone').checked, shuffle: $('#shuf').checked, reshuffle_on_flag: $('#reshuf').checked, allowed_emails: v('allowed').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean) },
    };
    if (v('total')) o.total_marks = +v('total');
    if (exam.id) o.id = exam.id;
    return o;
  };
  const save = async (quiet) => {
    const o = collect();
    if (!o.title) throw new Error('Give the exam a title first');
    if (o.status === 'open') {
      if (!o.paper.questions.length) throw new Error('Upload a question paper before opening the exam');
      if (o.paper.questions.some(q => q.type === 'mcq') && !o.memo.answers.length) {
        if (!await confirmBox('No memo yet', 'MCQs cannot be auto-marked without a memo. You can add it later. Open anyway?', 'Open anyway')) throw new Error('Not saved');
      }
    }
    const r = await api('exm_exam_save', { p_exam: o });
    const wasNew = !exam.id;
    exam = Object.assign(exam, r.exam);
    if (!quiet) toast('Exam saved', 'ok');
    if (wasNew) history.replaceState(null, '', '#/exam/' + exam.id);
    return exam;
  };
  $('#save').onclick = e => busy(e.currentTarget, () => save()).catch(() => { });

  $('#paperFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $('#paperMsg').textContent = 'Reading ' + f.name + '…';
    try {
      const parsed = await parsePaperFile(f);
      if (!parsed.questions.length) throw new Error('No numbered questions were found. Check that each question starts with its number (e.g. A1, B1.1).');
      const replace = !exam.paper.questions.length || await confirmBox('Replace questions?', `Found ${parsed.questions.length} questions (${parsed.parsed_total} marks). Replace the current ${exam.paper.questions.length} questions?`, 'Replace');
      if (!replace) return;
      exam.paper = { ...exam.paper, questions: parsed.questions, source_file: f.name };
      if (!$('#title').value && parsed.title) $('#title').value = parsed.title;
      if (parsed.saqa_id && !$('#saqa').value) $('#saqa').value = parsed.saqa_id;
      if (parsed.duration_min) $('#dur').value = parsed.duration_min;
      if (parsed.pass_mark) $('#pass').value = parsed.pass_mark;
      if (parsed.total_marks) $('#total').value = parsed.total_marks;
      if (parsed.qualification && !$('#qual').value) $('#qual').value = parsed.qualification;
      if (parsed.instructions && parsed.instructions.length) $('#instr').value = parsed.instructions.join('\n');
      if (parsed.grace_min != null) $('#grace').value = parsed.grace_min;
      if (parsed.settings) {
        const st = parsed.settings;
        if (st.snapshot_sec) $('#snap').value = st.snapshot_sec;
        if (st.shuffle != null) $('#shuf').checked = !!st.shuffle;
        if (st.reshuffle_on_flag != null) $('#reshuf').checked = !!st.reshuffle_on_flag;
        if (st.require_phone != null) $('#reqphone').checked = !!st.require_phone;
      }
      if (parsed.memo && parsed.memo.answers && parsed.memo.answers.length && !exam.memo.answers.length) { exam.memo = { answers: parsed.memo.answers, source_file: f.name }; renderM(); $('#memoMsg').innerHTML = `<span class="pill ok">${parsed.memo.answers.length} answers</span>`; }
      renderQ();
      $('#paperMsg').innerHTML = `<span class="pill ok">${parsed.questions.length} questions · ${parsed.parsed_total} marks</span>`;
      if (parsed.total_marks && parsed.total_marks !== parsed.parsed_total) toast(`The paper says ${parsed.total_marks} marks but the questions add up to ${parsed.parsed_total}. Check the marks.`, 'bad');
      // keep the original file with the exam
      await save(true);
      fileToB64(f).then(b => fn('upload', { exam_id: exam.id, kind: 'paper', filename: f.name, content_type: f.type || 'application/octet-stream', data_base64: b })).catch(() => { });
      toast('Question paper loaded and saved', 'ok');
    } catch (err) { $('#paperMsg').textContent = ''; toast(err.message, 'bad'); }
    e.target.value = '';
  };
  $('#memoFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $('#memoMsg').textContent = 'Reading ' + f.name + '…';
    try {
      const memo = await parseMemoFile(f, exam.paper.questions.map(q => q.id));
      if (!memo.answers.length) throw new Error('No answers found. Each answer must start with its question number.');
      exam.memo = { answers: memo.answers, source_file: f.name };
      renderM();
      $('#memoMsg').innerHTML = `<span class="pill ok">${memo.answers.length} answers</span>`;
      await save(true);
      fileToB64(f).then(b => fn('upload', { exam_id: exam.id, kind: 'memo', filename: f.name, content_type: f.type || 'application/octet-stream', data_base64: b })).catch(() => { });
      toast('Memo loaded and saved', 'ok');
    } catch (err) { $('#memoMsg').textContent = ''; toast(err.message, 'bad'); }
    e.target.value = '';
  };
  $('#dataFiles').onchange = async e => {
    const files = Array.from(e.target.files); if (!files.length) return;
    try {
      if (!exam.id) await save(true);
      for (const f of files) {
        if (f.size > 20e6) { toast(f.name + ' is larger than 20 MB, skipped', 'bad'); continue; }
        $('#dataMsg').textContent = 'Uploading ' + f.name + '…';
        const r = await fn('upload', { exam_id: exam.id, kind: 'dataset', filename: f.name, content_type: f.type || 'application/octet-stream', data_base64: await fileToB64(f) });
        exam.datasets = exam.datasets.filter(d => d.name !== f.name).concat([{ name: f.name, path: r.path, size: r.size || f.size }]);
        renderD();
      }
      await save(true);
      $('#dataMsg').textContent = '';
      toast('Data files uploaded', 'ok');
    } catch (err) { $('#dataMsg').textContent = ''; toast(err.message, 'bad'); }
    e.target.value = '';
  };
}, { admin: true });

async function fileLines(f) {
  const buf = await f.arrayBuffer();
  if (/\.docx$/i.test(f.name)) { await loadScript(LIBS.mammoth); const r = await window.mammoth.extractRawText({ arrayBuffer: buf }); return r.value.split(/\n+/); }
  if (/\.pdf$/i.test(f.name)) { await loadScript(LIBS.pdf); window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker; return ExamParser.linesFromPdf(buf, window.pdfjsLib); }
  throw new Error('Use a .docx, .pdf or .json file');
}
async function parsePaperFile(f) {
  if (/\.json$/i.test(f.name)) { const j = JSON.parse(await f.text()); const qs = j.questions || (j.paper && j.paper.questions) || []; return { ...j, questions: qs, parsed_total: qs.reduce((s, q) => s + (+q.marks || 0), 0) }; }
  return ExamParser.parsePaper(await fileLines(f));
}
async function parseMemoFile(f, ids) {
  if (/\.json$/i.test(f.name)) { const j = JSON.parse(await f.text()); return { answers: j.answers || (j.memo && j.memo.answers) || [] }; }
  return ExamParser.parseMemo(await fileLines(f), ids);
}

function editQuestion(qs, i, done) {
  const q = qs[i];
  const body = el(`<div>
    <div class="grid3"><div class="field"><label>Number</label><input id="qid" value="${esc(q.id)}"></div><div class="field"><label>Section</label><input id="qsec" value="${esc(q.section || '')}"></div><div class="field"><label>Marks</label><input id="qm" type="number" step="0.5" value="${q.marks}"></div></div>
    <div class="field"><label>Group heading</label><input id="qg" value="${esc(q.group || '')}"></div>
    <div class="field"><label>Scenario / context shown above the question</label><textarea id="qc">${esc(q.context || '')}</textarea></div>
    <div class="field"><label>Question</label><textarea id="qt" style="min-height:140px">${esc(q.text)}</textarea></div>
    <div class="field"><label>Type</label><select id="qty">${['mcq', 'code', 'text'].map(t => `<option ${q.type === t ? 'selected' : ''} value="${t}">${{ mcq: 'Multiple choice', code: 'Code + answer', text: 'Written' }[t]}</option>`).join('')}</select></div>
    <div class="field"><label>Options (multiple choice, one per line as "a) text")</label><textarea id="qo">${esc((q.options || []).map(o => o.key + ') ' + o.text).join('\n'))}</textarea></div>
  </div>`);
  modal({
    title: 'Edit question ' + q.id, body, wide: true, actions: [
      { label: 'Delete question', cls: 'danger', onClick: async () => { if (await confirmBox('Delete question', 'Remove ' + q.id + ' from the paper?', 'Delete', 'danger')) { qs.splice(i, 1); done(); return true; } return false; } },
      { label: 'Cancel', cls: 'ghost' },
      {
        label: 'Save', onClick: () => {
          q.id = $('#qid', body).value.trim(); q.section = $('#qsec', body).value.trim() || q.id[0]; q.marks = +$('#qm', body).value || 0;
          q.group = $('#qg', body).value; q.context = $('#qc', body).value; q.text = $('#qt', body).value; q.type = $('#qty', body).value;
          const opts = $('#qo', body).value.split('\n').map(l => l.match(/^\(?([a-hA-H])[).]\s*(.+)$/)).filter(Boolean).map(m => ({ key: m[1].toLowerCase(), text: m[2].trim() }));
          if (opts.length) q.options = opts; else delete q.options;
          done();
        }
      }]
  });
}
function editMemo(exam, qid, done) {
  let a = exam.memo.answers.find(x => x.id === qid);
  const q = exam.paper.questions.find(x => x.id === qid) || {};
  const body = el(`<div>
    ${q.type === 'mcq' ? `<div class="field"><label>Correct option</label><select id="ma">${['', ...(q.options || []).map(o => o.key)].map(k => `<option ${a && a.answer === k ? 'selected' : ''} value="${k}">${k ? k + ') ' + esc((q.options.find(o => o.key === k) || {}).text || '') : '–'}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>Model answer</label><textarea id="mm" style="min-height:160px">${esc(a ? a.model_answer || '' : '')}</textarea></div>
    <div class="field"><label>Marking guide</label><textarea id="mg">${esc(a ? a.marking_guide || '' : '')}</textarea></div>
    <div class="field"><label>Improvement tip (goes into the learner's report)</label><textarea id="mt" style="min-height:70px">${esc(a ? a.tip || '' : '')}</textarea></div></div>`);
  modal({
    title: 'Memo for ' + qid, body, wide: true, actions: [{ label: 'Cancel', cls: 'ghost' }, {
      label: 'Save', onClick: () => {
        if (!a) { a = { id: qid }; exam.memo.answers.push(a); }
        if ($('#ma', body)) a.answer = $('#ma', body).value;
        a.model_answer = $('#mm', body).value; a.marking_guide = $('#mg', body).value; a.tip = $('#mt', body).value; done();
      }
    }]
  });
}

// ---------- users ----------
on(/^#\/users$/, async () => {
  setApp(shell('users', `<div class="pagehead"><div><div class="kicker">Administration</div><h1>Users</h1><p>Learners register themselves. Give staff the invigilator or marker role here.</p></div><button class="btn gold" id="add">+ Add user</button></div><div class="card" id="ul">Loading…</div>`));
  bindShell();
  const load = async () => {
    const r = await api('exm_admin_users');
    const us = r.users || [];
    $('#ul').innerHTML = `<div class="row" style="margin-bottom:10px"><input id="q" placeholder="Search name or email" style="max-width:300px"><span class="muted">${us.length} users</span></div><div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>ID / Cell</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr data-s="${esc((u.full_name + ' ' + u.email).toLowerCase())}"><td><b>${esc(u.full_name)}</b></td><td>${esc(u.email)}</td><td><small>${esc(u.id_number || '')}<br>${esc(u.phone || '')}</small></td>
      <td><select data-role="${u.id}" style="width:auto">${['learner', 'invigilator', 'marker', 'admin'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td>${u.active ? '<span class="pill ok">Active</span>' : '<span class="pill">Inactive</span>'}${u.locked_until && new Date(u.locked_until) > new Date() ? ' <span class="pill bad">Locked</span>' : ''}</td><td><small>${fmtDT(u.created_at)}</small></td>
      <td><div class="row" style="gap:4px"><button class="btn xs ghost" data-pw="${u.id}">Reset password</button><button class="btn xs ghost" data-act="${u.id}" data-on="${u.active ? 1 : 0}">${u.active ? 'Deactivate' : 'Activate'}</button></div></td></tr>`).join('')}
    </tbody></table></div>`;
    $('#q').oninput = e => { const v = e.target.value.toLowerCase(); $$('tr[data-s]').forEach(tr => tr.classList.toggle('hidden', !tr.dataset.s.includes(v))); };
    $$('[data-role]').forEach(s => s.onchange = async () => { try { await api('exm_admin_user_update', { p_user_id: s.dataset.role, p_patch: { role: s.value } }); toast('Role updated', 'ok'); } catch (e) { toast(e.message, 'bad'); load(); } });
    $$('[data-act]').forEach(b => b.onclick = async () => { try { await api('exm_admin_user_update', { p_user_id: b.dataset.act, p_patch: { active: b.dataset.on !== '1' } }); load(); } catch (e) { toast(e.message, 'bad'); } });
    $$('[data-pw]').forEach(b => b.onclick = async () => { const p = await promptBox('Reset password', 'New password (min 8 characters). Share it with the user privately.', '', 'text'); if (!p) return; try { await api('exm_admin_user_update', { p_user_id: b.dataset.pw, p_patch: { new_password: p } }); toast('Password reset', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
  };
  $('#add').onclick = () => {
    const body = el(`<div><div class="field"><label>Full name</label><input id="n"></div><div class="field"><label>Email</label><input id="e" type="email"></div><div class="field"><label>Role</label><select id="r"><option>invigilator</option><option>marker</option><option>learner</option><option>admin</option></select></div><div class="field"><label>Temporary password</label><input id="p" minlength="8"></div></div>`);
    modal({ title: 'Add user', body, actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create', onClick: async () => { try { await api('exm_admin_create_user', { p_email: $('#e', body).value.trim(), p_full_name: $('#n', body).value.trim(), p_role: $('#r', body).value, p_password: $('#p', body).value }); toast('User created', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); return false; } } }] });
  };
  load();
}, { admin: true });

// ---------- settings ----------
on(/^#\/settings$/, async () => {
  const s = await api('exm_settings_get');
  setApp(shell('settings', `<div class="pagehead"><div><div class="kicker">Administration</div><h1>Settings</h1></div></div>
  <div class="card" style="max-width:720px"><h2>Results emails (Resend)</h2>
    <p class="muted">Reports are emailed through a free Resend account (resend.com, 3,000 emails a month). Create an API key there and paste it below. Until you verify camblish.co.za as a sending domain in Resend, emails can only be delivered to the email address that owns the Resend account.</p>
    <div class="field"><label>Resend API key</label><input id="key" type="password" placeholder="${s.resend_key_set ? 'Saved (ends in ' + esc(s.resend_key_hint) + '). Paste a new key to replace it.' : 're_…'}"></div>
    <div class="field"><label>Send from</label><input id="from" value="${esc(s.resend_from || '')}" placeholder="Camblish Assessments <assessments@camblish.co.za>"><div class="hint">Leave empty to use Resend's test sender (onboarding@resend.dev).</div></div>
    <div class="field"><label>Exam website address</label><input id="url" value="${esc(s.app_url || location.origin + location.pathname)}"><div class="hint">Used as the link in emails.</div></div>
    <button class="btn" id="sv">Save settings</button>
  </div>`));
  bindShell();
  $('#sv').onclick = e => busy(e.currentTarget, async () => {
    const patch = { resend_from: $('#from').value.trim(), app_url: $('#url').value.trim() };
    if ($('#key').value.trim()) patch.resend_key = $('#key').value.trim();
    await api('exm_settings_set', { p_patch: patch }); toast('Settings saved', 'ok'); route();
  }).catch(() => { });
}, { admin: true });

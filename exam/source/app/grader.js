// Camblish Online Exam: auto-marking engine
// Author: Eddie Bila
// Scores a learner answer against memo criteria. Every result is a suggestion the assessor confirms.
//
// memo answer may carry:  auto: { criteria: [ {label, marks, any:[..], all:[..], re:[..], num:[..], tol, where, min_words} ], pick: n }
//   any  - matched if ANY of these phrases appears (case-insensitive; '|' inside a phrase is not special)
//   all  - matched only if ALL of these phrases appear
//   re   - matched if ANY regular expression matches (case-insensitive)
//   num  - matched if ANY of these numbers appears (commas, spaces, R prefix and % ignored), within tol (default 0.6% or 0.01)
//   where - 'text' (written answer), 'code', 'output' (what their code printed), or 'all' (default)
//   min_words - written answer must have at least this many words
//   When a criterion lists several of any/all/re/num, every listed test must pass.
//   pick - for "any two of ..." questions: only the best `pick` matched criteria count.
(function (root) {
  const STOP = new Set('a an and are as at be by can could for from has have in into is it its of on or that the their them then there these this to was were which will with would each one two your you any not more most less than also may should must such using use used data dataset file write code python sql example answer marks mark accept learner'.split(' '));

  function parts(ans) {
    ans = ans || {};
    const cells = ans.cells || [];
    const code = cells.map(c => c.code || '').join('\n');
    const output = cells.map(c => (c.out || '') + '\n' + (c.err ? '' : '')).join('\n');
    const errors = cells.map(c => c.err || '').join('\n');
    const text = (ans.text || '') + (ans.choice ? '\n' + ans.choice : '');
    return { code, output, text, errors, all: [text, code, output].join('\n') };
  }
  const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
  function numbersIn(s) {
    // Each figure is read on its own: "1629   713.94" (a printed table row) or "[4, 9, 5]" stay separate numbers.
    // Thousands separators: a comma with no space ("12,179.00"), or a single space in SA style ("1 234 567.89");
    // for the space form the joined value is added as well as the separate parts, because a table row like
    // "380 679.54" is ambiguous.
    const out = [];
    const src = String(s || '').replace(/R(?=\s?\d)/g, '');
    let m;
    const re = /-?\d+(?:,\d{3})*(?:\.\d+)?|-?\.\d+/g;
    while ((m = re.exec(src))) {
      const v = parseFloat(m[0].replace(/,/g, ''));
      if (!isNaN(v)) out.push(v);
    }
    const sp = /(?<![\d.,])-?\d{1,3}(?: \d{3})+(?:\.\d+)?(?![\d,])/g;
    while ((m = sp.exec(src))) {
      const v = parseFloat(m[0].replace(/ /g, ''));
      if (!isNaN(v)) out.push(v);
    }
    return out;
  }
  function numHit(nums, target, tol) {
    const t = Math.abs(target);
    const eps = tol != null ? tol : Math.max(0.01, t * 0.006);
    return nums.some(v => {
      const a = Math.abs(v);
      if (Math.abs(a - t) <= eps) return true;                       // same figure
      if (a < 1 && t >= 1 && t <= 100 && Math.abs(a * 100 - t) <= eps) return true;  // 0.615 for 61.5%
      if (t < 1 && a >= 1 && a <= 100 && Math.abs(a / 100 - t) <= eps) return true;  // 61.5 for 0.615
      if (t >= 1e5 && Math.abs(a * 1e6 - t) <= Math.max(eps, t * 0.006)) return true; // R million notation
      return false;
    });
  }
  function words(s) { return (String(s || '').match(/[A-Za-z][A-Za-z']+/g) || []).length; }

  function testCriterion(c, P) {
    const hay = c.where && c.where !== 'all' ? P[c.where] : P.all;
    const h = norm(hay);
    const checks = [];
    if (c.any && c.any.length) checks.push(c.any.some(p => h.includes(norm(p))));
    if (c.all && c.all.length) checks.push(c.all.every(p => h.includes(norm(p))));
    if (c.re && c.re.length) checks.push(c.re.some(r => { try { return new RegExp(r, 'i').test(hay); } catch (e) { return false; } }));
    if (c.num && c.num.length) { const ns = numbersIn(hay); checks.push(c.num.some(n => numHit(ns, n, c.tol))); }
    if (c.min_words) checks.push(words(c.where ? P[c.where] : P.text) >= c.min_words);
    return checks.length > 0 && checks.every(Boolean);
  }

  // Fallback criteria when the memo has no auto block: key figures, then key words from the model answer.
  function derive(memo, q) {
    const model = String((memo && memo.model_answer) || '').split(/Reference code:/i)[0];
    const max = +q.marks || 1;
    const nums = [...new Set((model.match(/R?\d[\d,]*\.\d+|R?\d{1,3}(?:,\d{3})+|\b\d{4,}\b(?<!20[12]\d)/g) || [])
      .map(x => parseFloat(x.replace(/[R,]/g, ''))).filter(v => !isNaN(v) && !(v >= 2015 && v <= 2030)))].slice(0, 6);
    const crit = [];
    if (nums.length) nums.forEach((n, i) => crit.push({ label: 'Key figure ' + n.toLocaleString('en-ZA'), marks: max / Math.max(nums.length, 1), num: [n] }));
    else {
      const freq = {};
      (model.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).forEach(w => { if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1; });
      const keys = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
      return { criteria: keys.map(k => ({ label: k, marks: max / keys.length, any: [k] })), keywordMode: true };
    }
    return { criteria: crit };
  }

  function grade(q, memo, ans) {
    const max = +q.marks || 0;
    const P = parts(ans);
    const empty = !P.text.trim() && !P.code.trim();
    if (q.type === 'mcq' || (ans && ans.choice && !P.code.trim())) {
      const key = memo && (memo.answer || memo.correct);
      if (!key) return { mark: null, auto: true, method: 'none', note: 'No answer key in the memo' };
      const ok = ans && String(ans.choice || ans.text || '').trim().toLowerCase() === String(key).trim().toLowerCase();
      return { mark: ok ? max : 0, auto: true, method: 'key', hits: ok ? ['Correct option'] : [], misses: ok ? [] : ['Correct option is ' + key], confidence: 'high' };
    }
    if (empty) return { mark: 0, auto: true, method: 'empty', hits: [], misses: ['No answer'], confidence: 'high' };
    let spec = memo && memo.auto && memo.auto.criteria && memo.auto.criteria.length ? memo.auto : null;
    let method = 'memo criteria';
    if (!spec) { spec = derive(memo, q); method = spec.keywordMode ? 'keywords from model answer' : 'figures from model answer'; }
    const results = spec.criteria.map(c => ({ c, hit: testCriterion(c, P) }));
    let hits = results.filter(r => r.hit);
    if (spec.pick) hits = hits.sort((a, b) => (b.c.marks || 0) - (a.c.marks || 0)).slice(0, spec.pick);
    let raw;
    if (spec.keywordMode) {
      const ratio = hits.length / Math.max(1, results.length);
      raw = max * Math.min(1, ratio / 0.5);
    } else raw = hits.reduce((s, r) => s + (+r.c.marks || 0), 0);
    let mark = Math.max(0, Math.min(max, Math.round(raw * 2) / 2));
    const hasCode = q.type === 'code';
    const ranClean = P.output.trim() && !P.errors.trim();
    const notes = [];
    if (hasCode && P.code.trim() && !P.output.trim()) notes.push('Code was not run');
    if (hasCode && P.errors.trim()) notes.push('Code produced an error');
    const confidence = method === 'memo criteria' ? (hasCode && !ranClean ? 'medium' : 'high') : 'low';
    return {
      mark, auto: true, method, confidence,
      hits: hits.map(r => r.c.label), misses: results.filter(r => !r.hit).map(r => r.c.label).slice(0, 8), notes,
    };
  }

  function gradeScript(exam, answers) {
    const memoMap = Object.fromEntries(((exam.memo && exam.memo.answers) || []).map(a => [a.id, a]));
    const out = {};
    (exam.paper.questions || []).forEach(q => { out[q.id] = grade(q, memoMap[q.id], (answers || {})[q.id]); });
    return out;
  }

  const api = { grade, gradeScript, numbersIn, testCriterion, parts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Grader = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Camblish Online Exam: question paper and memo parser
// Author: Eddie Bila
// Turns the plain-text lines of a Word or PDF question paper / memorandum into structured questions.
// Works in the browser and in Node (for testing).

(function (root) {
  const ID_RE = /^([A-H]\d{1,2}(?:\.\d{1,2}){0,3})(?:[\s:.)\-–]+)(.*)$/;
  const BARE_ID_RE = /^([A-H]\d{1,2}(?:\.\d{1,2}){0,3})\s*$/;
  const OPT_RE = /^\(?([a-hA-H])[\).]\s+(.+)$/;
  const MARKS_RE = /\((\d{1,3}(?:\.\d)?)\)\s*$/;
  const MARKS_ANY_RE = /\((\d{1,3}(?:\.\d)?)\)\s*$/m;
  const BRACKET_HDR_RE = /\[(\d{1,3})\]\s*$/;
  const SECTION_RE = /^SECTION\s+([A-H])\b\s*[:\-–]?\s*(.*)$/i;
  const GROUP_RE = /^(Question\s+[A-H]\d{1,2}\b.*)$/i;
  const STOP_RE = /^(—|-|–)?\s*END OF (ASSESSMENT|PAPER|EXAMINATION)|^TOTAL\s*:\s*\d+\s*MARKS/i;
  const CODE_HINT = /\b(write (a |an |the )?(python|sql|query|function|script|code)|sql|python|query|queries|code|function|script|implement|pivot table|create (one |two |a |an )?(visuali[sz]ation|chart|plot|graph)|create two|load the|run two|plot|regression model|visualis|visualiz)\b/i;

  function clean(s) {
    return String(s || '')
      .replace(/ /g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Drop lines that repeat on many pages (running headers/footers) and page numbers.
  function stripRepeating(lines) {
    const counts = {};
    lines.forEach(l => { const k = l.replace(/\d+/g, '#'); counts[k] = (counts[k] || 0) + 1; });
    return lines.filter(l => {
      if (/^page\s+\d+\s+(of|\/)\s+\d+$/i.test(l)) return false;
      const k = l.replace(/\d+/g, '#');
      if (counts[k] >= 3 && l.length < 120 && /page|\|/i.test(l)) return false;
      return true;
    });
  }

  // Header lines can carry the page footer glued on (PDF): "...Page 2 of 9" -> remove trailing running header.
  function splitGlued(line) {
    // e.g. "PASS MARK 60118708 – Data Science Practitioner | EISA Mock Test" (PDF page break glue)
    return line.replace(/(\d)(\d{6}\s*[–-]\s*[^|]+\|\s*.+)$/, '$1').trim();
  }

  function metaFrom(lines) {
    const meta = {};
    const joined = lines.slice(0, 80);
    const grab = (re, key, fn) => {
      for (let i = 0; i < joined.length; i++) {
        const m = joined[i].match(re);
        if (m) {
          let v = (m[1] || '').trim();
          if (!v && joined[i + 1]) v = joined[i + 1].trim();
          if (v) { meta[key] = fn ? fn(v) : v; return; }
        }
      }
    };
    grab(/^SAQA ID\s*(.*)$/i, 'saqa_id', v => (v.match(/\d{4,6}/) || [v])[0]);
    grab(/^DURATION\s*(.*)$/i, 'duration_min', v => { const h = v.match(/([\d.]+)\s*hour/i); const m = v.match(/(\d+)\s*min/i); return h ? Math.round(parseFloat(h[1]) * 60) : m ? parseInt(m[1]) : null; });
    grab(/^TOTAL MARKS\s*(.*)$/i, 'total_marks', v => parseInt(v) || null);
    grab(/^PASS MARK\s*(.*)$/i, 'pass_mark', v => parseInt(v) || null);
    grab(/^QUALIFICATION\s*(.*)$/i, 'qualification');
    // title: first long line mentioning assessment / test / exam
    const cands = joined.slice(0, 15).filter(l => /(assessment|examination|exam|test)/i.test(l) && l.length < 90 && !/^(DATE|DURATION|INSTRUCTIONS)/i.test(l));
    meta.title = cands.find(l => /(practice|mock|version|test)/i.test(l)) || cands[0];
    Object.keys(meta).forEach(k => meta[k] == null && delete meta[k]);
    return meta;
  }

  function parseInstructions(lines) {
    const start = lines.findIndex(l => /^INSTRUCTIONS\b/i.test(l));
    if (start < 0) return [];
    let end = lines.findIndex((l, i) => i > start && /^(MARK ALLOCATION|SECTION\s+[A-H])/i.test(l));
    if (end < 0) end = Math.min(lines.length, start + 40);
    const block = lines.slice(start + 1, end);
    const numbered = block.filter(l => /^\d{1,2}[.)]\s+/.test(l)).length >= 2;
    const out = [];
    for (const l of block) {
      const m = l.match(/^(\d{1,2})[.)]\s+(.*)$/);
      if (!numbered) out.push(l);
      else if (m) out.push(m[2]);
      else if (out.length) out[out.length - 1] += ' ' + l;
      else out.push(l);
    }
    return out.map(clean).filter(Boolean);
  }

  function joinSmart(arr) {
    let out = '';
    arr.map(clean).filter(Boolean).forEach(l => { out += out ? (/[.:?!)\]]$/.test(out) ? '\n' : ' ') + l : l; });
    return out;
  }

  function inferType(q) {
    if (q.options && q.options.length >= 2) return 'mcq';
    return CODE_HINT.test(q.text + ' ' + (q.context || '')) && CODE_HINT.test(q.text) ? 'code' : 'text';
  }

  function parsePaper(rawLines) {
    let lines = rawLines.map(clean).map(splitGlued).filter(Boolean);
    lines = stripRepeating(lines);
    const meta = metaFrom(lines);
    const instructions = parseInstructions(lines);

    // Find where questions start: first SECTION line after instructions/mark allocation, else first ID line.
    let i0 = lines.findIndex((l, i) => SECTION_RE.test(l) && lines.slice(i + 1, i + 6).some(x => ID_RE.test(x) || /choose|answer/i.test(x)));
    if (i0 < 0) i0 = lines.findIndex(l => ID_RE.test(l));
    if (i0 < 0) i0 = 0;

    const questions = [];
    let section = null, group = '', ctx = [], cur = null, curHasMarks = false;
    let subCtx = [];

    const finish = () => {
      if (!cur) return;
      cur.text = cur.text.split('\n').map(clean).filter(Boolean).join('\n');
      // marks: the last "(n)" that ends a line anywhere in the question
      const all = [...cur.text.matchAll(/\((\d{1,3}(?:\.\d)?)\)[ \t]*(?=\n|$)/g)];
      if (all.length) {
        const last = all[all.length - 1];
        cur.marks = parseFloat(last[1]);
        cur.text = (cur.text.slice(0, last.index) + cur.text.slice(last.index + last[0].length)).replace(/[ \t]+\n/g, '\n').trim();
      }
      // also accept marks written in the middle-end like "... (4) Display ..."
      if (cur.marks == null) { const mm = cur.text.match(/\((\d{1,2})\)(?=[^()]*$)/); if (mm) { cur.marks = parseFloat(mm[1]); cur.text = cur.text.replace(mm[0], ' ').replace(/\s+/g, ' ').trim(); } }
      if (cur.marks == null) cur.marks = cur.options && cur.options.length ? 1 : 0;
      cur.type = inferType(cur);
      if (!cur.options || !cur.options.length) delete cur.options;
      questions.push(cur);
      cur = null; curHasMarks = false;
    };

    for (let i = i0; i < lines.length; i++) {
      let l = lines[i];
      if (STOP_RE.test(l)) break;
      if (/^(Page \d+ of \d+)$/i.test(l)) continue;

      let m;
      if ((m = l.match(SECTION_RE))) {
        finish();
        section = m[1].toUpperCase();
        group = clean('Section ' + section + (m[2] ? ': ' + m[2].replace(/\[\d+\s*marks?\]/i, '').trim() : ''));
        ctx = []; subCtx = [];
        continue;
      }
      if ((m = l.match(GROUP_RE)) && !MARKS_RE.test(l)) {
        finish();
        group = clean(m[1]);
        ctx = []; subCtx = [];
        continue;
      }
      // Any other line ending in [n] (e.g. "Part B3.1 Loading the data [3]") is a sub-header
      if (BRACKET_HDR_RE.test(l) && !MARKS_RE.test(l) && !ID_RE.test(l)) {
        finish();
        subCtx = [clean(l.replace(BRACKET_HDR_RE, '').replace(/^Part\s+[A-H]\d+(\.\d+)*\s*/i, ''))].filter(Boolean);
        continue;
      }
      // Bare ID on its own line followed by text (PDF layouts)
      if (BARE_ID_RE.test(l) && lines[i + 1] && !ID_RE.test(lines[i + 1])) {
        l = l + ' ' + lines[i + 1]; i++;
      }
      if ((m = l.match(ID_RE))) {
        const id = m[1], rest = m[2] || '';
        // Sub-group header like "B2.1 Database Population [4]" or "C1.1 [8]"
        if (BRACKET_HDR_RE.test(rest) && !MARKS_RE.test(rest)) {
          finish();
          subCtx = [clean(rest.replace(BRACKET_HDR_RE, ''))].filter(Boolean);
          continue;
        }
        finish();
        cur = { id, section: section || id[0], group, context: joinSmart([...ctx, ...subCtx]), text: rest, options: [] };
        curHasMarks = MARKS_RE.test(rest);
        continue;
      }
      if (cur && (m = l.match(OPT_RE)) && (cur.options.length ? m[1].toLowerCase().charCodeAt(0) === cur.options[cur.options.length - 1].key.charCodeAt(0) + 1 : m[1].toLowerCase() === 'a')) {
        cur.options.push({ key: m[1].toLowerCase(), text: clean(m[2]) });
        continue;
      }
      if (cur && cur.options.length && curHasMarks && !OPT_RE.test(l)) { finish(); }
      if (cur) {
        if (cur.options.length && !OPT_RE.test(l)) {
          // continuation of last option (PDF wrap)
          cur.options[cur.options.length - 1].text += ' ' + l;
        } else {
          cur.text += (/[.:?)\]]$/.test(cur.text) || /^(Task|Question|Interpretation|Note|Hint)\s*:/i.test(l) ? '\n' : ' ') + l;
        }
        if (MARKS_RE.test(l)) curHasMarks = true;
        continue;
      }
      // plain paragraph outside a question: it is context for the following questions
      if (/^SCENARIO$/i.test(l)) { ctx = []; continue; }
      if (/^(MARK ALLOCATION|Section\s+Content\s+Marks)/i.test(l)) continue;
      if (subCtx.length) subCtx.push(l); else ctx.push(l);
      if (ctx.length > 12) ctx = ctx.slice(-12);
    }
    finish();

    // de-duplicate IDs (keep first) and tidy
    const seen = new Set();
    const qs = questions.filter(q => !seen.has(q.id) && seen.add(q.id)).map(q => ({
      id: q.id, section: q.section, group: q.group, context: q.context, text: q.text, marks: q.marks, type: q.type, ...(q.options ? { options: q.options } : {})
    }));
    const total = qs.reduce((s, q) => s + (Number(q.marks) || 0), 0);
    return { ...meta, instructions, questions: qs, parsed_total: total };
  }

  function parseMemo(rawLines, knownIds) {
    const lines = stripRepeating(rawLines.map(clean).filter(Boolean));
    const ids = knownIds ? new Set(knownIds) : null;
    const answers = [];
    let cur = null, field = 'model_answer';
    const push = () => { if (cur) { Object.keys(cur).forEach(k => typeof cur[k] === 'string' && (cur[k] = cur[k].trim())); answers.push(cur); } cur = null; };
    for (const l of lines) {
      if (STOP_RE.test(l)) continue;
      const m = l.match(ID_RE);
      if (m && (!ids || ids.has(m[1])) && !BRACKET_HDR_RE.test(m[2] || '')) {
        push();
        cur = { id: m[1], model_answer: '', marking_guide: '', tip: '' };
        field = 'model_answer';
        let rest = m[2] || '';
        const a = rest.match(/^(?:Answer|Correct answer|Ans)\s*[:\-]?\s*\(?([a-hA-H]|True|False)\)?\b\s*(.*)$/i);
        if (a) {
          let v = a[1].toLowerCase();
          cur.answer = v;
          rest = a[2] || '';
        } else if (/^\(?([a-h])\)?(\s|$)/i.test(rest) && rest.length < 4) {
          cur.answer = rest.replace(/[()]/g, '').trim().toLowerCase(); rest = '';
        }
        rest = rest.replace(MARKS_RE, '').trim();
        if (rest) cur.model_answer += rest + '\n';
        continue;
      }
      if (!cur) continue;
      let f;
      if ((f = l.match(/^(Model answer|Expected answer|Answer|Solution)\s*:\s*(.*)$/i))) { field = 'model_answer'; if (f[2]) cur.model_answer += f[2] + '\n'; continue; }
      if ((f = l.match(/^(Marking guide|Mark allocation|Marking|Rubric)\s*:\s*(.*)$/i))) { field = 'marking_guide'; if (f[2]) cur.marking_guide += f[2] + '\n'; continue; }
      if ((f = l.match(/^(Improvement tip|Tip|Improvement|Study tip)\s*:\s*(.*)$/i))) { field = 'tip'; if (f[2]) cur.tip += f[2] + '\n'; continue; }
      if ((f = l.match(/^(Reason|Explanation)\s*:\s*(.*)$/i))) { field = 'model_answer'; cur.model_answer += f[2] + '\n'; continue; }
      cur[field] += l + '\n';
    }
    push();
    // If a MCQ memo lacks explicit tip, keep empty
    return { answers };
  }

  // Text extraction helpers (browser): pass ArrayBuffer
  async function linesFromDocx(buf, mammothLib) {
    const r = await mammothLib.extractRawText({ arrayBuffer: buf });
    return r.value.split(/\n+/);
  }

  async function linesFromPdf(buf, pdfjs) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = Math.round(it.transform[5]);
        const x = it.transform[4];
        let row = rows.find(r => Math.abs(r.y - y) <= 2);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || 0, s: it.str });
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        let line = '';
        r.items.forEach((it, idx) => {
          if (idx && !line.endsWith(' ') && !it.s.startsWith(' ')) {
            const prev = r.items[idx - 1];
            const gap = it.x - (prev.x + prev.w);
            line += gap > 1.5 ? ' ' : '';
          }
          line += it.s;
        });
        out.push(line);
      });
    }
    return out;
  }

  const api = { parsePaper, parseMemo, linesFromDocx, linesFromPdf, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExamParser = api;
})(typeof window !== 'undefined' ? window : globalThis);

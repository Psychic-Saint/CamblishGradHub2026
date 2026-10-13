// Camblish Online Exam: Python/SQL runtime (runs in a Web Worker so proctoring keeps running)
// Author: Eddie Bila
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';
let py = null;
let ready = null;

const HELPER = `
import sys, io, ast, base64, traceback, contextlib, os, sqlite3, json
os.makedirs('/data', exist_ok=True)
os.chdir('/data')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd
pd.set_option('display.width', 160)
pd.set_option('display.max_columns', 30)
pd.set_option('display.max_rows', 60)
G = {'__name__': '__main__'}

def _figs():
    out = []
    for n in plt.get_fignums():
        f = plt.figure(n)
        b = io.BytesIO()
        f.savefig(b, format='png', dpi=80, bbox_inches='tight')
        out.append(base64.b64encode(b.getvalue()).decode())
    plt.close('all')
    return out

def _show(v):
    try:
        if isinstance(v, (pd.DataFrame, pd.Series)):
            return v.to_string(max_rows=60, max_cols=30)
    except Exception:
        pass
    return repr(v)

def run_py(src):
    buf = io.StringIO()
    err = None
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        try:
            tree = ast.parse(src, '<cell>', 'exec')
            last = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = tree.body.pop()
            exec(compile(tree, '<cell>', 'exec'), G)
            if last is not None:
                v = eval(compile(ast.Expression(last.value), '<cell>', 'eval'), G)
                if v is not None:
                    print(_show(v))
        except Exception:
            err = traceback.format_exc(limit=4)
    out = buf.getvalue()
    if len(out) > 20000:
        out = out[:20000] + '\\n... (output truncated)'
    return json.dumps({'out': out, 'err': err, 'imgs': _figs()})

def _split_sql(sql):
    stmts, cur = [], ''
    for line in sql.splitlines(True):
        cur += line
        if sqlite3.complete_statement(cur):
            if cur.strip(): stmts.append(cur.strip())
            cur = ''
    if cur.strip(): stmts.append(cur.strip())
    return stmts

def run_sql(dbfile, sql):
    out, err = '', None
    try:
        con = sqlite3.connect(dbfile)
        cur = con.cursor()
        last = None
        for st in _split_sql(sql):
            cur.execute(st)
            if cur.description:
                cols = [d[0] for d in cur.description]
                rows = cur.fetchmany(501)
                last = (cols, rows)
            else:
                last = None
                out += f'Statement executed. Rows affected: {cur.rowcount}\\n'
        con.commit()
        if last:
            cols, rows = last
            df = pd.DataFrame(rows[:500], columns=cols)
            out += df.to_string(index=False, max_rows=500) if len(df) else '(no rows)'
            out += f'\\n\\n{len(rows[:500])} row(s)' + (' (showing first 500)' if len(rows) > 500 else '')
        con.close()
    except Exception as e:
        err = f'{type(e).__name__}: {e}'
    return json.dumps({'out': out, 'err': err, 'imgs': []})

def list_files():
    res = []
    for root, dirs, files in os.walk('/data'):
        for f in files:
            p = os.path.join(root, f)
            res.append({'path': p.replace('/data/', ''), 'size': os.path.getsize(p)})
    return json.dumps(res)
`;

async function init() {
  importScripts(PYODIDE_URL + 'pyodide.js');
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  postMessage({ type: 'status', text: 'Loading pandas, numpy, matplotlib, scikit-learn…' });
  await py.loadPackage(['numpy', 'pandas', 'matplotlib', 'scikit-learn', 'sqlite3']);
  try { await py.loadPackage(['seaborn']); } catch (e) { /* optional */ }
  py.runPython(HELPER);
  return true;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      if (!ready) ready = init();
      await ready;
      postMessage({ type: 'ready', id: m.id });
      return;
    }
    await ready;
    if (m.type === 'file') {
      const parts = m.name.split('/');
      if (parts.length > 1) py.FS.mkdirTree('/data/' + parts.slice(0, -1).join('/'));
      py.FS.writeFile('/data/' + m.name, new Uint8Array(m.buf));
      postMessage({ type: 'done', id: m.id, result: { ok: true } });
    } else if (m.type === 'run') {
      const fnName = m.lang === 'sql' ? 'run_sql' : 'run_py';
      const f = py.globals.get(fnName);
      const res = m.lang === 'sql' ? f(m.db || '', m.code) : f(m.code);
      f.destroy && f.destroy();
      postMessage({ type: 'done', id: m.id, result: JSON.parse(res) });
    } else if (m.type === 'ls') {
      const f = py.globals.get('list_files');
      const res = f();
      f.destroy && f.destroy();
      postMessage({ type: 'done', id: m.id, result: JSON.parse(res) });
    }
  } catch (err) {
    postMessage({ type: 'done', id: m.id, result: { out: '', err: String(err && err.message || err), imgs: [] } });
  }
};

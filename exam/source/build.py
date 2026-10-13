import pathlib, re
s = pathlib.Path('app')
html = (s/'index.html').read_text()
js = '\n'.join((s/f).read_text() for f in ['parser.js','core.js','live.js','staff.js','exam.js','phone.js','invig.js','mark.js'])
assert '</script' not in js.replace('<\\/script','') , 'script close tag in js'
w = (s/'worker.js').read_text()
assert '</script' not in w
import json
logos=json.load(open('app/assets/logos.json'))
html = html.replace('/*FAV*/', logos['fav']).replace('/*LOGOS*/', json.dumps(logos))
html = html.replace('/*CSS*/', (s/'styles.css').read_text()).replace('/*WORKER*/', w).replace('/*JS*/', js)
pathlib.Path('../index.html').write_text(html)
print('built', len(html)//1024, 'KB')

# merge-json.py <file>: three-way merge of a conflicted JSON file (en.json) from the git index stages;
# where both sides changed a value, main's is kept and the key is printed.
import json, subprocess, sys
p = sys.argv[1]
st = lambda n: json.loads(subprocess.run(['git', 'show', f':{n}:{p}'], capture_output=True, text=True, encoding='utf-8').stdout)
base, ours, theirs = st(1), st(2), st(3)
MISSING = object()
conflicts = []
def merge(b, o, t, path):
    if isinstance(o, dict) and isinstance(t, dict):
        b = b if isinstance(b, dict) else {}
        out = {}
        for k in list(o) + [k for k in t if k not in o]:
            v = merge(b.get(k, MISSING), o.get(k, MISSING), t.get(k, MISSING), path + [k])
            if v is not MISSING: out[k] = v
        return out
    if o == t: return o
    if o == b: return t
    if t == b: return o
    conflicts.append('.'.join(path)); return t
r = merge(base, ours, theirs, [])
open(p, 'w', encoding='utf-8', newline='').write(json.dumps(r, indent=2, ensure_ascii=False) + '\n')
print('conflicting values (main kept):', conflicts)

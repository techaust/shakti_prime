# check-doc-links.py: every relative link and #anchor in the tracked Markdown files resolves (run
# from the repository root; prints "bad 0" when all do).
import os, re, subprocess, sys
files=[f for f in subprocess.check_output(['git','ls-files','*.md']).decode().split('\n') if f and not f.startswith('.claude/skills')]
def slug(h):
    h=h.strip().lower()
    h=re.sub(r'[^\w\- ]','',h,flags=re.U)
    return h.replace(' ','-')
anchors={}
def get_anchors(f):
    if f in anchors: return anchors[f]
    a=set(); 
    try: txt=open(f,encoding='utf-8').read()
    except: anchors[f]=None; return None
    txt=re.sub(r'```.*?```','',txt,flags=re.S)
    counts={}
    for m in re.finditer(r'^#{1,6}\s+(.*)$',txt,flags=re.M):
        s=slug(re.sub(r'`','',m.group(1)))
        n=counts.get(s,0); counts[s]=n+1
        a.add(s if n==0 else f"{s}-{n}")
    for m in re.finditer(r'<a (?:id|name)="([^"]+)"',txt): a.add(m.group(1))
    anchors[f]=a; return a
bad=0
for f in files:
    txt=open(f,encoding='utf-8').read()
    txt=re.sub(r'```.*?```','',txt,flags=re.S)
    for m in re.finditer(r'\]\(([^)\s]+)\)',txt):
        t=m.group(1)
        if re.match(r'^(https?:|mailto:)',t): continue
        path,_,anc=t.partition('#')
        tgt=os.path.normpath(os.path.join(os.path.dirname(f),path)) if path else f
        if path and not os.path.exists(tgt):
            print(f"MISSING {f} -> {t}"); bad+=1; continue
        if anc and os.path.isfile(tgt) and tgt.endswith('.md'):
            a=get_anchors(tgt)
            if a is not None and anc not in a: print(f"ANCHOR {f} -> {t}"); bad+=1
print("bad", bad)
sys.exit(1 if bad else 0)

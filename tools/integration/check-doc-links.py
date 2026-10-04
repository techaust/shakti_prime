# check-doc-links.py: run from the repository root with `python3` (on the PC, Git Bash may have only
# `python`; sourcing tools/integration/lib.sh maps `python3` to it). Checks the Markdown files of the
# repository (tracked, and new ones not yet committed) outside the vendored skills, the project's
# skills (.claude/skills/<name>/SKILL.md) and agents (.claude/agents/*.md) included:
#   MISSING  a relative link whose file does not exist
#   ANCHOR   a link to a #heading the target does not have
#   PATH     a backtick-quoted repository path (`docs/...`, `tools/...`, `.claude/...`) that does
#            not exist; placeholders (<slug>, *, {a,b}, ...) are skipped, and so are the records
#            (CHANGELOG.md, docs/reviews/), which name files as they were; a folder path ending in
#            `/` needs only its parent (a folder a step creates)
#   ORPHAN   a Markdown file under docs/ that no checked file links to or names, by its own path
#            or by a folder that holds it (docs/adr/ names every ADR)
# Prints one line per problem, then "bad N"; exits 1 when N > 0.
import os, re, subprocess, sys

def git_md(*args):
    out = subprocess.check_output(['git', 'ls-files', *args, '*.md']).decode()
    return [f for f in out.split('\n') if f]

# The vendored skills (installed with `npx skills add`) are not ours to fix.
VENDORED = re.compile(r'^\.claude/skills/(vercel-|web-design-guidelines|writing-guidelines)')
def ours(f):
    if VENDORED.match(f):
        return False
    return not f.startswith('.claude/skills/') or f.endswith('/SKILL.md')

files = sorted({f for f in git_md() + git_md('--others', '--exclude-standard') if ours(f)})

def slug(h):
    h = h.strip().lower()
    h = re.sub(r'[^\w\- ]', '', h, flags=re.U)
    return h.replace(' ', '-')

anchors = {}
def get_anchors(f):
    if f in anchors:
        return anchors[f]
    try:
        txt = open(f, encoding='utf-8').read()
    except OSError:
        anchors[f] = None
        return None
    txt = re.sub(r'```.*?```', '', txt, flags=re.S)
    a, counts = set(), {}
    for m in re.finditer(r'^#{1,6}\s+(.*)$', txt, flags=re.M):
        s = slug(re.sub(r'`', '', m.group(1)))
        n = counts.get(s, 0)
        counts[s] = n + 1
        a.add(s if n == 0 else f'{s}-{n}')
    for m in re.finditer(r'<a (?:id|name)="([^"]+)"', txt):
        a.add(m.group(1))
    anchors[f] = a
    return a

PATH_RE = re.compile(r'`((?:docs|tools|\.claude)/[^`\s]+)`')
PLACEHOLDER = re.compile(r'[<>*{}…]|\.\.\.')
RECORDS = re.compile(r'^(CHANGELOG\.md|docs/reviews/)')

bad = 0
named = {}  # repository path -> the checked files that link to it or name it
for f in files:
    txt = open(f, encoding='utf-8').read()
    body = re.sub(r'```.*?```', '', txt, flags=re.S)
    for m in re.finditer(r'\]\(([^)\s]+)\)', body):
        t = m.group(1)
        if re.match(r'^(https?:|mailto:)', t):
            continue
        path, _, anc = t.partition('#')
        tgt = os.path.normpath(os.path.join(os.path.dirname(f), path)) if path else f
        if path:
            named.setdefault(tgt.replace(os.sep, '/').rstrip('/'), set()).add(f)
        if path and not os.path.exists(tgt):
            print(f'MISSING {f} -> {t}')
            bad += 1
            continue
        if anc and os.path.isfile(tgt) and tgt.endswith('.md'):
            a = get_anchors(tgt)
            if a is not None and anc not in a:
                print(f'ANCHOR {f} -> {t}')
                bad += 1
    # Read in code blocks too: a command there names a script that must exist.
    for m in PATH_RE.finditer(txt):
        p = m.group(1).split('#')[0].rstrip('.,;:)')
        named.setdefault(p.rstrip('/'), set()).add(f)
        if PLACEHOLDER.search(p) or RECORDS.match(f):
            continue
        # A folder a step creates (`docs/spikes/exotel/` for a spike's reports) needs only its parent.
        made = p.endswith('/') and os.path.isdir(os.path.dirname(p.rstrip('/')))
        if not os.path.exists(p) and not made:
            print(f'PATH {f} -> {p}')
            bad += 1

def is_named(f):
    parts = f.split('/')
    # The file itself, or a folder below docs/ that holds it.
    return any(named.get('/'.join(parts[:i]), set()) - {f} for i in range(2, len(parts) + 1))

for f in files:
    if f.startswith('docs/') and not is_named(f):
        print(f'ORPHAN {f}')
        bad += 1

print('bad', bad)
sys.exit(1 if bad else 0)

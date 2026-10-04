# merge-union.py <file>...: resolves each conflict hunk by keeping our lines, then theirs (lists only;
# read every code hunk by hand afterwards).
import sys
for p in sys.argv[1:]:
    out, mode, ours, theirs = [], None, [], []
    for line in open(p, encoding='utf-8').read().split('\n'):
        if line.startswith('<<<<<<< '): mode, ours, theirs = 'o', [], []; continue
        if line == '=======' and mode == 'o': mode = 't'; continue
        if line.startswith('>>>>>>> ') and mode == 't':
            out += ours + theirs; mode = None; continue
        (ours if mode == 'o' else theirs if mode == 't' else out).append(line)
    open(p, 'w', encoding='utf-8', newline='').write('\n'.join(out))

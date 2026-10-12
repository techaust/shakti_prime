# agent-usage.py: run from the repository root with `python3` (source tools/integration/lib.sh first
# on the PC). Reads the lead session's Claude Code transcripts (~/.claude/projects/<folder>/) and
# prints, for the lead and each agent it started, the model and effort every request ran on and the
# tokens it used, counted per request id, so agents that ran at the same time are told apart.
#
#   python3 tools/integration/agent-usage.py                      the newest session of this folder
#   python3 tools/integration/agent-usage.py --session <id>       one session (repeatable)
#   python3 tools/integration/agent-usage.py --since 2026-10-12T10:00 --until 2026-10-12T15:00
#   python3 tools/integration/agent-usage.py --week-delta 7       share out 7 points of the week
#
# The weight of a row is its cost at the API's list prices (models-and-usage §7), used only to share
# out what the usage card's bars moved by between the rows; the bars stay the measure of the week.
import argparse, glob, json, os, re, sys
from datetime import datetime, timezone

# US dollars per million tokens: input, output, cache read. A cache write is 1.25 times the input
# price for five minutes and 2 times for an hour. Haiku 5.5 costs 5 times as much above 100,000
# prompt tokens.
PRICES = {
    'claude-opus-5-5': (4.00, 20.00, 0.20),
    'claude-sonnet-5-5': (2.00, 10.00, 0.20),
    'claude-haiku-5-5': (0.10, 0.50, 0.01),
}


def parse_time(text):
    if text is None:
        return None
    t = datetime.fromisoformat(text.replace('Z', '+00:00'))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def project_dir(override):
    if override:
        return override
    folder = re.sub(r'[^A-Za-z0-9]', '-', os.getcwd())
    return os.path.join(os.path.expanduser('~'), '.claude', 'projects', folder)


def cost(model, usage):
    price = PRICES.get(model)
    if price is None:
        return None
    inp, out, read = price
    write = usage.get('cache_creation') or {}
    w1h = write.get('ephemeral_1h_input_tokens', 0)
    w5m = usage.get('cache_creation_input_tokens', 0) - w1h
    prompt = usage.get('input_tokens', 0) + usage.get('cache_creation_input_tokens', 0) + usage.get(
        'cache_read_input_tokens', 0)
    scale = 5 if model == 'claude-haiku-5-5' and prompt > 100_000 else 1
    return scale * (usage.get('input_tokens', 0) * inp + w5m * inp * 1.25 + w1h * inp * 2
                    + usage.get('cache_read_input_tokens', 0) * read
                    + usage.get('output_tokens', 0) * out) / 1e6


def read_requests(path, since, until):
    """The last record of each request id: its model, effort and usage."""
    requests = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get('type') != 'assistant' or 'usage' not in d.get('message', {}):
                continue
            when = parse_time(d.get('timestamp'))
            if (since and when and when < since) or (until and when and when > until):
                continue
            key = d.get('requestId') or d['message'].get('id') or d.get('uuid')
            requests[key] = (d['message'].get('model', '?'), d.get('effort') or '-', d['message']['usage'])
    return requests


def summarise(name, path, since, until):
    reqs = read_requests(path, since, until)
    if not reqs:
        return None
    row = {'name': name, 'models': set(), 'efforts': set(), 'requests': len(reqs), 'input': 0,
           'write': 0, 'read': 0, 'output': 0, 'cost': 0.0, 'unpriced': set()}
    for model, effort, usage in reqs.values():
        row['models'].add(model.replace('claude-', ''))
        row['efforts'].add(effort)
        row['input'] += usage.get('input_tokens', 0)
        row['write'] += usage.get('cache_creation_input_tokens', 0)
        row['read'] += usage.get('cache_read_input_tokens', 0)
        row['output'] += usage.get('output_tokens', 0)
        c = cost(model, usage)
        if c is None:
            row['unpriced'].add(model)
        else:
            row['cost'] += c
    return row


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--session', action='append', help='session id; the newest when left out')
    ap.add_argument('--since', help='ISO time, UTC unless it carries an offset')
    ap.add_argument('--until', help='ISO time, UTC unless it carries an offset')
    ap.add_argument('--week-delta', type=float, help="points the week's bar moved over the same time")
    ap.add_argument('--projects', help='the transcripts folder, when it is not found from this folder')
    args = ap.parse_args()

    base = project_dir(args.projects)
    if not os.path.isdir(base):
        sys.exit(f'No transcripts folder at {base}; run from the repository root or pass --projects.')
    sessions = args.session
    if not sessions:
        files = sorted(glob.glob(os.path.join(base, '*.jsonl')), key=os.path.getmtime)
        if not files:
            sys.exit(f'No session transcripts in {base}.')
        sessions = [os.path.splitext(os.path.basename(files[-1]))[0]]
    since, until = parse_time(args.since), parse_time(args.until)

    rows = []
    for sid in sessions:
        lead = os.path.join(base, sid + '.jsonl')
        if os.path.exists(lead):
            row = summarise(f'lead {sid[:8]}', lead, since, until)
            if row:
                rows.append(row)
        for path in sorted(glob.glob(os.path.join(base, sid, 'subagents', 'agent-*.jsonl'))):
            meta = {}
            meta_path = path[:-len('.jsonl')] + '.meta.json'
            if os.path.exists(meta_path):
                with open(meta_path, encoding='utf-8') as f:
                    meta = json.load(f)
            label = f"{meta.get('agentType', 'agent')}: {meta.get('description', os.path.basename(path))}"
            row = summarise(label[:48], path, since, until)
            if row:
                rows.append(row)

    if not rows:
        sys.exit('No requests in that session and time.')
    total = sum(r['cost'] for r in rows)
    head = f"{'who':48} {'model':16} {'effort':12} {'reqs':>5} {'input':>9} {'c.write':>10} {'c.read':>11} {'output':>9} {'share':>6}"
    if args.week_delta is not None:
        head += f" {'week pts':>8}"
    print(head)
    for r in rows:
        share = r['cost'] / total if total else 0
        line = (f"{r['name']:48} {','.join(sorted(r['models'])):16} {','.join(sorted(r['efforts'])):12} "
                f"{r['requests']:>5} {r['input']:>9,} {r['write']:>10,} {r['read']:>11,} {r['output']:>9,} {share:>6.1%}")
        if args.week_delta is not None:
            line += f" {share * args.week_delta:>8.2f}"
        print(line)
    unpriced = set().union(*(r['unpriced'] for r in rows))
    if unpriced:
        print(f"Not weighed (no price in PRICES): {', '.join(sorted(unpriced))}")


if __name__ == '__main__':
    main()

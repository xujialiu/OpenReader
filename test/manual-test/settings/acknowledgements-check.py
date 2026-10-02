#!/usr/bin/env python3
"""Settings → Acknowledgements against `src/app/acknowledgements.json` (#111,
`acknowledgements.md`): what the screen lists and shows, read from the phone's
accessibility tree, compared with the data it is built from.

  python3 test/manual-test/settings/acknowledgements-check.py UDID list
  python3 test/manual-test/settings/acknowledgements-check.py UDID licence [--pasteboard]

list      the Acknowledgements page is open: every row (a Button whose
          label contains `name, licence`) equals the data's entries, in order.
          This checks data/accessibility, not visible text; no row-height filter. A
          ScrollView lists all its rows in the tree, off-screen ones too, so no
          scrolling is needed. Prints the row count and `identical=True/False`.
licence   one component's licence page is open: the title is an entry's name,
          the long text's label is that entry's `text`, exactly, and the line
          under it is the one `aboutLine` builds (version, where it is carried,
          the note). With --pasteboard the simulator's pasteboard must hold the
          entry's text too: press the text for 2 s (`axe touch -x 200 -y 520 --down
          --up --delay 2.0`; 1.2 s raised nothing), then `kit/ax.py UDID touch Copy`
          for the callout, which the tree lists (`acknowledgements.md`). Seed the
          pasteboard first (`printf x | xcrun simctl pbcopy UDID`) so an earlier copy
          cannot pass.

Exit status 0 when everything compared equal, 1 when something differs, 2 for a
setup problem. Needs `kit/ax.py` (AXe). Plays nothing, touches nothing.
"""
import json
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, '..', 'kit'))
import ax  # noqa: E402

DATA = os.path.join(here, '..', '..', '..', 'src', 'app', 'acknowledgements.json')


def about_line(entry):
    """`aboutLine` in src/app/acknowledgements.ts."""
    facts = []
    if entry.get('version'):
        facts.append(f"Version {entry['version']}")
    if entry.get('carriedBy'):
        facts.append(f"{'part' if facts else 'Part'} of {entry['carriedBy']}")
    lead = f"{', '.join(facts)}." if facts else ''
    return ' '.join(part for part in (lead, entry.get('note')) if part)


def check_list(tree, entries):
    labels = []
    for node, _, _ in ax.walk(tree):
        if node.get('type') == 'Button' and ', ' in (node.get('AXLabel') or ''):
            labels.append(node.get('AXLabel'))
    expected = [f"{e['name']}, {e['license']}" for e in entries]
    print(f'rows={len(labels)} entries={len(expected)} identical={labels == expected}')
    if labels != expected:
        for i, (got, want) in enumerate(zip(labels, expected)):
            if got != want:
                print(f'  first difference at {i}: screen {got!r}, data {want!r}')
                break
    return labels == expected


def check_licence(udid, tree, entries, pasteboard):
    by_name = {e['name']: e for e in entries}
    title = next((n.get('AXLabel') for n, _, _ in ax.walk(tree) if n.get('type') == 'Heading' and n.get('AXLabel') in by_name), None)
    if title is None:
        print('No heading that names an entry: is a licence page open?')
        return None
    entry = by_name[title]
    labels = sorted({n.get('AXLabel') for n, _, _ in ax.walk(tree) if n.get('type') == 'StaticText' and n.get('AXLabel')}, key=len, reverse=True)
    text_ok = bool(labels) and labels[0] == entry['text']
    about = about_line(entry)
    about_ok = (about in labels) if about else True
    print(f"title={title!r} text={len(entry['text'])} chars, equal={text_ok}; line under it equal={about_ok} ({about[:60]!r}…)")
    ok = text_ok and about_ok
    if pasteboard:
        pasted = subprocess.run(['xcrun', 'simctl', 'pbpaste', udid], capture_output=True, text=True, check=True).stdout
        print(f'pasteboard={len(pasted)} chars, equal to the text={pasted == entry["text"]}')
        ok = ok and pasted == entry['text']
    return ok


def main():
    if len(sys.argv) < 3 or sys.argv[2] not in ('list', 'licence'):
        sys.exit(__doc__)
    udid, mode = sys.argv[1], sys.argv[2]
    with open(DATA, encoding='utf-8') as f:
        entries = json.load(f)
    tree = ax.read_tree(udid)
    ok = check_list(tree, entries) if mode == 'list' else check_licence(udid, tree, entries, '--pasteboard' in sys.argv)
    if ok is None:
        return 2
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

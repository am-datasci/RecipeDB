#!/usr/bin/env python3
"""
RecipeDB maintenance toolkit.

Stdlib only — no install, no venv, no dependencies.

    python3 tools/recipedb.py validate          check every sheet and the index
    python3 tools/recipedb.py validate --strict treat warnings as failures
    python3 tools/recipedb.py recalc <slug>     recompute percentages and totals
    python3 tools/recipedb.py recalc all --write
    python3 tools/recipedb.py new <slug>        scaffold a sheet and register it
    python3 tools/recipedb.py stats             archive overview

Exit code is 1 when errors are found, so this drops straight into CI or a
pre-commit hook.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX    = os.path.join(ROOT, 'data', 'index.json')
SHEETS   = os.path.join(ROOT, 'data', 'recipes')
TEMPLATE = os.path.join(SHEETS, '_template-minimal.json')

# Files starting with "_" are templates, not recipes.
is_template = lambda slug: slug.startswith('_')

# ---------------------------------------------------------------- diet rules

# Ingredients that disqualify a diet tag, with the exemptions that would
# otherwise produce false positives ("almond milk" is not dairy).
NON_VEGAN = {
    'milk':       ['almond milk', 'soy milk', 'oat milk', 'coconut milk',
                   'rice milk', 'cashew milk', 'hemp milk'],
    'butter':     ['peanut butter', 'almond butter', 'nut butter', 'cocoa butter',
                   'cashew butter', 'sunflower butter', 'coconut oil / butter',
                   'seed butter'],
    'buttermilk': [],
    'cream':      ['cream of tartar', 'coconut cream', 'cashew cream'],
    'cheese':     ['vegan cheese'],
    'yogurt':     ['coconut yogurt', 'soy yogurt'],
    'kefir':      ['water kefir'],
    'egg':        ['eggplant'],
    'honey':      ['honey graham', 'honeydew'],
    'mascarpone': [], 'parmesan': [], 'pecorino': [], 'gouda': [],
    'cheddar': [], 'mayonnaise': [], 'ghee': [], 'lard': [],
    'anchovy':      [],
    'fish sauce':   ['vegan fish sauce', 'vegetarian fish sauce'],
    'oyster sauce': ['vegetarian mushroom oyster sauce', 'vegan oyster sauce',
                     'mushroom oyster sauce'],
    'beef': [], 'pork': [], 'chicken': [], 'prosciutto': [],
    'gelatin': [], 'duck fat': [], 'goose fat': [],
}
# Meat and seafood only — dairy and eggs are fine for vegetarians.
NON_VEGETARIAN = {
    k: v for k, v in NON_VEGAN.items()
    if k in {'anchovy', 'fish sauce', 'oyster sauce', 'beef', 'pork',
             'chicken', 'prosciutto', 'gelatin', 'lard', 'duck fat', 'goose fat'}
}

PRIVACY_TERMS = [
    'zonisamide', 'executive dysfunction', 'anti-fog', 'methylation',
    'anti-impulse', 'neural firing', 'afternoon slump', 'medication',
]

PLACEHOLDER_MARKERS = [
    'DELETE THIS FIELD', 'WARNING: custom columns', 'Primary Ingredient',
    'Second Ingredient', 'Third Ingredient', 'What it does in the dish',
    'PLACEHOLDER', 'Step Name', 'Baseline Ingredient',
]


def flags(name, table):
    """Return the disqualifying keyword found in an ingredient name, or None."""
    low = name.lower()
    for term, exempt in table.items():
        if term in low and not any(e in low for e in exempt):
            return term
    return None


# ------------------------------------------------------------------- loading

def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def sheet_paths():
    return sorted(
        os.path.join(SHEETS, f) for f in os.listdir(SHEETS) if f.endswith('.json')
    )


def rows_of(fm):
    return [r for r in fm.get('rows', []) if 'group' not in r]


# ---------------------------------------------------------------- validation

class Report:
    def __init__(self):
        self.errors, self.warns = [], []

    def error(self, where, msg):
        self.errors.append((where, msg))

    def warn(self, where, msg):
        self.warns.append((where, msg))


def check_sheet(path, rep, known_tags):
    slug = os.path.basename(path)[:-5]
    try:
        r = load(path)
    except json.JSONDecodeError as e:
        rep.error(slug, f'invalid JSON: {e}')
        return None

    if r.get('slug') != slug:
        rep.error(slug, f'slug field is "{r.get("slug")}" but filename is "{slug}.json"')
    if not r.get('title'):
        rep.error(slug, 'missing title')

    fms = r.get('formulations') or []
    if not fms:
        rep.error(slug, 'no formulations')

    baselines = [row for fm in fms for row in rows_of(fm) if row.get('baseline')]
    if len(baselines) > 1:
        rep.error(slug, f'{len(baselines)} rows marked baseline (expected exactly 1)')
    elif not baselines and fms:
        rep.error(slug, 'no row marked "baseline": true — the batch scaler needs one')
    elif baselines and baselines[0].get('pct') != 100.0:
        rep.error(slug, f'baseline pct is {baselines[0].get("pct")} (must be 100.0)')

    base_mass = baselines[0].get('mass') if baselines else None

    for i, fm in enumerate(fms, 1):
        where = f'{slug} [matrix {i}]'
        cols = fm.get('columns')
        if cols is not None and len(cols) != 6:
            rep.error(where, f'custom columns has {len(cols)} labels (must be exactly 6)')

        rs = rows_of(fm)
        ids = [x.get('id') for x in rs if x.get('id')]
        for dup, n in Counter(ids).items():
            if n > 1:
                rep.error(where, f'duplicate item id "{dup}" ({n}x)')

        # A secondary matrix may restate its own local 100% base.
        local = next((x for x in rs if x.get('pct') == 100.0), None)
        ref = (local or {}).get('mass') if i > 1 else base_mass
        if ref:
            for x in rs:
                if x.get('mass') is None or x.get('pct') is None:
                    continue
                want = round(x['mass'] / ref * 100, 2)
                if abs(want - x['pct']) > 0.05:
                    rep.warn(where, f'{x.get("id")} pct={x["pct"]} but mass implies {want}')

        total = fm.get('total', {}).get('mass')
        if total is not None and not fm['total'].get('partial'):
            s = round(sum(x['mass'] for x in rs if x.get('mass') is not None), 2)
            if abs(s - total) > 0.5:
                rep.warn(where, f'total mass {total} but rows sum to {s} '
                                f'(set total.partial=true if the total deliberately '
                                f'excludes rows)')

    estimated = any(row.get('estimated') for fm in fms for row in rows_of(fm))
    if estimated and not r.get('matrixFootnote') and not any(fm.get('note') for fm in fms):
        rep.error(slug, 'has estimated masses but no matrixFootnote explaining them')

    if not r.get('execution'):
        rep.warn(slug, 'no execution sequence')

    src = r.get('meta', {}).get('source')
    if isinstance(src, str):
        rep.warn(slug, 'meta.source is a plain string — migrate to the structured '
                       '{publication, title, author, url, date} form')
    elif isinstance(src, dict):
        known = {'publication', 'title', 'author', 'url', 'date', 'note'}
        for k in set(src) - known:
            rep.warn(slug, f'meta.source has unknown key "{k}" (expected {sorted(known)})')
        if src.get('url') and not re.match(r'https?://', src['url']):
            rep.error(slug, f'meta.source.url is not a URL: "{src["url"]}"')
        # url is optional — books, magazines, and handed-down recipes have none.
        # It is only checked for shape when present.
        if r.get('meta', {}).get('sourceUrl'):
            rep.warn(slug, 'meta.sourceUrl is superseded by meta.source.url')

    blob = json.dumps(r, ensure_ascii=False)
    for term in PRIVACY_TERMS:
        if re.search(re.escape(term), blob, re.I):
            rep.error(slug, f'privacy: contains "{term}" — repo is public')
    if not is_template(slug):
        for marker in PLACEHOLDER_MARKERS:
            if marker in blob:
                rep.warn(slug, f'unedited template placeholder: "{marker}"')

    tags = set(r.get('tags', []))
    names = [row.get('name', '') for fm in fms for row in rows_of(fm)]
    for tag, table in (('Vegan', NON_VEGAN), ('Vegetarian', NON_VEGETARIAN)):
        if tag in tags:
            for n in names:
                hit = flags(n, table)
                if hit:
                    rep.error(slug, f'tagged {tag} but contains "{n}" ({hit})')
    unknown = tags - known_tags - {'Favorites'}
    if unknown:
        rep.warn(slug, f'tags not filed into any group: {sorted(unknown)} '
                       f'(they land in "More Tags")')
    return r


def cmd_validate(args):
    rep = Report()
    try:
        db = load(INDEX)
    except json.JSONDecodeError as e:
        print(f'FATAL: data/index.json is invalid JSON: {e}')
        return 1

    known_tags = {t for g in db.get('groups', []) for t in g.get('tags', [])}
    indexed = [r['slug'] for r in db.get('recipes', [])]
    for dup, n in Counter(indexed).items():
        if n > 1:
            rep.error('index.json', f'duplicate slug "{dup}" ({n}x)')

    # Curated collections: slug lists must point at real recipes.
    indexed_set = set(indexed)
    for c in db.get('collections', []):
        label = c.get('label', '?')
        slugs = c.get('slugs', [])
        if not c.get('label'):
            rep.error('index.json', 'a collection has no label')
        for dup, n in Counter(slugs).items():
            if n > 1:
                rep.error('index.json', f'collection "{label}" lists "{dup}" {n}x')
        for sl in slugs:
            if sl not in indexed_set:
                rep.error('index.json',
                          f'collection "{label}" references unknown recipe "{sl}"')
        if not slugs:
            rep.warn('index.json', f'collection "{label}" is empty')

    if 'favoriteTag' in db:
        rep.warn('index.json', 'favoriteTag is superseded by collections[]')
    for r in db.get('recipes', []):
        if 'Favorites' in r.get('tags', []):
            rep.warn(r['slug'], 'still carries the "Favorites" tag — favorites are now '
                                'a curated slug list in index.json collections[]')

    files = {os.path.basename(p)[:-5] for p in sheet_paths()}
    for slug in indexed:
        if slug not in files:
            rep.error('index.json', f'"{slug}" indexed but data/recipes/{slug}.json is missing')
    for slug in sorted(files - set(indexed)):
        if not is_template(slug):
            rep.warn('index.json', f'data/recipes/{slug}.json exists but is not indexed '
                                   f'(it will not appear on the site)')

    by_slug = {r['slug']: r for r in db.get('recipes', [])}
    for path in sheet_paths():
        slug = os.path.basename(path)[:-5]
        sheet = check_sheet(path, rep, known_tags)
        if sheet and slug in by_slug:
            ie = by_slug[slug]
            if ie.get('title') != sheet.get('title'):
                rep.warn(slug, 'title differs between index and sheet')
            if set(ie.get('tags', [])) != set(sheet.get('tags', [])):
                rep.warn(slug, 'tags differ between index and sheet')
            if not ie.get('blurb'):
                rep.warn(slug, 'no blurb — the home page card will be bare')
            elif ie['blurb'].startswith('TODO'):
                rep.warn(slug, 'blurb is still the auto-generated placeholder')

    for where, msg in rep.errors:
        print(f'  ERROR  {where}: {msg}')
    for where, msg in rep.warns:
        print(f'  warn   {where}: {msg}')

    n_sheets = len([p for p in sheet_paths() if not is_template(os.path.basename(p)[:-5])])
    print(f'\n{n_sheets} recipes · {len(rep.errors)} errors · {len(rep.warns)} warnings')
    if not rep.errors and not rep.warns:
        print('All checks passed.')
    return 1 if rep.errors or (args.strict and rep.warns) else 0


# -------------------------------------------------------------------- recalc

def recalc_sheet(path, write):
    r = load(path)
    slug = r.get('slug', '?')
    changes = []
    fms = r.get('formulations') or []
    base = next((row for fm in fms for row in rows_of(fm) if row.get('baseline')), None)
    if not base:
        return slug, ['no baseline row — cannot recompute']

    for i, fm in enumerate(fms, 1):
        rs = rows_of(fm)
        local = next((x for x in rs if x.get('pct') == 100.0), None)
        ref = (local or {}).get('mass') if i > 1 else base.get('mass')
        if not ref:
            continue
        for x in rs:
            if x.get('mass') is None or x.get('pct') is None:
                continue
            want = round(x['mass'] / ref * 100, 2)
            if abs(want - x['pct']) > 0.005:
                changes.append(f'matrix {i} {x.get("id")}: {x["pct"]} -> {want}')
                x['pct'] = want
        if 'total' in fm and not fm['total'].get('partial'):
            s = round(sum(x['mass'] for x in rs if x.get('mass') is not None), 2)
            if fm['total'].get('mass') != s:
                changes.append(f'matrix {i} TOTAL mass: {fm["total"].get("mass")} -> {s}')
                fm['total']['mass'] = s
            tp = round(s / ref * 100, 2)
            if fm['total'].get('pct') is not None and fm['total']['pct'] != tp:
                changes.append(f'matrix {i} TOTAL pct: {fm["total"]["pct"]} -> {tp}')
                fm['total']['pct'] = tp

    if changes and write:
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(r, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
    return slug, changes


def cmd_recalc(args):
    targets = (sheet_paths() if args.slug == 'all'
               else [os.path.join(SHEETS, f'{args.slug}.json')])
    total = 0
    for p in targets:
        if not os.path.exists(p):
            print(f'  no such sheet: {p}')
            return 1
        if is_template(os.path.basename(p)[:-5]):
            continue
        slug, changes = recalc_sheet(p, args.write)
        total += len(changes)
        if changes:
            print(f'  {slug}:')
            for c in changes:
                print(f'      {c}')
    if not total:
        print('  Nothing to recompute — all percentages and totals are correct.')
    elif not args.write:
        print(f'\n{total} corrections available. Re-run with --write to apply.')
    else:
        print(f'\n{total} corrections written.')
    return 0


# ----------------------------------------------------------------------- new

def cmd_new(args):
    slug = re.sub(r'[^a-z0-9]+', '-', args.slug.lower()).strip('-')
    dest = os.path.join(SHEETS, f'{slug}.json')
    if os.path.exists(dest):
        print(f'  {dest} already exists — refusing to overwrite.')
        return 1

    r = load(TEMPLATE)
    r['slug'] = slug
    r['title'] = args.title or slug.replace('-', ' ').title()
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump(r, fh, indent=2, ensure_ascii=False)
        fh.write('\n')

    db = load(INDEX)
    if not any(x['slug'] == slug for x in db['recipes']):
        db['recipes'].append({
            'slug': slug,
            'title': r['title'],
            'blurb': 'TODO — one or two sentences on what makes this recipe work.',
            'tags': r.get('tags', []),
        })
        db['recipes'].sort(key=lambda x: x['title'].lower())
        with open(INDEX, 'w', encoding='utf-8') as fh:
            json.dump(db, fh, indent=2, ensure_ascii=False)
            fh.write('\n')

    print(f'  created  data/recipes/{slug}.json')
    print(f'  indexed  "{r["title"]}"')
    print(f'  preview  recipe.html?r={slug}')
    print('\n  Fill in the sheet, then run: python3 tools/recipedb.py validate')
    return 0


# --------------------------------------------------------------------- index

def derive_blurb(r):
    """Card text for the home page, in order of preference."""
    if r.get('blurb'):
        return r['blurb'], 'sheet.blurb'
    summ = r.get('summary') or []
    if summ:
        # first sentence of the first summary paragraph, trimmed to card length
        first = re.split(r'(?<=[.!?])\s', summ[0].strip())[0]
        if len(first) > 190:
            first = first[:187].rsplit(' ', 1)[0] + '...'
        return first, 'summary[0]'
    return TODO_BLURB, 'placeholder'


TODO_BLURB = 'TODO - one or two sentences on what makes this recipe work.'


def sync_index(write):
    """Rebuild index entries from the sheets. Sheets are the source of truth for
    title, tags and projectId; blurb is kept unless the sheet supplies one."""
    db = load(INDEX)
    by_slug = {e['slug']: e for e in db['recipes']}
    added, updated, orphaned = [], [], []

    for path in sheet_paths():
        slug = os.path.basename(path)[:-5]
        if is_template(slug):
            continue
        r = load(path)
        blurb, src = derive_blurb(r)
        # Key order is fixed so regenerating the file produces a stable diff.
        pid = (r.get('meta') or {}).get('projectId')
        want = {'slug': slug, 'title': r.get('title', slug)}
        if pid:
            want['projectId'] = pid
        want['blurb'] = blurb
        want['tags'] = r.get('tags', [])

        e = by_slug.get(slug)
        if e is None:
            db['recipes'].append(want)
            added.append((slug, src))
            continue

        diffs = []
        for k in ('title', 'projectId'):
            if k in want and e.get(k) != want[k]:
                diffs.append(k); e[k] = want[k]
        if sorted(e.get('tags', [])) != sorted(want['tags']):
            diffs.append('tags'); e['tags'] = want['tags']
        if r.get('blurb') and e.get('blurb') != r['blurb']:
            diffs.append('blurb'); e['blurb'] = r['blurb']
        if not e.get('blurb'):
            diffs.append('blurb'); e['blurb'] = blurb
        if diffs:
            updated.append((slug, diffs))

    files = {os.path.basename(p)[:-5] for p in sheet_paths()}
    for e in db['recipes']:
        if e['slug'] not in files:
            orphaned.append(e['slug'])

    # Keep entries ordered by title so diffs stay readable.
    db['recipes'].sort(key=lambda x: x['title'].lower())

    changed = bool(added or updated)
    if changed and write:
        with open(INDEX, 'w', encoding='utf-8') as fh:
            json.dump(db, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
    return added, updated, orphaned, changed


def cmd_index(args):
    added, updated, orphaned, changed = sync_index(args.write)

    for slug, src in added:
        print(f'  + added    {slug}  (blurb from {src})')
    for slug, diffs in updated:
        print(f'  ~ updated  {slug}  ({", ".join(diffs)})')
    for slug in orphaned:
        print(f'  ! orphaned {slug}  indexed but data/recipes/{slug}.json is missing')

    todo = [s for s, src in added if src == 'placeholder']
    if todo:
        print(f'\n  {len(todo)} entry(ies) need a real blurb: {", ".join(todo)}')

    if not changed:
        print('  Index is in sync with the sheets.')
    elif not args.write:
        print(f'\n{len(added)} to add, {len(updated)} to update. '
              f'Re-run with --write to apply.')
    else:
        print(f'\n{len(added)} added, {len(updated)} updated.')

    # Orphans are a real error, but deleting a user's index entry is worse than
    # failing loudly — never auto-remove.
    return 1 if orphaned else 0


# --------------------------------------------------------------------- stats

def cmd_stats(args):
    db = load(INDEX)
    recipes = db['recipes']
    tags = Counter(t for r in recipes for t in r['tags'])
    declared = {t for g in db['groups'] for t in g['tags']}

    print(f'{len(recipes)} recipes · {len(tags)} tags · {len(db["groups"])} groups\n')

    for g in db['groups']:
        used = [(t, tags[t]) for t in g['tags'] if tags[t]]
        print(f'  {g["label"]}')
        for t, n in sorted(used, key=lambda x: -x[1]):
            print(f'      {n:>3}  {t}')
        print()

    for c in db.get('collections', []):
        print(f'  {c.get("icon","*")} {c.get("label","?")}: {len(c.get("slugs",[]))} recipes')
        for sl in c.get('slugs', []):
            print(f'      {sl}')
    print()

    loose = sorted(t for t in tags if t not in declared)
    if loose:
        print(f'  Unfiled (shown under "More Tags"): {loose}\n')

    est, plain, no_source = 0, 0, []
    sourced_url, sourced_author = 0, 0
    for p in sheet_paths():
        slug = os.path.basename(p)[:-5]
        if is_template(slug):
            continue
        r = load(p)
        rows = [x for fm in r.get('formulations', []) for x in rows_of(fm)]
        e = sum(1 for x in rows if x.get('estimated'))
        est += e
        plain += len(rows) - e
        src = r.get('meta', {}).get('source')
        if not src:
            no_source.append(slug)
        elif isinstance(src, dict):
            if src.get('url'):
                sourced_url += 1
            if src.get('author'):
                sourced_author += 1

    tot = est + plain
    print(f'  Ingredient rows: {tot}  ({est} estimated, {round(est / tot * 100)}%)')
    n = len(recipes)
    print(f'  Sheets with a source:        {n - len(no_source)}/{n}')
    print(f'       ...naming an author:    {sourced_author}')
    print(f'       ...with a live URL:     {sourced_url}')
    print(f'  Sheets without any source:   {len(no_source)}')
    for s in no_source:
        print(f'      {s}')
    return 0


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description='RecipeDB maintenance toolkit')
    sub = ap.add_subparsers(dest='cmd', required=True)

    v = sub.add_parser('validate', help='check every sheet and the index')
    v.add_argument('--strict', action='store_true', help='treat warnings as failures')
    v.set_defaults(fn=cmd_validate)

    rc = sub.add_parser('recalc', help='recompute percentages and totals from masses')
    rc.add_argument('slug', help='a recipe slug, or "all"')
    rc.add_argument('--write', action='store_true', help='apply changes (default: dry run)')
    rc.set_defaults(fn=cmd_recalc)

    n = sub.add_parser('new', help='scaffold a sheet and register it in the index')
    n.add_argument('slug')
    n.add_argument('--title', help='display title (defaults to the slug, title-cased)')
    n.set_defaults(fn=cmd_new)

    ix = sub.add_parser('index', help='sync data/index.json from the sheet files')
    ix.add_argument('--write', action='store_true', help='apply changes (default: dry run)')
    ix.set_defaults(fn=cmd_index)

    s = sub.add_parser('stats', help='archive overview')
    s.set_defaults(fn=cmd_stats)

    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == '__main__':
    main()

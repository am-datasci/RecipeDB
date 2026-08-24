# RecipeDB

Recipes written as technical formulation sheets — a master matrix with a baseline
ingredient locked at 100 %, gram conversions, mise en place, and a numbered
execution sequence. Static site, no build step, no dependencies.

**Live site:** https://am-datasci.github.io/RecipeDB/

---

# Part 1 — The workflow

Adding a recipe is three steps: **ask Claude → save the file → push.** Everything
else happens on its own.

## One-time setup: the Claude project

Do this once. It turns a general chat into a recipe-sheet author that already
knows the schema, the house tone, and the rules.

1. Go to [claude.ai](https://claude.ai) → **Projects** → **Create project**.
   Name it something like *RecipeDB Sheet Author*.

2. Open the project's **Instructions** (sometimes "Set custom instructions")
   and paste the entire contents of [`instructions.txt`](instructions.txt).
   That file is the whole brief — schema, tone, the mass rule, tag taxonomy,
   source attribution, privacy rules, and a pre-flight checklist.

3. Add the two templates to **Project knowledge** so it has concrete examples:

   - [`data/recipes/_template-minimal.json`](data/recipes/_template-minimal.json)
     — the smallest valid sheet, and the right starting point for most recipes
   - [`data/recipes/_template.json`](data/recipes/_template.json)
     — every supported field, with the rule for each written into its own
       placeholder value

   Adding two or three real sheets helps too. Good ones to include:
   `mushroom-bolognese.json` (source-attributed, estimated masses, footnote) and
   `summer-garbanzo-meal-prep.json` (multiple matrices in one sheet).

**Re-paste the instructions whenever `instructions.txt` changes.** The project
holds a copy; it does not track the file.

## Creating a recipe

Give the project the recipe in whatever form you have — a URL, pasted text, a
photo of a cookbook page, a document — and ask for a formulation sheet.

> Turn this into a recipe formulation sheet:
> https://www.seriouseats.com/some-recipe

It returns **one JSON file**. You do not need to ask for an index entry; that is
generated later from the sheet itself.

Useful things to say:

| You want | Say |
|---|---|
| A different baseline ingredient | "Lock the flour at 100 % instead" |
| Your own addition included | "I add 2 tbsp miso" — it gets marked *user-added* |
| It to stop inventing variations | It already won't. `alternatives` is only for variations the source states. |
| A sanity check on the maths | "Show me the percentage for each row against the baseline" |

It should tell you, in a short note after the JSON, about any assumption it
made — an estimated mass, an ambiguous quantity, a new tag.

## Saving the file

Save the JSON block to:

```
data/recipes/<slug>.json
```

The filename must match the `"slug"` inside the file. Lowercase, hyphens,
ASCII only — it becomes the public URL.

Then check it:

```bash
python3 tools/recipedb.py validate
```

No Python packages to install. If it prints `All checks passed`, you're done.
See [When validate complains](#when-validate-complains) below if it doesn't.

## Publishing

```bash
git add data/recipes/<slug>.json
git commit -m "Add <recipe name>"
git push
```

That's it. On push, three things happen automatically:

1. **Sync recipe index** regenerates `data/index.json` from the sheets and
   commits the result. Your new recipe appears on the home page.
2. **Validate recipes** re-checks everything.
3. **GitHub Pages** rebuilds the site, usually within a minute.

Watch them at
[github.com/am-datasci/RecipeDB/actions](https://github.com/am-datasci/RecipeDB/actions).

Prefer to do the index step yourself before pushing? `python3 tools/recipedb.py
index --write` runs the identical code locally.

## Featuring it

New recipes are not featured automatically — that's your call. To pin one to the
**Favorites** section at the top of the home page, add its slug to
[`data/index.json`](data/index.json), around line 8:

```json
"collections": [
  {
    "label": "Favorites",
    "icon": "★",
    "slugs": [
      "mushroom-bolognese",
      "your-new-recipe"
    ]
  }
]
```

The order you write is the order on the page. Add another object to create a
second collection — *Weeknight*, *To Try*, whatever — and it gets its own
section, filter chip, and badge with no code change.

## When validate complains

`validate` distinguishes **errors** (the site would be wrong) from **warnings**
(worth a look).

| Message | What to do |
|---|---|
| `slug field is "x" but filename is "y.json"` | Rename the file, or fix the slug inside it. They must match. |
| `no row marked "baseline": true` | Exactly one ingredient needs `"baseline": true` and `"pct": 100.0`. The batch scaler needs it. |
| `pct=X but mass implies Y` | Arithmetic drift. `python3 tools/recipedb.py recalc <slug> --write` fixes it. |
| `total mass X but rows sum to Y` | Same fix. If the total *deliberately* excludes rows (an optional garnish), add `"partial": true` inside the `total` object. |
| `tagged Vegan but contains "Fish Sauce"` | A real conflict. Fix the tag, or name the default ingredient in the matrix and move the substitution to `alternatives`. |
| `has estimated masses but no matrixFootnote` | Any sheet with an `"estimated": true` row needs a footnote saying which items were estimated and on what basis. |
| `privacy: contains "..."` | The repo is public. Remove it. |
| `collection "Favorites" references unknown recipe "x"` | Typo in a slug in `collections`. |
| `blurb is still the auto-generated placeholder` | Write a real one-line description in the sheet's `"blurb"` field. |

---

# Part 2 — How it works

## Where things live

```
index.html              home page — flat recipe list, filters, search
recipe.html             the ONE template every recipe page renders through
assets/js/recipe.js     the template engine
assets/js/home.js       listing, filtering, collections
assets/css/site.css     styles (light / dark / print)
data/index.json         collections + tag groups (yours) + recipes (generated)
data/recipes/<slug>.json  one formulation sheet per recipe
tools/recipedb.py       validate / recalc / index / new / stats
instructions.txt        the Claude project brief
```

## Who owns what in `data/index.json`

| Key | |
|---|---|
| `$comment` | yours — never rewritten |
| `collections` | yours — the curated Favorites list |
| `groups` | yours — which tags sit under which heading |
| `recipes` | **generated** from the sheets |

Sheets are the source of truth. A recipe's `title`, `tags`, `projectId`, and
`blurb` all live in `data/recipes/<slug>.json` — editing them in `index.json`
gets overwritten on the next sync.

The one split worth remembering: **a tag lives in the sheet, but which group it
belongs to lives in `index.json`.**

## Adding a tag

Put it in the recipe sheet's `tags` array. That's the whole step — a tag not
listed in any group is auto-collected into a **More Tags** section, so it shows
up immediately with no configuration.

To file it under a proper heading, add the string to that group's `tags` array
in `index.json`:

```json
{ "id": "cuisine", "label": "By Cuisine", "tags": ["Italian", "Thai", "Korean"] }
```

Tags are descriptive — they say what a recipe *is*, and `validate` checks diet
tags against the actual ingredient list. Collections are editorial: they say
what you think of it.

## Sheet fields

Only `title` and one populated `formulations` entry are required. The renderer
skips whatever is absent, so a simple recipe stays simple.

`meta`, `blurb`, `summary`, `specs`, `scalingPrinciple`, `formulations`, `mise`,
`execution`, `qc`, `alternatives`, `sections`, `directive`.

[`data/recipes/_template.json`](data/recipes/_template.json) documents every one
of them in place, and renders at `recipe.html?r=_template` if you want to see
what each does.

## Batch scaling

Each matrix locks one ingredient as the baseline at 100 %. The scaler on every
recipe page recomputes all masses from it — by multiplier (0.5× to 3×) or by
typing a target baseline weight in grams. Percentages stay fixed; only masses
move.

This is why the baseline choice matters: get it wrong and scaling is wrong for
the whole sheet.

## Gram estimates

Masses marked `*` are standard culinary conversions from volumetric measures,
not weights stated by the source. Roughly 44 % of ingredient rows in the archive
are estimates — most sources give volumes.

Sheets built from sources with few or no quantities carry a reconstruction
notice at the top of the page.

## Maintenance scripts

Stdlib Python 3, no dependencies:

```bash
python3 tools/recipedb.py validate       # check every sheet and the index
python3 tools/recipedb.py validate --strict
python3 tools/recipedb.py index          # dry run: show index drift
python3 tools/recipedb.py index --write  # regenerate index.json from the sheets
python3 tools/recipedb.py recalc all     # dry run: show percentage/total drift
python3 tools/recipedb.py recalc all --write
python3 tools/recipedb.py new <slug>     # scaffold a sheet from the template
python3 tools/recipedb.py stats          # archive overview
```

`validate` exits non-zero on errors, so it works as a pre-commit hook or in CI.
It checks slug/filename agreement, exactly one baseline row at 100 %,
percentages against the baseline mass, totals against row sums, estimated masses
having a footnote, index cross-references, collection slugs, unfiled tags,
leftover template placeholders, private terms, and diet tags against the actual
ingredient list — it knows almond milk is not dairy and vegan fish sauce is not
fish.

## Running locally

Browsers block `fetch()` on `file://` URLs, so serve the folder over HTTP:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/

## Source documents

The original `.docx` working files are deliberately **not** committed — see
[`.gitignore`](.gitignore). They stay local.

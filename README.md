# RecipeDB

Recipes written as technical formulation sheets — a master matrix with a baseline
ingredient locked at 100%, gram conversions, mise en place, and a numbered
execution sequence. Static site, no build step, no dependencies.

**Live site:** https://am-datasci.github.io/RecipeDB/

## How it works

Every page is generated at runtime from JSON. There is no HTML to edit.

```
index.html              home — renders groups and tags from data/index.json
recipe.html             the ONE template every recipe page renders through
assets/js/recipe.js     the template engine
assets/js/home.js       grouping, tag filtering, search
assets/css/site.css     styles (light/dark/print)
data/index.json         tag taxonomy + recipe metadata
data/recipes/<slug>.json  one formulation sheet per recipe
```

## Adding a tag

Add the string to any recipe's `tags` array in `data/index.json`. That's it.

Tags not listed in any group are auto-collected into a "More Tags" group, so a
brand-new tag appears on the home page immediately. To file it under a specific
heading, add it to that group's `tags` array:

```json
{ "id": "cuisine", "label": "By Cuisine", "tags": ["Italian", "Thai", "Korean"] }
```

Recipes can carry as many tags as they like and appear under each one. Marking a
favorite is just adding `"Favorites"` to its tags — that pins it to the top section.

## Adding a recipe

1. Drop a new `data/recipes/<slug>.json` file in, following the shape of an
   existing one.
2. Add a matching entry to the `recipes` array in `data/index.json`.

Core fields: `meta`, `summary`, `specs`, `scalingPrinciple`, `formulations`,
`mise`, `execution`, `qc`, `alternatives`, `sections`, `directive`. All are
optional except a title and at least one formulation — the renderer skips what
isn't there, so a simple recipe stays simple.

## Batch scaling

Each matrix locks one ingredient as the baseline at 100%. The scaler on every
recipe page recomputes all masses from that baseline, either by multiplier
(0.5× to 3×) or by typing a target baseline weight in grams. Percentages stay
fixed; only masses move.

## Gram estimates

Masses marked with an asterisk (`*`) are standard culinary conversions from
volumetric measures, not weights stated by the source. Sheets built from sources
that give few or no quantities carry a reconstruction notice at the top.

## Running locally

Browsers block `fetch()` on `file://` URLs, so open it over HTTP:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000/

## Source documents

The original `.docx` working files are deliberately **not** committed — see
`.gitignore`. They remain local.

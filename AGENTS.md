# AGENTS.md

Guidance for AI coding assistants (and humans) working in this repo.
Read this file **first**, then `README.md` for end-user docs.

## Project overview

**Cubical Resource Validator** (formerly "Atlas") is a Hebrew terminology filtering engine. It checks free-text resource names (rooms, queues, offices, services, etc.) against curated **blacklist** / **whitelist** / **problematic-combination** lists and returns a binary decision (`BLOCK` / `ALLOW`) plus an `UNKNOWN` UI state for unrecognized tokens.

Use case: prevent accidental exposure of military-sensitive terminology in otherwise unclassified systems.

## Repo layout

```
api/              FastAPI app
  app.py            HTTP routes, in-memory indexes, override workflow
  static/           Static UI (RTL Hebrew)
    index.html        Validator page (served at "/")
    browse.html       Index/browse page for all lists (served at "/browse")
scripts/          CLI tools + reusable library
  normalize.py      Hebrew normalization (niqqud, quotes, dashes, prefixes)
  classify.py       Core BLOCK/ALLOW logic
  combinations.py   Problematic-combination detection
  ingest.py         Dataset generation
  export.py         CSV writers + field schemas
data/             CSV datasets (treat as generated artifacts, do NOT hand-edit casually)
  blacklist.csv             ~275 rows
  whitelist.csv             ~129,400 rows  ← LARGE; never ship to browser in full
  problematic_combinations.csv  ~88 rows
  user_whitelist_additions.csv / user_blacklist_additions.csv  ← user overrides via UI
  all_terms.csv, whitelist_words.csv, ...    word-only and audit views
  whitelist_parts/          Excel-friendly split of whitelist
docs/             Source/policy docs
tests/            pytest tests (see test conventions below)
logs/             audit.jsonl when /classify is called with audit=true
```

## How to run

Local dev (FastAPI):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api.app:app --reload
```

Open `http://127.0.0.1:8000/` for the validator and `http://127.0.0.1:8000/browse` for the list-browse page.

Optional Vite live-reload for editing static UI (proxies API to `:8000`):

```bash
npm install
npm run dev   # http://127.0.0.1:5173/
```

## How to test

```bash
.venv/bin/python -m pytest -q
```

**Important convention**: `pytest.ini` sets `python_files = *_tests.py`. New test files must be named like `foo_tests.py`, **not** `test_foo.py` — pytest will silently skip them otherwise.

When adding a test that mutates `data/`, monkeypatch `api.app.DATA_DIR` to `tmp_path` and call `validation_index.cache_clear()` (and `list_index.cache_clear()` if you touch the browse API) — see `tests/api_tests.py::seed_override_test_data` for the pattern.

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET  | `/` | Validator UI (index.html) |
| GET  | `/ui` | Alias for `/` |
| GET  | `/browse` | Browse/index UI (browse.html) |
| GET  | `/health` | Liveness |
| POST | `/classify` | Server-side BLOCK/ALLOW classification (CLI-style) |
| POST | `/validate-detailed` | Token-level result used by the UI |
| GET  | `/suggest` | Autocomplete; needs `q` with ≥2 chars |
| POST | `/overrides/whitelist` | Force-allow a term (writes CSVs) |
| POST | `/overrides/blacklist` | Force-block a term (writes CSVs) |
| GET  | `/lists/{blacklist\|whitelist\|combinations}` | Paginated browse; query params: `q`, `letter`, `page`, `page_size` (≤500) |

## Code conventions

- **Hebrew/RTL UI**: keep `lang="he"` and `dir="rtl"` on all HTML. Use the existing CSS variables (`--ink`, `--paper`, `--green`, `--red`, `--yellow`, etc.).
- **Normalization**: any term comparison must go through `scripts.normalize.normalize_text` — never compare raw strings. It handles niqqud removal, quote/dash normalization, conservative Hebrew prefix stripping.
- **Use the caches**: `validation_index()` and `list_index()` in `api/app.py` are `@lru_cache(maxsize=1)`. Don't re-read CSVs in request handlers. When data files change (e.g. after overrides) call `.cache_clear()` on both.
- **Whitelist size**: ~129k rows. **Never** return the full whitelist in one response and **never** bundle it into the browser. Always paginate via `/lists/whitelist`.
- **Combinations have different field names** in `data/problematic_combinations.csv` (`combination`, `normalized_combination`) — normalize through `normalize_combination_row` before treating them like term rows.
- **Surgical changes**: don't touch CSV data files or `scripts/` core logic unless explicitly asked. UI/API/test changes are usually enough.
- **No secrets in commits.** No external network calls from request handlers.

## Common pitfalls

- New test file named `test_*.py` → pytest skips it (see test conventions).
- Forgetting to clear `list_index` cache after override → browse page shows stale data.
- Loading the whitelist into the DOM → freezes the browser. Always paginate.
- Using `.startswith` on raw text → fails on niqqud/quotes; normalize first.
- Editing data CSVs by hand → breaks audit trail; use the override endpoints or `scripts/ingest.py`.

## When you change things, update

- `README.md` — for user-facing run/test/endpoint changes.
- This file (`AGENTS.md`) — when adding endpoints, changing test conventions, or adding new data files.
- `pytest.ini` — only if you have a strong reason; many tools and tests rely on the `*_tests.py` convention.

# Atlas Hebrew Terminology Filtering Engine

Atlas is a Hebrew terminology filtering engine for administrative systems that allow users to name free-text resources, appointments, rooms, queues, offices, or services.

The project was built for a security-review use case: prevent accidental exposure of military-sensitive terminology in otherwise unclassified systems. The main threat model is mosaic intelligence: a single free-text value may look harmless, but repeated names such as ranks, units, locations, command structures, operations, or sensitive acronyms can reveal organizational structure, activity, or presence over time.

Atlas currently uses a binary decision model:

- `BLOCK`: reject the text because it matches sensitive military / defense terminology or a risky combination.
- `ALLOW`: approve the text because it is either explicitly safe or does not match the sensitive rule set.

`greylist.csv` is kept only as a compatibility artifact and intentionally has no data rows.

## What It Filters

The blacklist covers, among other categories:

- senior ranks and command roles
- IDF and Ministry of Defense acronyms
- intelligence, operations, cyber, and command terminology
- sensitive units and combat brigades
- sensitive military locations and base identifiers
- operational phrases and problematic combinations
- strategic assets, weapons, missiles, artillery, bunkers, and classified equipment terms

The whitelist contains general Hebrew lexicon terms plus explicitly approved routine terms for:

- medical services
- welfare and religious services
- HR and administration
- logistics and maintenance
- known unclassified locations approved by policy

## Files For Info-Sec Review

For approval workflows, the most useful files are the slim word-only CSVs:

- `data/blacklist_words.csv`
- `data/whitelist_words.csv`
- `data/problematic_combinations_words.csv`

The full whitelist is large, so it is also split into Excel-friendly parts:

- `data/whitelist_parts/manifest.csv`
- `data/whitelist_parts/whitelist_words_part_001.csv`
- ...

Audit/debug files with metadata are also included:

- `data/blacklist.csv`
- `data/whitelist.csv`
- `data/problematic_combinations.csv`
- `data/review_decisions.csv`

`review_decisions.csv` records the final decision, confidence bucket, reason, and source for every reviewed term.

## How It Works

The engine applies:

- Hebrew normalization, including niqqud removal, quote normalization, dash/space normalization, and conservative prefix stripping.
- Curated blacklist and whitelist policy rules.
- Public-source IDF / Ministry of Defense terminology additions.
- Generated problematic combinations, such as office + rank, base + unit, project + intelligence, or room + operations terms.
- Conflict handling where blacklist wins if a normalized term appears in both black and white sources.
- Word-only export for reviewers and metadata-rich export for auditability.

## Generate Datasets

```bash
python3 -m scripts.ingest --clone --export-seed
```

This writes:

- `data/all_terms.csv`
- `data/blacklist.csv`
- `data/greylist.csv`
- `data/whitelist.csv`
- `data/problematic_combinations.csv`
- `data/blacklist_words.csv`
- `data/whitelist_words.csv`
- `data/problematic_combinations_words.csv`
- `data/review_decisions.csv`

## Classify Text

```bash
python3 -m scripts.classify "לשכת אלוף"
```

## API

```bash
uvicorn api.app:app --reload
```

Open the browser UI:

```text
http://127.0.0.1:8000/
```

POST `/classify`:

```json
{
  "text": "לשכת אלוף",
  "audit": true
}
```

Blocked requests with `audit: true` are appended to `logs/audit.jsonl`.

Additional UI endpoints:

- `GET /suggest?q=עמ`: autocomplete after at least two characters.
- `POST /validate-detailed`: token-level validation for the live UI.
- `POST /overrides/whitelist`: force a submitted term into `all_terms.csv` and `whitelist.csv`, removing it from `blacklist.csv` if present. Also records it in `data/user_whitelist_additions.csv`.
- `POST /overrides/blacklist`: force a submitted term into `all_terms.csv` and `blacklist.csv`, removing it from `whitelist.csv` if present. Also records it in `data/user_blacklist_additions.csv`.

`validate-detailed` returns UI-only `overall_status` values:

- `ALLOW`: no blocked terms or unknown tokens.
- `BLOCK`: a blacklisted term or problematic combination matched.
- `UNKNOWN`: no block, but at least one typed token is not recognized in the black/white data.

## Optional Public Lexicon Ingestion

Network access is optional. When available:

```bash
python3 -m scripts.ingest --clone --export-seed
```

The ingester clones `https://github.com/eyaler/hebrew_wordlists.git` and loads `hspell_simple.txt` as the broad Hebrew lexicon base. The cloned source repository itself is intentionally not committed because it is large; datasets generated from it are committed under `data/`.

## Run Tests

```bash
python3 -m pytest -q
```

The tests cover normalization, classification, ingestion/export, binary black/white partitioning, user policy overrides, and generated review artifacts.

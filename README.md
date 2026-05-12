# Atlas Hebrew Terminology Filtering Engine

Atlas classifies Hebrew free text into `BLOCK`, `MANUAL_REVIEW`, or `ALLOW` using aggressive Hebrew normalization, curated lexicons, fuzzy matching, phrase matching, problematic-combination detection, risk scoring, and audit logging.

## Generate Datasets

```bash
python3 -m scripts.export
```

This writes:

- `data/all_terms.csv`
- `data/blacklist.csv`
- `data/greylist.csv`
- `data/whitelist.csv`
- `data/problematic_combinations.csv`

## Classify Text

```bash
python3 -m scripts.classify "לשכת אלוף"
```

## API

```bash
uvicorn api.app:app --reload
```

POST `/classify`:

```json
{
  "text": "לשכת אלוף",
  "audit": true
}
```

Blocked and reviewed requests with `audit: true` are appended to `logs/audit.jsonl`.

## Optional Public Lexicon Ingestion

Network access is optional. When available:

```bash
python3 -m scripts.ingest --clone --export-seed
```

The ingester can clone `https://github.com/eyaler/hebrew_wordlists.git` and load `hspell_simple.txt` as low-confidence general Hebrew lexicon candidates. The shipped security datasets are generated offline from Atlas seed data.

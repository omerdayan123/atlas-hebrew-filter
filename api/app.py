import csv
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from scripts.classify import classify_text
from scripts.combinations import detect_combinations, load_combination_rules
from scripts.export import TERM_FIELDS, write_csv, write_split_word_only_csv, write_word_only_csv
from scripts.normalize import normalize_text


app = FastAPI(title="Cubical Resource Validator")
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "api" / "static"
TOKEN_RE = re.compile(r"[\u0590-\u05ffA-Za-z0-9]+")
MIN_SUGGESTION_PREFIX = 2
MAX_SUGGESTION_PREFIX = 24
MAX_SUGGESTIONS_PER_PREFIX = 200


class ClassificationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    audit: bool = False


class DetailedValidationRequest(BaseModel):
    text: str = Field(..., min_length=1)


class TermOverrideRequest(BaseModel):
    term: str = Field(..., min_length=1)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def ui() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/ui", response_class=HTMLResponse)
def ui_alias() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/browse", response_class=HTMLResponse)
def browse() -> FileResponse:
    return FileResponse(STATIC_DIR / "browse.html")


@app.post("/classify")
def classify(request: ClassificationRequest) -> dict:
    return classify_text(request.text, audit=request.audit)


@app.post("/overrides/whitelist")
def add_whitelist_override(request: TermOverrideRequest) -> dict:
    try:
        row = move_term_to_list(request.term, "ALLOW")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {
        "status": "ok",
        "message": "Term added to whitelist override list",
        "term": row["term"],
        "normalized_term": row["normalized_term"],
        "action": row["action"],
    }


@app.post("/overrides/blacklist")
def add_blacklist_override(request: TermOverrideRequest) -> dict:
    try:
        row = move_term_to_list(request.term, "BLOCK")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {
        "status": "ok",
        "message": "Term added to blacklist override list",
        "term": row["term"],
        "normalized_term": row["normalized_term"],
        "action": row["action"],
    }


def read_csv_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_override_history(path: Path, row: dict) -> None:
    fields = [
        "term",
        "normalized_term",
        "action",
        "category",
        "source",
        "created_at",
        "notes",
    ]
    rows = read_csv_rows(path)
    rows = [existing for existing in rows if existing["normalized_term"] != row["normalized_term"]]
    rows.append({field: row.get(field, "") for field in fields})
    write_csv(path, rows, fields)


def move_term_to_list(term: str, action: str, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or DATA_DIR
    normalized = normalize_text(term)
    if not normalized:
        raise ValueError("Term has no normalized content")

    is_allow = action == "ALLOW"
    target_name = "whitelist.csv" if is_allow else "blacklist.csv"
    opposite_name = "blacklist.csv" if is_allow else "whitelist.csv"
    history_name = "user_whitelist_additions.csv" if is_allow else "user_blacklist_additions.csv"
    category = "user_whitelist_override" if is_allow else "user_blacklist_override"
    source = "atlas_ui_user_whitelist_override" if is_allow else "atlas_ui_user_blacklist_override"
    notes = (
        "User override from UI: force allow term"
        if is_allow
        else "User override from UI: force block term"
    )
    row = {
        "term": term.strip(),
        "normalized_term": normalized,
        "category": category,
        "source": source,
        "risk_level": 0 if is_allow else 95,
        "action": action,
        "confidence": 0.99,
        "notes": notes,
    }

    target_rows = read_csv_rows(data_dir / target_name)
    opposite_rows = read_csv_rows(data_dir / opposite_name)
    all_rows = read_csv_rows(data_dir / "all_terms.csv")

    target_rows = [existing for existing in target_rows if existing["normalized_term"] != normalized]
    opposite_rows = [existing for existing in opposite_rows if existing["normalized_term"] != normalized]
    all_rows = [existing for existing in all_rows if existing["normalized_term"] != normalized]
    target_rows.append(row)

    blacklist_rows = target_rows if not is_allow else opposite_rows
    whitelist_rows = target_rows if is_allow else opposite_rows
    all_rows = blacklist_rows + whitelist_rows

    write_csv(data_dir / "blacklist.csv", blacklist_rows, TERM_FIELDS)
    write_csv(data_dir / "whitelist.csv", whitelist_rows, TERM_FIELDS)
    write_csv(data_dir / "all_terms.csv", all_rows, TERM_FIELDS)
    write_word_only_csv(data_dir / "blacklist_words.csv", blacklist_rows)
    write_word_only_csv(data_dir / "whitelist_words.csv", whitelist_rows)
    write_split_word_only_csv(data_dir / "whitelist_parts", whitelist_rows)
    write_override_history(
        data_dir / history_name,
        {
            **row,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    validation_index.cache_clear()
    list_index.cache_clear()
    return row


@lru_cache(maxsize=1)
def validation_index() -> dict:
    blacklist_rows = read_csv_rows(DATA_DIR / "blacklist.csv")
    whitelist_rows = read_csv_rows(DATA_DIR / "whitelist.csv")
    combination_rows = read_csv_rows(DATA_DIR / "problematic_combinations.csv")
    approved_rows = read_csv_rows(DATA_DIR / "approved_resource_analysis.csv")

    blacklist = {
        row["normalized_term"]: row
        for row in blacklist_rows
        if row.get("normalized_term")
    }
    whitelist = {
        row["normalized_term"]: row
        for row in whitelist_rows
        if row.get("normalized_term")
    }
    combinations = load_combination_rules(combination_rows)
    suggestions = build_suggestions(approved_rows, whitelist_rows, set(blacklist))
    suggestion_prefixes = build_suggestion_prefixes(suggestions)
    return {
        "blacklist": blacklist,
        "whitelist": whitelist,
        "combinations": combinations,
        "suggestions": suggestions,
        "suggestion_prefixes": suggestion_prefixes,
    }


def build_suggestions(
    approved_rows: list[dict],
    whitelist_rows: list[dict],
    blacklisted_norms: set[str],
) -> list[dict]:
    suggestions: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(display_term: str, source_type: str) -> None:
        normalized = normalize_text(display_term)
        if not normalized or normalized in blacklisted_norms:
            return
        key = (normalized, source_type)
        if key in seen:
            return
        seen.add(key)
        suggestions.append(
            {
                "display_term": display_term,
                "normalized_term": normalized,
                "source_type": source_type,
            }
        )

    for row in approved_rows:
        if row.get("action") == "ALLOW":
            add(row["resource_name"], "approved_example")
    for row in whitelist_rows:
        add(row["term"], "whitelist")
    return suggestions


def build_suggestion_prefixes(suggestions: list[dict]) -> dict[str, list[dict]]:
    prefixes: dict[str, list[dict]] = {}
    seen_by_prefix: dict[str, set[str]] = {}

    for suggestion in suggestions:
        normalized_term = suggestion["normalized_term"]
        candidates = {normalized_term, *normalized_term.split()}
        for candidate in candidates:
            max_length = min(len(candidate), MAX_SUGGESTION_PREFIX)
            for length in range(MIN_SUGGESTION_PREFIX, max_length + 1):
                prefix = candidate[:length]
                bucket = prefixes.setdefault(prefix, [])
                if len(bucket) >= MAX_SUGGESTIONS_PER_PREFIX:
                    continue
                seen = seen_by_prefix.setdefault(prefix, set())
                if normalized_term in seen:
                    continue
                seen.add(normalized_term)
                bucket.append(suggestion)
    return prefixes


def suggestion_matches_normalized(normalized_query: str, suggestion: dict) -> bool:
    normalized_term = suggestion["normalized_term"]
    return normalized_term.startswith(normalized_query) or any(
        token.startswith(normalized_query) for token in normalized_term.split()
    )


@app.get("/suggest")
def suggest(q: str = Query(default=""), limit: int = Query(default=12, ge=1, le=50)) -> dict:
    normalized_query = normalize_text(q)
    if len(normalized_query) < 2:
        return {"query": q, "suggestions": []}
    index_key = normalized_query[:MAX_SUGGESTION_PREFIX]
    candidate_suggestions = validation_index()["suggestion_prefixes"].get(index_key, [])
    if len(normalized_query) > MAX_SUGGESTION_PREFIX:
        candidate_suggestions = [
            suggestion
            for suggestion in candidate_suggestions
            if suggestion_matches_normalized(normalized_query, suggestion)
        ]
    return {"query": q, "suggestions": candidate_suggestions[:limit]}


def text_tokens(text: str) -> list[str]:
    return [match.group(0) for match in TOKEN_RE.finditer(text)]


def segment_for_token(token: str, blacklist: dict, whitelist: dict) -> dict:
    normalized = normalize_text(token)
    if normalized in blacklist:
        return {
            "value": token,
            "status": "BLOCK",
            "reason": f"Blocked term: {blacklist[normalized]['term']}",
        }
    if normalized in whitelist:
        return {
            "value": token,
            "status": "ALLOW",
            "reason": "Approved term",
        }
    return {"value": token, "status": "UNKNOWN", "reason": "Unknown term"}


LIST_SOURCES = {"blacklist", "whitelist", "combinations"}
HEBREW_LETTERS = list("אבגדהוזחטיכלמנסעפצקרשת")
ENGLISH_LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGIT_BUCKETS = list("0123456789")
OTHER_BUCKET = "אחר"


def normalize_combination_row(row: dict) -> dict:
    return {
        "term": row.get("combination", ""),
        "normalized_term": row.get("normalized_combination", ""),
        "category": row.get("category", ""),
        "risk_level": row.get("risk_level", ""),
        "action": row.get("action", ""),
        "notes": row.get("notes", ""),
    }


def normalize_term_row(row: dict) -> dict:
    return {
        "term": row.get("term", ""),
        "normalized_term": row.get("normalized_term", ""),
        "category": row.get("category", ""),
        "risk_level": row.get("risk_level", ""),
        "action": row.get("action", ""),
        "notes": row.get("notes", ""),
    }


def letter_bucket_for(value: str) -> str:
    if not value:
        return OTHER_BUCKET
    char = value[0]
    if char in HEBREW_LETTERS:
        return char
    upper = char.upper()
    if upper in ENGLISH_LETTERS:
        return upper
    if char in DIGIT_BUCKETS:
        return char
    return OTHER_BUCKET


@lru_cache(maxsize=1)
def list_index() -> dict:
    blacklist_rows = [
        normalize_term_row(row)
        for row in read_csv_rows(DATA_DIR / "blacklist.csv")
        if row.get("normalized_term")
    ]
    whitelist_rows = [
        normalize_term_row(row)
        for row in read_csv_rows(DATA_DIR / "whitelist.csv")
        if row.get("normalized_term")
    ]
    combination_rows = [
        normalize_combination_row(row)
        for row in read_csv_rows(DATA_DIR / "problematic_combinations.csv")
        if row.get("normalized_combination")
    ]

    sources = {
        "blacklist": blacklist_rows,
        "whitelist": whitelist_rows,
        "combinations": combination_rows,
    }

    indexed: dict[str, dict] = {}
    for name, rows in sources.items():
        sorted_rows = sorted(rows, key=lambda item: item["normalized_term"])
        letter_counts: dict[str, int] = {}
        for row in sorted_rows:
            bucket = letter_bucket_for(row["normalized_term"])
            letter_counts[bucket] = letter_counts.get(bucket, 0) + 1
        indexed[name] = {
            "rows": sorted_rows,
            "letter_counts": letter_counts,
        }
    return indexed


def filter_list_rows(rows: list[dict], *, query: str = "", letter: str = "") -> list[dict]:
    normalized_query = normalize_text(query) if query else ""
    if letter:
        if letter == OTHER_BUCKET:
            letter_filter = letter
        elif letter.isascii() and letter.isalpha():
            letter_filter = letter.upper()
        else:
            letter_filter = letter
    else:
        letter_filter = ""

    def matches(row: dict) -> bool:
        if letter_filter and letter_bucket_for(row["normalized_term"]) != letter_filter:
            return False
        if normalized_query:
            normalized_term = row["normalized_term"]
            if normalized_query in normalized_term:
                return True
            return any(token.startswith(normalized_query) for token in normalized_term.split())
        return True

    return [row for row in rows if matches(row)]


@app.get("/lists/{list_name}")
def get_list(
    list_name: str,
    q: str = Query(default=""),
    letter: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
) -> dict:
    if list_name not in LIST_SOURCES:
        raise HTTPException(status_code=404, detail=f"Unknown list: {list_name}")
    entry = list_index()[list_name]
    filtered = filter_list_rows(entry["rows"], query=q, letter=letter)
    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    items = filtered[start:end]

    bucket_order = HEBREW_LETTERS + ENGLISH_LETTERS + DIGIT_BUCKETS + [OTHER_BUCKET]
    letter_counts = entry["letter_counts"]
    letters = [
        {"letter": bucket, "count": letter_counts.get(bucket, 0)}
        for bucket in bucket_order
    ]

    return {
        "list": list_name,
        "query": q,
        "letter": letter,
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": items,
        "letters": letters,
    }


@app.post("/validate-detailed")
def validate_detailed(request: DetailedValidationRequest) -> dict:
    index = validation_index()
    normalized_text = normalize_text(request.text)
    segments = [
        segment_for_token(token, index["blacklist"], index["whitelist"])
        for token in text_tokens(request.text)
    ]
    matched_combinations = detect_combinations(request.text, index["combinations"])
    matched_combination_phrases = sorted({rule.phrase for rule in matched_combinations})
    has_block = any(segment["status"] == "BLOCK" for segment in segments) or bool(
        matched_combinations
    )
    has_unknown = any(segment["status"] == "UNKNOWN" for segment in segments)
    if has_block:
        overall_status = "BLOCK"
    elif has_unknown:
        overall_status = "UNKNOWN"
    else:
        overall_status = "ALLOW"

    return {
        "text": request.text,
        "normalized_text": normalized_text,
        "overall_status": overall_status,
        "segments": segments,
        "matched_terms": sorted(
            {
                segment["value"]
                for segment in segments
                if segment["status"] in {"BLOCK", "ALLOW"}
            }
        ),
        "matched_combinations": matched_combination_phrases,
    }

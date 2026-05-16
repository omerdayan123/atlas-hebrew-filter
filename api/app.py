import csv
import re
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from scripts.classify import classify_text
from scripts.combinations import detect_combinations, load_combination_rules
from scripts.normalize import normalize_text


app = FastAPI(title="Atlas Hebrew Military Terminology Filtering Engine")
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "api" / "static"
TOKEN_RE = re.compile(r"[\u0590-\u05ffA-Za-z0-9]+")


class ClassificationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    audit: bool = False


class DetailedValidationRequest(BaseModel):
    text: str = Field(..., min_length=1)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def ui() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/ui", response_class=HTMLResponse)
def ui_alias() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/classify")
def classify(request: ClassificationRequest) -> dict:
    return classify_text(request.text, audit=request.audit)


def read_csv_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


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
    return {
        "blacklist": blacklist,
        "whitelist": whitelist,
        "combinations": combinations,
        "suggestions": suggestions,
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


def suggestion_matches(query: str, suggestion: dict) -> bool:
    normalized_query = normalize_text(query)
    if len(normalized_query) < 2:
        return False
    normalized_term = suggestion["normalized_term"]
    return normalized_term.startswith(normalized_query) or any(
        token.startswith(normalized_query) for token in normalized_term.split()
    )


@app.get("/suggest")
def suggest(q: str = Query(default=""), limit: int = Query(default=12, ge=1, le=50)) -> dict:
    normalized_query = normalize_text(q)
    if len(normalized_query) < 2:
        return {"query": q, "suggestions": []}
    suggestions = [
        suggestion
        for suggestion in validation_index()["suggestions"]
        if suggestion_matches(normalized_query, suggestion)
    ]
    return {"query": q, "suggestions": suggestions[:limit]}


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

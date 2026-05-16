import csv
from pathlib import Path

from scripts.lexicon_rules import NORMALIZED_BLACKLIST_PATTERNS, _contains_any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
REVIEW_FIELDS = [
    "term",
    "normalized_term",
    "decision",
    "confidence",
    "review_bucket",
    "reason",
    "source",
]

EXPLICIT_SAFE_SOURCE_MARKERS = {
    "atlas_seed_whitelist",
    "atlas_default_whitelist",
    "atlas_approved_resource_token",
}
EXPLICIT_BLACK_SOURCE_MARKERS = {
    "atlas_seed_blacklist",
    "idf_public",
    "mod_public",
    "public_acronym",
    "public_rank",
    "wiktionary_public",
    "atlas_heuristic_blacklist",
    "atlas_seed_greylist_promoted_blacklist",
}
APPROVED_SAFE_TERMS = {
    "נשקייה",
    "צריפין",
    "שיזפון",
    "תל השומר",
    "מוסך יחידתי",
}
FALSE_POSITIVE_FAMILIES = [
    "אינפנטיל",
    "טקסטיל",
    "דירקטור",
    "כירופרקט",
    "טרקטור",
    "אטרקטיבי",
    "אבסטרקטי",
    "אנורקטי",
    "אנטרקטי",
    "ארקטי",
    "נשק",  # verbs around kissing are allowed unless exact weapons context matched by blacklist.
    "קרב",  # generic approach/sacrifice families are allowed unless exact combat context matched.
]


def read_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def source_contains(row: dict, markers: set[str]) -> bool:
    source = row.get("source", "")
    return any(marker in source for marker in markers)


def sensitive_pattern_category(normalized_term: str) -> str | None:
    for category, patterns in NORMALIZED_BLACKLIST_PATTERNS.items():
        if _contains_any(normalized_term, patterns):
            return category
    return None


def looks_like_false_positive(normalized_term: str) -> bool:
    return any(family in normalized_term for family in FALSE_POSITIVE_FAMILIES)


def review_row(row: dict, decision: str) -> dict:
    term = row["term"]
    normalized = row["normalized_term"]
    category = sensitive_pattern_category(normalized)
    source = row.get("source", "")

    if decision == "BLOCK":
        if source_contains(row, EXPLICIT_BLACK_SOURCE_MARKERS):
            confidence = "high"
            bucket = "reviewed_black_explicit"
            reason = f"Blocked by curated/public/heuristic blacklist source; category={row.get('category', '')}"
        elif category:
            confidence = "medium"
            bucket = "reviewed_black_pattern"
            reason = f"Blocked by sensitive normalized pattern; category={category}"
        else:
            confidence = "medium"
            bucket = "reviewed_black_other"
            reason = "Blocked by final blacklist export"
    else:
        if term in APPROVED_SAFE_TERMS:
            confidence = "high"
            bucket = "reviewed_white_user_override"
            reason = "Explicitly approved by user policy"
        elif source_contains(row, {"atlas_approved_resource_token"}):
            confidence = "high"
            bucket = "reviewed_white_approved_resource_token"
            reason = "Individual token extracted from an infosec-approved production resource name"
        elif source_contains(row, {"atlas_seed_whitelist"}):
            confidence = "high"
            bucket = "reviewed_white_curated"
            reason = "Curated routine/admin whitelist term"
        elif category and not looks_like_false_positive(normalized):
            confidence = "low"
            bucket = "needs_second_pass_sensitive_pattern_in_white"
            reason = f"Whitelist term still resembles sensitive category={category}"
        elif looks_like_false_positive(normalized):
            confidence = "medium"
            bucket = "reviewed_white_false_positive_family"
            reason = "Allowed as known Hebrew false-positive family after blacklist-pattern audit"
        elif source_contains(row, EXPLICIT_SAFE_SOURCE_MARKERS):
            confidence = "medium"
            bucket = "reviewed_white_general_lexicon"
            reason = "General Hebrew lexicon term with no sensitive blacklist pattern"
        else:
            confidence = "low"
            bucket = "needs_second_pass_unknown_source"
            reason = "Allowed but source did not match expected whitelist markers"

    return {
        "term": term,
        "normalized_term": normalized,
        "decision": decision,
        "confidence": confidence,
        "review_bucket": bucket,
        "reason": reason,
        "source": source,
    }


def write_review(path: Path = DATA_DIR / "review_decisions.csv") -> None:
    blacklist_rows = read_rows(DATA_DIR / "blacklist.csv")
    whitelist_rows = read_rows(DATA_DIR / "whitelist.csv")
    rows = [review_row(row, "BLOCK") for row in blacklist_rows]
    rows.extend(review_row(row, "ALLOW") for row in whitelist_rows)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    write_review()

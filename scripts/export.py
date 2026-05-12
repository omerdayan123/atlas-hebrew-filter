import csv
from pathlib import Path

from scripts.lexicon_seed import (
    BLACKLIST_TERMS,
    COMBINATION_ANCHORS,
    GREYLIST_TERMS,
    PROBLEMATIC_COMBINATIONS,
    PUBLIC_SOURCE_BLACKLIST_TERMS,
    WHITELIST_TERMS,
)
from scripts.lexicon_rules import trace_external_row
from scripts.normalize import normalize_text


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TERM_FIELDS = [
    "term",
    "normalized_term",
    "category",
    "source",
    "risk_level",
    "action",
    "confidence",
    "notes",
]
COMBINATION_FIELDS = [
    "combination",
    "normalized_combination",
    "category",
    "source",
    "risk",
    "risk_level",
    "action",
    "confidence",
    "notes",
]


def term_rows() -> list[dict]:
    rows: list[dict] = []
    for action, source_name, terms, confidence in [
        ("BLOCK", "atlas_seed_blacklist", BLACKLIST_TERMS, 0.95),
        ("BLOCK", "atlas_seed_greylist_promoted_blacklist", GREYLIST_TERMS, 0.82),
        ("ALLOW", "atlas_seed_whitelist", WHITELIST_TERMS, 0.9),
    ]:
        for term, category, risk_level, notes in terms:
            rows.append(
                {
                    "term": term,
                    "normalized_term": normalize_text(term),
                    "category": category,
                    "source": source_name,
                    "risk_level": risk_level,
                    "action": action,
                    "confidence": confidence,
                    "notes": notes,
                }
            )
    for term, category, risk_level, notes, source in PUBLIC_SOURCE_BLACKLIST_TERMS:
        rows.append(
            {
                "term": term,
                "normalized_term": normalize_text(term),
                "category": category,
                "source": source,
                "risk_level": risk_level,
                "action": "BLOCK",
                "confidence": 0.88,
                "notes": notes,
            }
        )
    return rows


def combination_rows() -> list[dict]:
    seeded = [
        {
            "combination": phrase,
            "normalized_combination": normalize_text(phrase),
            "category": "problematic_combination",
            "source": "atlas_seed_combinations",
            "risk": risk_label,
            "risk_level": risk_score,
            "action": "BLOCK" if risk_score >= 90 else "MANUAL_REVIEW",
            "confidence": 0.9,
            "notes": notes,
        }
        for phrase, risk_label, risk_score, notes in PROBLEMATIC_COMBINATIONS
    ]
    generated = []
    existing = {row["normalized_combination"] for row in seeded}
    for anchor, targets, risk_label, risk_score, notes in COMBINATION_ANCHORS:
        for target in targets:
            phrase = f"{anchor} {target}"
            normalized = normalize_text(phrase)
            if normalized in existing:
                continue
            existing.add(normalized)
            generated.append(
                {
                    "combination": phrase,
                    "normalized_combination": normalized,
                    "category": "generated_problematic_combination",
                    "source": "atlas_generated_combinations",
                    "risk": risk_label,
                    "risk_level": risk_score,
                    "action": "BLOCK" if risk_score >= 90 else "MANUAL_REVIEW",
                    "confidence": 0.78,
                    "notes": notes,
                }
            )
    return seeded + generated


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_word_only_csv(path: Path, rows: list[dict], key: str = "term") -> None:
    unique_terms = sorted({row[key] for row in rows if row.get(key)})
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["term"])
        for term in unique_terms:
            writer.writerow([term])


def deduplicate_rows(rows: list[dict]) -> list[dict]:
    seen: set[tuple[str, str, str]] = set()
    deduped: list[dict] = []
    for row in rows:
        key = (row["normalized_term"], row["action"], row["source"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def partition_external_rows(seed_rows: list[dict], external_rows: list[dict]) -> list[dict]:
    curated_by_norm = {row["normalized_term"]: row for row in seed_rows}
    return [trace_external_row(row, curated_by_norm) for row in external_rows]


def split_black_white(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    black_norms = {row["normalized_term"] for row in rows if row["action"] == "BLOCK"}
    blacklist_rows = [row for row in rows if row["action"] == "BLOCK"]
    whitelist_rows = [
        row
        for row in rows
        if row["action"] == "ALLOW" and row["normalized_term"] not in black_norms
    ]
    return blacklist_rows, whitelist_rows


def export_all(data_dir: Path = DATA_DIR, external_rows: list[dict] | None = None) -> None:
    rows = term_rows()
    traced_external_rows = partition_external_rows(rows, external_rows or [])
    all_rows = deduplicate_rows(rows + traced_external_rows)
    blacklist_rows, whitelist_rows = split_black_white(all_rows)
    all_rows = blacklist_rows + whitelist_rows
    combination_rows_ = combination_rows()
    write_csv(data_dir / "all_terms.csv", all_rows, TERM_FIELDS)
    write_csv(data_dir / "blacklist.csv", blacklist_rows, TERM_FIELDS)
    write_csv(data_dir / "greylist.csv", [], TERM_FIELDS)
    write_csv(data_dir / "whitelist.csv", whitelist_rows, TERM_FIELDS)
    write_csv(data_dir / "problematic_combinations.csv", combination_rows_, COMBINATION_FIELDS)
    write_word_only_csv(data_dir / "blacklist_words.csv", blacklist_rows)
    write_word_only_csv(data_dir / "whitelist_words.csv", whitelist_rows)
    write_word_only_csv(
        data_dir / "problematic_combinations_words.csv",
        combination_rows_,
        key="combination",
    )


if __name__ == "__main__":
    export_all()

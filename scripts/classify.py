import csv
import json
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

from scripts.combinations import detect_combinations, load_combination_rules
from scripts.export import export_all
from scripts.normalize import normalize_text, tokenize


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LOG_PATH = ROOT / "logs" / "audit.jsonl"


def ensure_data() -> None:
    required = [
        DATA_DIR / "blacklist.csv",
        DATA_DIR / "greylist.csv",
        DATA_DIR / "whitelist.csv",
        DATA_DIR / "problematic_combinations.csv",
    ]
    if not all(path.exists() for path in required):
        export_all(DATA_DIR)


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def load_terms() -> list[dict]:
    ensure_data()
    rows: list[dict] = []
    for filename in ("blacklist.csv", "greylist.csv", "whitelist.csv"):
        rows.extend(read_csv(DATA_DIR / filename))
    return rows


def load_combinations() -> list[dict]:
    ensure_data()
    return read_csv(DATA_DIR / "problematic_combinations.csv")


def similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def phrase_or_fuzzy_match(
    normalized_text: str,
    tokens: list[str],
    normalized_term: str,
    allow_fuzzy: bool = True,
) -> bool:
    term_tokens = normalized_term.split()
    if not term_tokens:
        return False
    if len(term_tokens) == 1:
        if normalized_term in tokens:
            return True
    elif normalized_term in normalized_text:
        return True
    if not allow_fuzzy:
        return False
    if len(normalized_term) < 4:
        return False
    if len(term_tokens) == 1:
        return any(similarity(token, normalized_term) >= 0.86 for token in tokens)
    for start in range(0, max(len(tokens) - len(term_tokens) + 1, 0)):
        candidate = " ".join(tokens[start : start + len(term_tokens)])
        if similarity(candidate, normalized_term) >= 0.86:
            return True
    return False


def action_from_matches(has_risk_match: bool) -> str:
    return "BLOCK" if has_risk_match else "ALLOW"


def classify_text(text: str, audit: bool = False) -> dict:
    normalized_text = normalize_text(text)
    tokens = tokenize(text)
    matched_rows = [
        row
        for row in load_terms()
        if phrase_or_fuzzy_match(
            normalized_text,
            tokens,
            row["normalized_term"],
            allow_fuzzy=row["action"] != "ALLOW",
        )
    ]
    combination_rules = load_combination_rules(load_combinations())
    matched_combinations = detect_combinations(text, combination_rules)

    whitelist_hits = [row for row in matched_rows if row["action"] == "ALLOW"]
    risk_rows = [
        row
        for row in matched_rows
        if row["action"] != "ALLOW"
    ]
    risk_scores = [int(row["risk_level"]) for row in risk_rows]
    risk_scores.extend(rule.risk_score for rule in matched_combinations)
    score = max(risk_scores) if risk_scores else max([int(row["risk_level"]) for row in whitelist_hits], default=0)

    action = action_from_matches(bool(risk_rows or matched_combinations))
    reasons: list[str] = []
    if any(row["action"] == "BLOCK" for row in risk_rows):
        reasons.append("Matched sensitive military terminology")
    if matched_combinations:
        reasons.append("Matched problematic term combination")
    if not reasons:
        reasons.append("No sensitive terminology detected")

    result = {
        "risk_score": score,
        "action": action,
        "matched_terms": sorted({row["term"] for row in matched_rows}),
        "matched_combination": sorted({rule.phrase for rule in matched_combinations}),
        "normalized_text": normalized_text,
        "reason": "; ".join(reasons),
    }
    if audit and action != "ALLOW":
        write_audit_event(text, result)
    return result


def write_audit_event(text: str, result: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input_text": text,
        "result": result,
    }
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Classify Hebrew free text for military terminology risk.")
    parser.add_argument("text")
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    print(json.dumps(classify_text(args.text, audit=args.audit), ensure_ascii=False, indent=2))

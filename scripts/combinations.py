from dataclasses import dataclass
from difflib import SequenceMatcher

from scripts.normalize import normalize_text, tokenize


@dataclass(frozen=True)
class CombinationRule:
    phrase: str
    normalized_phrase: str
    risk_label: str
    risk_score: int
    notes: str


def similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def token_matches(candidate: str, target: str, threshold: float = 0.82) -> bool:
    return similarity(candidate, target) >= threshold


def load_combination_rules(rows: list[dict]) -> list[CombinationRule]:
    return [
        CombinationRule(
            phrase=row["combination"],
            normalized_phrase=row["normalized_combination"],
            risk_label=row["risk"],
            risk_score=int(row["risk_level"]),
            notes=row.get("notes", ""),
        )
        for row in rows
    ]


def detect_combinations(text: str, rules: list[CombinationRule], window: int = 4) -> list[CombinationRule]:
    normalized = normalize_text(text)
    tokens = tokenize(text)
    matches: list[CombinationRule] = []
    for rule in rules:
        phrase_tokens = rule.normalized_phrase.split()
        if not phrase_tokens:
            continue
        if rule.normalized_phrase in normalized:
            matches.append(rule)
            continue
        if len(phrase_tokens) == 1:
            continue
        first_positions = [
            index for index, token in enumerate(tokens) if token_matches(token, phrase_tokens[0])
        ]
        for start in first_positions:
            cursor = start + 1
            found = True
            for target in phrase_tokens[1:]:
                end = min(len(tokens), cursor + window)
                next_index = None
                for index in range(cursor, end):
                    if token_matches(tokens[index], target):
                        next_index = index
                        break
                if next_index is None:
                    found = False
                    break
                cursor = next_index + 1
            if found:
                matches.append(rule)
                break
    return matches

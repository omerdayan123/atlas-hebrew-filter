from scripts.normalize import normalize_token


SENSITIVE_BLACKLIST_PATTERNS = {
    "rank": [
        "אלוף",
        "רמטכל",
        "תאל",
        "סגן אלוף",
        "סאל",
        "אלמ",
        "רב סרן",
        "רסן",
    ],
    "command_structure": [
        "פיקוד",
        "פיקודי",
        "מפקדה",
        "מפקדת",
        "מפקד",
        "מטכל",
        "אגם",
        "קצין",
        "קציני",
        "אוגדה",
        "אוגדת",
        "אוגדות",
        "חיל",
        "חטיבות",
        "חטיבתי",
        "פלוגה",
        "פלוגות",
    ],
    "operations": [
        "מבצע",
        "מבצעי",
        "מבצעים",
        "חמל",
        "חפק",
        "כוננות",
        "תצא",
        "תצפית",
        "תרגיל",
        "לחימה",
        "לוחמה",
        "מלחמה",
        "מלחמתי",
        "התחמש",
        "התחמשות",
        "התחמשויות",
        "הצנח",
        "הצנחה",
        "הצנחות",
    ],
    "intelligence_security": [
        "מודיעין",
        "מודיעיני",
        "קריפטוגרפיה",
        "הצפנה",
        "סייבר",
        "מסווג",
        "חשאי",
        "מוצפן",
    ],
    "military_assets": [
        "תחמושת",
        "נשק",
        "טיל",
        "טילים",
        "טילי",
        "ארטילריה",
        "ארטילרי",
        "רקטה",
        "רקטות",
        "רקטי",
        "כטבם",
        "מל\"ט",
        "מלט",
        "מכמ",
        "רדאר",
        "בונקר",
        "בונקרים",
    ],
}

EXPLICIT_SAFE_NORMALIZED_TERMS = {
    "סודי",
    "סודית",
    "סודי ביותר",
    "מבצעי",
    "מבצעית",
    "תחקיר",
    "תחקיר בטחוני",
}

GREYLIST_PATTERNS = {
    "organization_context": [
        "יחידה",
        "יחידת",
        "חטיבה",
        "גדוד",
        "בסיס",
        "מתקן",
        "מדור",
        "מחלקה",
        "אגף",
        "ענף",
        "לשכה",
    ],
    "project_context": [
        "פרויקט",
        "תחקיר",
        "נוהל",
        "תוכנית",
        "מערך",
    ],
}


def _contains_any(normalized_term: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if len(pattern) <= 3:
            if normalized_term == pattern:
                return True
            continue
        if normalized_term == pattern or normalized_term.startswith(pattern):
            return True
    return False


NORMALIZED_BLACKLIST_PATTERNS = {
    category: [
        " ".join(normalize_token(token, remove_prefix=False) for token in pattern.split())
        for pattern in patterns
    ]
    for category, patterns in SENSITIVE_BLACKLIST_PATTERNS.items()
}
NORMALIZED_GREYLIST_PATTERNS = {
    category: [
        " ".join(normalize_token(token, remove_prefix=False) for token in pattern.split())
        for pattern in patterns
    ]
    for category, patterns in GREYLIST_PATTERNS.items()
}


def trace_external_row(row: dict, curated_by_norm: dict[str, dict]) -> dict:
    normalized = row["normalized_term"]
    if normalized in curated_by_norm:
        return curated_by_norm[normalized]
    if normalized in EXPLICIT_SAFE_NORMALIZED_TERMS:
        return {
            **row,
            "category": "approved_resource_label",
            "source": f"{row['source']}+atlas_user_approved_resource_label",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.92,
            "notes": "Approved as workstation/network/resource label based on production infosec-approved examples",
        }

    for category, patterns in NORMALIZED_BLACKLIST_PATTERNS.items():
        if _contains_any(normalized, patterns):
            return {
                **row,
                "category": category,
                "source": f"{row['source']}+atlas_heuristic_blacklist",
                "risk_level": 90,
                "action": "BLOCK",
                "confidence": 0.72,
                "notes": f"Promoted from cloned lexicon by sensitive pattern category: {category}",
            }

    for category, patterns in NORMALIZED_GREYLIST_PATTERNS.items():
        if _contains_any(normalized, patterns):
            return {
                **row,
                "category": category,
                "source": f"{row['source']}+atlas_heuristic_greylist",
                "risk_level": 64,
                "action": "MANUAL_REVIEW",
                "confidence": 0.64,
                "notes": f"Promoted from cloned lexicon by context-sensitive pattern category: {category}",
            }

    return {
        **row,
        "category": "general_hebrew_whitelist",
        "source": f"{row['source']}+atlas_default_whitelist",
        "risk_level": 0,
        "action": "ALLOW",
        "confidence": 0.55,
        "notes": "Default whitelist from cloned Hebrew lexicon; no blacklist pattern matched",
    }

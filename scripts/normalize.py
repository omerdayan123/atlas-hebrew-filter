import re
import unicodedata


HEBREW_PREFIXES = ("ב", "ל", "מ", "ה", "ו", "כ", "ש")
QUOTE_CHARS = "'\"״׳`´“”‘’"
CONSTRUCT_FORMS = {
    "לשכת": "לשכה",
    "יחידת": "יחידה",
    "חטיבת": "חטיבה",
    "מחלקת": "מחלקה",
    "מפקדת": "מפקדה",
}
PROTECTED_PREFIX_WORDS = set(CONSTRUCT_FORMS) | set(CONSTRUCT_FORMS.values()) | {
    "מודיעין",
    "מבצעים",
    "מפקדה",
    "מחלקה",
    "לוחמה",
    "בסיס",
}
PREFIX_STRIPPABLE_BASES = PROTECTED_PREFIX_WORDS | {
    "אלוף",
    "מבצע",
    "מבצעים",
    "מבצעי",
    "חמל",
    "סייבר",
    "קריפטוגרפיה",
    "הצפנה",
    "צופן",
    "שייטת",
    "סיירת",
    "מטכל",
    "שלדג",
    "דובדבן",
    "מגלן",
    "אגוז",
    "יהלם",
    "לוטם",
    "מצוב",
    "הקריה",
    "נבטים",
    "חצרים",
    "פלמחים",
    "מרפאה",
    "בדיקת",
    "דם",
    "תור",
    "מספרה",
    "ספרייה",
    "משרד",
    "קבלה",
    "אפסנאות",
}


def strip_niqqud(text: str) -> str:
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def _can_strip_to_known_base(token: str, max_depth: int = 3) -> bool:
    candidate = token
    for _ in range(max_depth):
        if len(candidate) <= 3 or candidate[0] not in HEBREW_PREFIXES:
            return False
        candidate = candidate[1:]
        if candidate in PREFIX_STRIPPABLE_BASES or candidate in CONSTRUCT_FORMS:
            return True
    return False


def normalize_token(token: str, remove_prefix: bool = True) -> str:
    token = strip_niqqud(token).strip().lower()
    token = token.translate(str.maketrans("", "", QUOTE_CHARS))
    token = re.sub(r"[^\u0590-\u05ff0-9a-zA-Z]+", "", token)
    if not token:
        return ""
    if token in CONSTRUCT_FORMS:
        return CONSTRUCT_FORMS[token]
    while remove_prefix and len(token) > 3 and token[0] in HEBREW_PREFIXES:
        candidate = token[1:]
        if (
            candidate not in PREFIX_STRIPPABLE_BASES
            and candidate not in CONSTRUCT_FORMS
            and not _can_strip_to_known_base(token)
        ):
            break
        token = token[1:]
        if token in CONSTRUCT_FORMS:
            return CONSTRUCT_FORMS[token]
    return token


def normalize_text(text: str) -> str:
    text = strip_niqqud(text)
    text = text.translate(str.maketrans({ch: "" for ch in QUOTE_CHARS}))
    text = re.sub(r"[-־–—_/]+", " ", text)
    text = re.sub(r"[^\u0590-\u05ff0-9a-zA-Z\s]+", " ", text)
    tokens = [normalize_token(part) for part in text.split()]
    return " ".join(token for token in tokens if token)


def tokenize(text: str) -> list[str]:
    normalized = normalize_text(text)
    return normalized.split() if normalized else []

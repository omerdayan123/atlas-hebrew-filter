from scripts.normalize import normalize_text, normalize_token


def test_removes_hebrew_prefixes_from_tokens():
    assert normalize_text("במפקדה ללשכה והמודיעין") == "מפקדה לשכה מודיעין"


def test_strips_niqqud_quotes_and_punctuation():
    assert normalize_text("רַע״נ רע''נ רע\"נ") == "רענ רענ רענ"


def test_normalizes_dashes_and_common_feminine_suffix():
    assert normalize_text("תת-אלוף") == "תת אלוף"
    assert normalize_text("לשכת אלוף") == "לשכה אלוף"


def test_prefix_removal_does_not_destroy_short_words_or_numbers():
    assert normalize_token("8200") == "8200"
    assert normalize_token("של") == "של"
    assert normalize_token("בסיס") == "בסיס"
    assert normalize_token("מבצע") == "מבצע"
    assert normalize_token("מרפאה") == "מרפאה"
    assert normalize_text("תור למרפאה ובדיקת דם") == "תור מרפאה בדיקת דם"

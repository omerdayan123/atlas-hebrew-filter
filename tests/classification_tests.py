from scripts.classify import classify_text


def test_blocks_sensitive_rank_and_combination():
    result = classify_text("לשכת אלוף")

    assert result["action"] == "BLOCK"
    assert result["risk_score"] >= 90
    assert "אלוף" in result["matched_terms"]
    assert "לשכת אלוף" in result["matched_combination"]
    assert result["normalized_text"] == "לשכה אלוף"


def test_blocks_former_context_sensitive_terms_in_binary_mode():
    result = classify_text("בקשה לפתיחת מדור")

    assert result["action"] == "BLOCK"
    assert "מדור" in result["matched_terms"]


def test_allows_civilian_administrative_terms():
    result = classify_text("תור למרפאה ובדיקת דם")

    assert result["action"] == "ALLOW"
    assert result["risk_score"] < 60
    assert "מרפאה" in result["matched_terms"]


def test_detects_problematic_nearby_combination():
    result = classify_text("צריך חדר גדול עבור מצב חירום")

    assert result["action"] == "BLOCK"
    assert result["risk_score"] >= 60
    assert "חדר מצב" in result["matched_combination"]


def test_binary_mode_never_returns_manual_review():
    for text in ["שלום", "בסיס", "חדר מצב", "מדור"]:
        assert classify_text(text)["action"] in {"BLOCK", "ALLOW"}


def test_fuzzy_matching_catches_quote_free_abbreviation_typo():
    result = classify_text("נא לפתוח חמל צפוני")

    assert result["action"] == "BLOCK"
    assert result["risk_score"] >= 90
    assert "חמ\"ל" in result["matched_terms"]


def test_does_not_report_irrelevant_whitelist_fuzzy_matches():
    result = classify_text("בסיס 8200")

    assert result["action"] == "BLOCK"
    assert result["normalized_text"] == "בסיס 8200"
    assert "בסיס 8200" in result["matched_combination"]
    assert "סי" not in result["matched_terms"]


def test_blocks_public_mod_and_idf_acronyms():
    for text, expected in [
        ('מפא"ת', 'מפא"ת'),
        ('מנה"ר', 'מנה"ר'),
        ('אגף התקשוב וההגנה בסב"ר', 'אגף התקשוב וההגנה בסב"ר'),
        ('אמ"ן', 'אמ"ן'),
    ]:
        result = classify_text(text)
        assert result["action"] == "BLOCK"
        assert expected in result["matched_terms"]


def test_blocks_public_rank_office_combinations():
    result = classify_text('לשכת אל"מ')

    assert result["action"] == "BLOCK"
    assert result["risk_score"] >= 90
    assert 'אל"מ' in result["matched_terms"]
    assert 'לשכה אל"מ' in result["matched_combination"]


def test_blocks_public_command_structure_phrase():
    result = classify_text("מפקדת פיקוד הצפון")

    assert result["action"] == "BLOCK"
    assert result["risk_score"] >= 90
    assert "פיקוד הצפון" in result["matched_terms"]


def test_blocks_standalone_operation_terms_from_security_guide():
    for text in ["מבצע", "שם מבצע", "חדר מבצעים"]:
        result = classify_text(text)
        assert result["action"] == "BLOCK"
        assert result["risk_score"] >= 90


def test_blocks_units_places_and_sensitive_roles_from_security_guide():
    for text, expected in [
        ("שייטת 13", "שייטת 13"),
        ("סיירת מטכל", 'סיירת מטכ"ל'),
        ("לוטם", "לוטם"),
        ("מצוב", 'מצו"ב'),
        ("הקריה", "הקריה"),
        ("נבטים", "נבטים"),
        ('רע"נ', 'רע"נ'),
        ('קמבץ', 'קמב"ץ'),
    ]:
        result = classify_text(text)
        assert result["action"] == "BLOCK"
        assert expected in result["matched_terms"]


def test_user_policy_blocks_combat_brigades():
    for text in ["גולני", "גבעתי", "נחל", "כפיר", "צנחנים", "חטיבת הקומנדו"]:
        result = classify_text(text)
        assert result["action"] == "BLOCK"


def test_user_policy_allows_known_unclassified_locations_and_armory_service():
    for text in ["צריפין", "שיזפון", "תל השומר", "נשקייה"]:
        result = classify_text(text)
        assert result["action"] == "ALLOW"
        assert result["risk_score"] < 60


def test_approved_resource_network_labels_are_allowed():
    for text in [
        "עמדה סודי",
        "עמדה סודי ביותר",
        "עמדת עבודה אישית (סודי+סודי ביותר)",
        "VC מבצעי",
        "תחקיר בטחוני",
    ]:
        result = classify_text(text)
        assert result["action"] == "ALLOW"


def test_rank_and_command_resource_names_stay_blocked():
    for text in [
        'חדר מג"ד - בדרגת סא"ל ומעלה בלבד',
        "חדר בכירים בלבד",
        "מכלול מפקדים",
    ]:
        result = classify_text(text)
        assert result["action"] == "BLOCK"


def test_generic_commander_office_resource_names_are_allowed():
    for text in [
        "משרד מפקד",
        "משרד מפקד משותף",
        "משרד מפקד - מחשב סודי , VC",
    ]:
        result = classify_text(text)
        assert result["action"] == "ALLOW"

import csv

from fastapi.testclient import TestClient

import api.app as api_app
from api.app import app, validation_index
from scripts.export import COMBINATION_FIELDS, TERM_FIELDS, write_csv


client = TestClient(app)


def seed_override_test_data(tmp_path):
    write_csv(
        tmp_path / "blacklist.csv",
        [
            {
                "term": "רגיש",
                "normalized_term": "רגיש",
                "category": "seed",
                "source": "test",
                "risk_level": 95,
                "action": "BLOCK",
                "confidence": 1,
                "notes": "",
            }
        ],
        TERM_FIELDS,
    )
    write_csv(
        tmp_path / "whitelist.csv",
        [
            {
                "term": "מותר",
                "normalized_term": "מותר",
                "category": "seed",
                "source": "test",
                "risk_level": 0,
                "action": "ALLOW",
                "confidence": 1,
                "notes": "",
            }
        ],
        TERM_FIELDS,
    )
    write_csv(tmp_path / "all_terms.csv", [], TERM_FIELDS)
    write_csv(tmp_path / "problematic_combinations.csv", [], COMBINATION_FIELDS)
    write_csv(tmp_path / "approved_resource_analysis.csv", [], ["resource_name", "action"])


def read_rows(path):
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_suggest_requires_at_least_two_characters():
    response = client.get("/suggest", params={"q": "ע"})

    assert response.status_code == 200
    assert response.json()["suggestions"] == []


def test_suggest_returns_approved_examples_before_whitelist_terms():
    response = client.get("/suggest", params={"q": "עמ"})

    assert response.status_code == 200
    suggestions = response.json()["suggestions"]
    assert suggestions
    assert suggestions[0]["source_type"] == "approved_example"
    assert suggestions[0]["display_term"].startswith("עמד")


def test_suggest_uses_prebuilt_prefix_index():
    index = validation_index()

    assert "suggestion_prefixes" in index
    assert index["suggestion_prefixes"]["עמ"]


def test_suggest_accepts_numbers():
    response = client.get("/suggest", params={"q": "10"})

    assert response.status_code == 200
    assert "suggestions" in response.json()


def test_ui_uses_inline_token_editor():
    response = client.get("/")

    assert response.status_code == 200
    assert 'contenteditable="true"' in response.text
    assert 'class="token' in response.text


def test_ui_contains_manual_override_fields():
    response = client.get("/")

    assert response.status_code == 200
    assert "הוספה לרשימה לבנה" in response.text
    assert "הוספה לרשימה שחורה" in response.text
    assert "/overrides/whitelist" in response.text
    assert "/overrides/blacklist" in response.text


def test_whitelist_override_moves_existing_black_term_to_white(tmp_path, monkeypatch):
    seed_override_test_data(tmp_path)
    monkeypatch.setattr(api_app, "DATA_DIR", tmp_path)
    validation_index.cache_clear()

    response = client.post("/overrides/whitelist", json={"term": "רגיש"})

    assert response.status_code == 200
    assert response.json()["action"] == "ALLOW"
    blacklist = read_rows(tmp_path / "blacklist.csv")
    whitelist = read_rows(tmp_path / "whitelist.csv")
    additions = read_rows(tmp_path / "user_whitelist_additions.csv")
    assert not any(row["normalized_term"] == "רגיש" for row in blacklist)
    assert any(row["normalized_term"] == "רגיש" for row in whitelist)
    assert additions[0]["normalized_term"] == "רגיש"


def test_blacklist_override_moves_existing_white_term_to_black(tmp_path, monkeypatch):
    seed_override_test_data(tmp_path)
    monkeypatch.setattr(api_app, "DATA_DIR", tmp_path)
    validation_index.cache_clear()

    response = client.post("/overrides/blacklist", json={"term": "מותר"})

    assert response.status_code == 200
    assert response.json()["action"] == "BLOCK"
    blacklist = read_rows(tmp_path / "blacklist.csv")
    whitelist = read_rows(tmp_path / "whitelist.csv")
    additions = read_rows(tmp_path / "user_blacklist_additions.csv")
    assert any(row["normalized_term"] == "מותר" for row in blacklist)
    assert not any(row["normalized_term"] == "מותר" for row in whitelist)
    assert additions[0]["normalized_term"] == "מותר"


def test_validate_detailed_allows_approved_resource_label():
    response = client.post("/validate-detailed", json={"text": "עמדה סודי"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["overall_status"] == "ALLOW"
    assert {segment["status"] for segment in payload["segments"]} == {"ALLOW"}


def test_validate_detailed_allows_tokens_from_approved_resource_labels():
    response = client.post("/validate-detailed", json={"text": "ביותר"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["overall_status"] == "ALLOW"
    assert payload["segments"] == [
        {"value": "ביותר", "status": "ALLOW", "reason": "Approved term"}
    ]


def test_validate_detailed_marks_unknown_without_blocking():
    response = client.post("/validate-detailed", json={"text": "בלורפ"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["overall_status"] == "UNKNOWN"
    assert payload["segments"] == [
        {"value": "בלורפ", "status": "UNKNOWN", "reason": "Unknown term"}
    ]


def test_validate_detailed_blocks_terms_and_combinations():
    response = client.post("/validate-detailed", json={"text": "בסיס 8200"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["overall_status"] == "BLOCK"
    assert "בסיס 8200" in payload["matched_combinations"]
    assert any(segment["status"] == "BLOCK" for segment in payload["segments"])

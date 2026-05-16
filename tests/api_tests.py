from fastapi.testclient import TestClient

from api.app import app, validation_index


client = TestClient(app)


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


def test_validate_detailed_allows_approved_resource_label():
    response = client.post("/validate-detailed", json={"text": "עמדה סודי"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["overall_status"] == "ALLOW"
    assert {segment["status"] for segment in payload["segments"]} == {"ALLOW"}


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

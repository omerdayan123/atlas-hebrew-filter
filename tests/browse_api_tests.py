from fastapi.testclient import TestClient

from api.app import app, list_index


client = TestClient(app)


def test_browse_page_served():
    response = client.get("/browse")
    assert response.status_code == 200
    assert "Cubical Resource Validator" in response.text
    assert "עיון ברשימות" in response.text


def test_main_page_links_to_browse():
    response = client.get("/")
    assert response.status_code == 200
    assert 'href="/browse"' in response.text
    assert "Cubical Resource Validator" in response.text


def test_lists_rejects_unknown_list():
    response = client.get("/lists/nope")
    assert response.status_code == 404


def test_lists_blacklist_default_pagination():
    response = client.get("/lists/blacklist")
    assert response.status_code == 200
    payload = response.json()
    assert payload["list"] == "blacklist"
    assert payload["page"] == 1
    assert payload["page_size"] == 100
    assert payload["total"] > 0
    assert len(payload["items"]) == min(payload["total"], 100)
    assert payload["items"][0]["normalized_term"]
    assert payload["items"][0]["action"] == "BLOCK"
    assert any(entry["letter"] for entry in payload["letters"])


def test_lists_whitelist_paginates_and_does_not_dump_everything():
    response = client.get("/lists/whitelist", params={"page_size": 50})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] > 1000
    assert len(payload["items"]) == 50


def test_lists_page_size_upper_bound_enforced():
    response = client.get("/lists/whitelist", params={"page_size": 5000})
    assert response.status_code == 422


def test_lists_filter_by_query_matches_normalized_term():
    response = client.get("/lists/blacklist", params={"q": "8200"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert any(item["normalized_term"] == "8200" for item in payload["items"])


def test_lists_filter_by_hebrew_letter():
    response = client.get("/lists/whitelist", params={"letter": "מ", "page_size": 50})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    for item in payload["items"]:
        assert item["normalized_term"].startswith("מ")


def test_lists_combinations_returns_expected_shape():
    response = client.get("/lists/combinations")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    item = payload["items"][0]
    assert "term" in item and "normalized_term" in item and "action" in item


def test_lists_pagination_advances():
    first = client.get("/lists/whitelist", params={"page": 1, "page_size": 10}).json()
    second = client.get("/lists/whitelist", params={"page": 2, "page_size": 10}).json()
    assert first["items"] and second["items"]
    assert first["items"] != second["items"]


def test_list_index_letter_counts_sum_to_total():
    list_index.cache_clear()
    response = client.get("/lists/blacklist")
    payload = response.json()
    counts_sum = sum(entry["count"] for entry in payload["letters"])
    assert counts_sum == payload["total"]

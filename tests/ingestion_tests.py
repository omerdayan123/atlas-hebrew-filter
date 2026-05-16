import csv

from scripts.export import export_all
from scripts.ingest import load_hspell_terms


def test_loads_hspell_simple_terms_from_cloned_source(tmp_path):
    source_dir = tmp_path / "hebrew_wordlists"
    source_dir.mkdir()
    (source_dir / "hspell_simple.txt").write_text("שלום\nמפקדה\n\n", encoding="utf-8")

    rows = load_hspell_terms(source_dir)

    assert [row["term"] for row in rows] == ["שלום", "מפקדה"]
    assert rows[1]["normalized_term"] == "מפקדה"
    assert rows[0]["source"] == "eyaler/hebrew_wordlists:hspell_simple.txt"


def test_export_all_routes_unknown_external_lexicon_rows_to_whitelist(tmp_path):
    external_rows = [
        {
            "term": "שלום",
            "normalized_term": "שלום",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        }
    ]

    export_all(tmp_path, external_rows=external_rows)

    with (tmp_path / "all_terms.csv").open(encoding="utf-8", newline="") as handle:
        all_terms = list(csv.DictReader(handle))
    with (tmp_path / "whitelist.csv").open(encoding="utf-8", newline="") as handle:
        whitelist = list(csv.DictReader(handle))
    with (tmp_path / "greylist.csv").open(encoding="utf-8", newline="") as handle:
        greylist = list(csv.DictReader(handle))

    assert any(row["term"] == "שלום" for row in all_terms)
    assert any(row["term"] == "שלום" for row in whitelist)
    assert greylist == []


def test_export_all_adds_individual_tokens_from_allowed_approved_resources(tmp_path):
    export_all(tmp_path, external_rows=[])

    with (tmp_path / "whitelist.csv").open(encoding="utf-8", newline="") as handle:
        whitelist = list(csv.DictReader(handle))

    approved_tokens = {
        row["normalized_term"]: row
        for row in whitelist
        if "atlas_approved_resource_token" in row["source"]
    }
    assert "ביותר" in approved_tokens
    assert approved_tokens["ביותר"]["term"] == "ביותר"
    assert approved_tokens["ביותר"]["action"] == "ALLOW"


def test_export_all_traces_sensitive_external_terms_to_blacklist(tmp_path):
    external_rows = [
        {
            "term": "פיקודי",
            "normalized_term": "פיקודי",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        }
    ]

    export_all(tmp_path, external_rows=external_rows)

    with (tmp_path / "blacklist.csv").open(encoding="utf-8", newline="") as handle:
        blacklist = list(csv.DictReader(handle))

    traced = [row for row in blacklist if row["term"] == "פיקודי"]
    assert traced
    assert traced[0]["action"] == "BLOCK"
    assert "heuristic" in traced[0]["source"]


def test_heuristics_do_not_match_prefix_stripped_rule_fragments(tmp_path):
    external_rows = [
        {
            "term": "אביגדור",
            "normalized_term": "אביגדור",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "אוננות",
            "normalized_term": "אוננות",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "אינפנטיל",
            "normalized_term": "אינפנטיל",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "חסודים",
            "normalized_term": "חסודים",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
    ]

    export_all(tmp_path, external_rows=external_rows)

    with (tmp_path / "whitelist.csv").open(encoding="utf-8", newline="") as handle:
        whitelist = list(csv.DictReader(handle))

    assert any(row["term"] == "אביגדור" for row in whitelist)
    assert any(row["term"] == "אוננות" for row in whitelist)
    assert any(row["term"] == "אינפנטיל" for row in whitelist)
    assert any(row["term"] == "חסודים" for row in whitelist)


def test_export_all_writes_word_only_black_and_white_lists(tmp_path):
    external_rows = [
        {
            "term": "שלום",
            "normalized_term": "שלום",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        }
    ]

    export_all(tmp_path, external_rows=external_rows)

    assert (tmp_path / "blacklist_words.csv").exists()
    assert (tmp_path / "whitelist_words.csv").exists()
    with (tmp_path / "blacklist_words.csv").open(encoding="utf-8") as handle:
        assert handle.readline().strip() == "term"
    with (tmp_path / "whitelist_words.csv").open(encoding="utf-8") as handle:
        lines = [line.strip() for line in handle]

    assert lines[0] == "term"
    assert "שלום" in lines


def test_export_all_writes_split_whitelist_parts(tmp_path):
    export_all(tmp_path, external_rows=[])

    manifest_path = tmp_path / "whitelist_parts" / "manifest.csv"
    assert manifest_path.exists()
    with manifest_path.open(encoding="utf-8", newline="") as handle:
        manifest = list(csv.DictReader(handle))

    assert manifest
    assert (tmp_path / "whitelist_parts" / manifest[0]["file"]).exists()


def test_export_all_partitions_every_term_into_black_or_white_only(tmp_path):
    external_rows = [
        {
            "term": "שלום",
            "normalized_term": "שלום",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "ארטילריה",
            "normalized_term": "ארטילריה",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "אוגדה",
            "normalized_term": "אוגדה",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "התחמשות",
            "normalized_term": "התחמשות",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
        {
            "term": "טקסטיל",
            "normalized_term": "טקסטיל",
            "category": "general_hebrew_lexicon",
            "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
            "risk_level": 0,
            "action": "ALLOW",
            "confidence": 0.45,
            "notes": "General Hebrew lexicon candidate",
        },
    ]

    export_all(tmp_path, external_rows=external_rows)

    def read_rows(name):
        with (tmp_path / name).open(encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))

    all_rows = read_rows("all_terms.csv")
    black_rows = read_rows("blacklist.csv")
    grey_rows = read_rows("greylist.csv")
    white_rows = read_rows("whitelist.csv")
    black_norms = {row["normalized_term"] for row in black_rows}
    white_norms = {row["normalized_term"] for row in white_rows}

    assert grey_rows == []
    assert black_norms.isdisjoint(white_norms)
    assert {row["normalized_term"] for row in all_rows} == black_norms | white_norms
    assert any(row["term"] == "ארטילריה" for row in black_rows)
    assert any(row["term"] == "אוגדה" for row in black_rows)
    assert any(row["term"] == "התחמשות" for row in black_rows)
    assert any(row["term"] == "שלום" for row in white_rows)
    assert any(row["term"] == "טקסטיל" for row in white_rows)

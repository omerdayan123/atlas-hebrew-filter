import argparse
import subprocess
from pathlib import Path

from scripts.export import export_all
from scripts.normalize import normalize_text


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "sources"
HEBREW_WORDLISTS_URL = "https://github.com/eyaler/hebrew_wordlists.git"


def clone_hebrew_wordlists(destination: Path = SOURCE_DIR / "hebrew_wordlists") -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return destination
    subprocess.run(["git", "clone", HEBREW_WORDLISTS_URL, str(destination)], check=True)
    return destination


def load_hspell_terms(source_dir: Path = SOURCE_DIR / "hebrew_wordlists") -> list[dict]:
    hspell = source_dir / "hspell_simple.txt"
    if not hspell.exists():
        return []
    rows = []
    for line in hspell.read_text(encoding="utf-8", errors="ignore").splitlines():
        term = line.strip()
        if term:
            rows.append(
                {
                    "term": term,
                    "normalized_term": normalize_text(term),
                    "category": "general_hebrew_lexicon",
                    "source": "eyaler/hebrew_wordlists:hspell_simple.txt",
                    "risk_level": 0,
                    "action": "ALLOW",
                    "confidence": 0.45,
                    "notes": "General Hebrew lexicon candidate; not security-classified without review",
                }
            )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest optional public Hebrew lexicon sources.")
    parser.add_argument("--clone", action="store_true", help="Clone hebrew_wordlists before loading.")
    parser.add_argument("--export-seed", action="store_true", help="Export Atlas seed datasets.")
    args = parser.parse_args()
    source_dir = SOURCE_DIR / "hebrew_wordlists"
    if args.clone:
        source_dir = clone_hebrew_wordlists()
    if args.export_seed:
        export_all(external_rows=load_hspell_terms(source_dir))


if __name__ == "__main__":
    main()

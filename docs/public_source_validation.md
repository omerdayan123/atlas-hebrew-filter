# Public Source Validation

Atlas enriches the Hebrew military terminology lists from public sources only. The goal is not to disclose or infer non-public structure, but to prevent users from entering public military and defense-establishment terminology into administrative free-text fields where it can create mosaic exposure.

## Sources Used

- IDF public site: public references to directorates, commands, branches, operational terminology, and command structure.
- Israel Ministry of Defense public site: public references to MoD departments such as MAFAT, procurement, emergency authority, and export-control bodies.
- MAFAT public site: public R&D terminology and official MAFAT expansion.
- Ministry of Defense export-control site: API / defense export-control terminology.
- Hebrew public acronym sources: public acronym forms for IDF ranks and directorates.

## Classification Policy

- `BLOCK`: official military ranks, command/directorate names, intelligence/operations/cyber terms, MoD defense bodies, command centers, operational phrases, and public acronyms that expose organizational or operational meaning.
- `MANUAL_REVIEW`: not used in the final approval export. `greylist.csv` is kept only as a compatibility artifact with headers and zero data rows.
- `ALLOW`: all terms not matched by curated blacklist rules or generated sensitive combinations, plus explicitly approved routine terms for welfare, medical, HR, religion, logistics, and basic administration.

## Guardrails

- Bare ambiguous numbers are not blindly blocked unless curated as well-known sensitive unit numbers or used in problematic combinations.
- Short sensitive anchors do not match inside unrelated words.
- Public-source additions keep a URL-like source marker in CSV `source` fields.
- Problematic combinations are generated from sensitive anchors such as office/base/project/unit/headquarters plus ranks, commands, intelligence, cyber, operations, regions, or public unit numbers.
- Prefix stripping is conservative: it removes Hebrew relation letters only when the remaining token is a known base term, avoiding false normalization such as `מבצע` -> `בצע`.
- Final export is binary: every normalized term is in exactly one of `blacklist.csv` or `whitelist.csv`; blacklist wins conflicts.
- Slim approval files are available as `blacklist_words.csv`, `whitelist_words.csv`, and `problematic_combinations_words.csv`.

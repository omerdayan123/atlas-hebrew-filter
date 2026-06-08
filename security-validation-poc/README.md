# Security Validation — POC

Proof-of-concept for the architecture we planned: **client-side real-time Hebrew
security validation** with the server as the **single source of truth**.

It reuses the atlas datasets (`../data/*.csv`) — nothing is committed or pushed.

## Architecture

```
Browser (real-time, 0 network)          Server (source of truth)
─────────────────────────────          ─────────────────────────
ValidationEngine (TS)        ◀── /api/security/sync (ETag) ── In-memory index
 • normalize (data-driven)                                      built from CSVs
 • blacklist + combinations   ── /api/security/suggest ──────▶  sorted prefix index
 • whitelist via BloomFilter   ── /api/security/validate ─────▶ authoritative re-check
```

- **Validation** runs entirely in the browser on every keystroke (no network).
- **Whitelist (129k terms)** ships as a ~227KB Bloom filter, not raw strings.
- **Suggestions** come from the server (prefix index over the full whitelist).
- **Submit** re-validates on the server (defense-in-depth).
- **Normalization** vocabulary is **data-driven** (derived from the lists), not
  hard-coded, and identical on both sides so Bloom lookups stay deterministic.

## Run

```powershell
cd security-validation-poc
npm install
npm run build:web   # bundles the browser engine -> public/engine.js
npm start           # serves UI + API on http://127.0.0.1:8100
```

Open <http://127.0.0.1:8100/> and type Hebrew (e.g. `מרפאה`, `לשכת אלוף`,
`בלשכת האלוף`). Use the **benchmark** button to measure validate latency.

While editing the browser engine, run `npm run dev:web` (esbuild watch).

## Self-test

With the server running:

```powershell
npx tsx scripts/selftest.ts
```

Checks correctness (client vs server agree), suggestions, client-side
performance, and the Bloom false-positive rate.

## Measured results (this machine)

| Input | Client validate |
|-------|-----------------|
| 1 word | ~0.09 ms |
| 10 words | ~0.34 ms |
| 50 words | ~1.4 ms |
| 100 words | ~2.5 ms |

Sync download ~11ms, engine build ~1ms, payload ~368KB (bloom 227KB),
Bloom false-positives 0/5000.

## Layout

```
src/core/    shared engine (normalize, bloom, validation) — runs in Node + browser
src/server/  Express server: CSV loader, /sync /suggest /validate
src/web/     browser entry (bundled to public/engine.js) — the future hook kernel
public/      demo UI (RTL Hebrew)
scripts/     selftest.ts
```

## Mapping to production

| POC piece | Production home |
|-----------|-----------------|
| `src/core/*` | shared logic in **Smartbase-Server-Packages** + bundled to client |
| `src/server/*` | dedicated **Security Validation Service** (NestJS + Postgres/Sequelize) |
| `src/web/browser-engine.ts` | `useSecurityValidation` hook + `<TextField securityValidation />` in **Smartbase-Client-Package** |
| CSV loader | Sequelize models + admin CRUD |

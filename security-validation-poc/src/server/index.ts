import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import express from 'express';

import { ValidationEngine } from '../core/validation-engine.js';
import { dataSignature, loadData, LoadedData, suggest } from './data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ATLAS_DATA_DIR = join(ROOT, '..', 'data');
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8100;

// ---- In-memory source of truth (rebuilt only when data changes) ----
let data: LoadedData = loadData(ATLAS_DATA_DIR);
let signature = dataSignature(ATLAS_DATA_DIR);
// Authoritative server-side engine (used for submit re-validation).
let serverEngine = new ValidationEngine(data.payload);

function refreshIfChanged(): void {
  const current = dataSignature(ATLAS_DATA_DIR);
  if (current !== signature) {
    data = loadData(ATLAS_DATA_DIR);
    signature = current;
    serverEngine = new ValidationEngine(data.payload);
    console.log(`[sync] data changed — rebuilt index, version=${data.payload.version}`);
  }
}

console.log(
  `[startup] blacklist=${data.stats.blacklist} whitelist=${data.stats.whitelist} ` +
    `combinations=${data.stats.combinations} bloom=${data.stats.bloomKB}KB ` +
    `payload=${data.stats.payloadKB}KB build=${data.stats.buildMs}ms version=${data.payload.version}`,
);

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---- API ----

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: data.payload.version, stats: data.stats });
});

// Full sync payload for the client engine (ETag-cached by version).
app.get('/api/security/sync', (req, res) => {
  refreshIfChanged();
  const etag = `"${data.payload.version}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');
  res.json(data.payload);
});

// Server-side prefix suggestions over the full whitelist (RAM, no DB).
app.get('/api/security/suggest', (req, res) => {
  const q = String(req.query.q ?? '');
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  const t0 = performance.now();
  // Suggestions match on normalized prefix; normalize the query the same way.
  const norm = serverEngine.normalize(q);
  const result = norm.length >= 2 ? suggest(data.suggestionIndex, norm, limit) : { suggestions: [], total: 0 };
  res.json({ ...result, tookMs: +(performance.now() - t0).toFixed(3) });
});

// Authoritative server-side validation (defense-in-depth for submit).
app.post('/api/security/validate', (req, res) => {
  const text = String(req.body?.text ?? '');
  const t0 = performance.now();
  const result = serverEngine.validate(text);
  res.json({ ...result, tookMs: +(performance.now() - t0).toFixed(3) });
});

// ---- Admin API (role-gated in production via TokenGuard + @Roles) ----

function forceRebuild(): void {
  data = loadData(ATLAS_DATA_DIR);
  signature = dataSignature(ATLAS_DATA_DIR);
  serverEngine = new ValidationEngine(data.payload);
  console.log(`[admin] rebuilt index, version=${data.payload.version}`);
}

// List terms (paginated).
app.get('/api/admin/lists/:type', (req, res) => {
  const { type } = req.params;
  if (!['blacklist', 'whitelist', 'combinations', 'safe_combinations'].includes(type)) {
    res.status(400).json({ error: 'type must be blacklist, whitelist, combinations, or safe_combinations' });
    return;
  }
  const q = String(req.query.q ?? '').toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(req.query.page_size) || 50), 500);

  let items: { term: string; normalized: string; category?: string; riskLevel?: number; notes?: string }[];
  if (type === 'blacklist') {
    items = data.payload.blacklist.map((t) => ({
      term: t.term, normalized: t.normalizedTerm, category: t.category, riskLevel: t.riskLevel, notes: t.notes,
    }));
  } else if (type === 'combinations') {
    items = data.payload.combinations.map((c) => ({
      term: c.phrase, normalized: c.normalizedPhrase, category: c.riskLabel, riskLevel: c.riskLevel, notes: c.notes,
    }));
  } else if (type === 'safe_combinations') {
    items = data.payload.safeCombinations.map((sc) => ({
      term: sc.phrase, normalized: sc.normalizedPhrase, notes: sc.notes,
    }));
  } else {
    // Whitelist — use the suggestion index (already sorted).
    items = data.suggestionIndex.map((s) => ({ term: s.term, normalized: s.normalized }));
  }

  if (q) items = items.filter((i) => i.term.includes(q) || i.normalized.includes(q));
  const total = items.length;
  const start = (page - 1) * pageSize;
  res.json({ items: items.slice(start, start + pageSize), total, page, pageSize });
});

// Add a term.
app.post('/api/admin/lists/:type', (req, res) => {
  const { type } = req.params;
  if (!['blacklist', 'whitelist', 'combinations', 'safe_combinations'].includes(type)) {
    res.status(400).json({ error: 'type must be blacklist, whitelist, combinations, or safe_combinations' });
    return;
  }
  const term = String(req.body?.term ?? '').trim();
  const category = String(req.body?.category ?? '');
  const notes = String(req.body?.notes ?? '');
  if (!term) { res.status(400).json({ error: 'term is required' }); return; }

  let csvFile: string;
  if (type === 'combinations') csvFile = 'problematic_combinations.csv';
  else if (type === 'safe_combinations') csvFile = 'safe_combinations.csv';
  else csvFile = `${type}.csv`;
  const filePath = join(ATLAS_DATA_DIR, csvFile);

  if (type === 'safe_combinations') {
    // Create file with header if it doesn't exist.
    try { readFileSync(filePath, 'utf-8'); } catch {
      writeFileSync(filePath, 'phrase,notes\n', 'utf-8');
    }
    const row = `\n"${term}","${notes}"`;
    appendFileSync(filePath, row, 'utf-8');
  } else if (type === 'combinations') {
    const norm = serverEngine.normalize(term);
    const row = `\n"${term}","${norm}","${category || 'admin_added'}","admin",High,95,BLOCK,0.9,"${notes}"`;
    appendFileSync(filePath, row, 'utf-8');
  } else {
    const norm = serverEngine.normalize(term);
    const action = type === 'blacklist' ? 'BLOCK' : 'ALLOW';
    const risk = type === 'blacklist' ? '90' : '8';
    const row = `\n"${term}","${norm}","${category || 'admin_added'}","admin",${risk},${action},0.9,"${notes}"`;
    appendFileSync(filePath, row, 'utf-8');
  }

  forceRebuild();
  res.json({ ok: true, message: `"${term}" added to ${type}`, version: data.payload.version });
});

// Delete a term.
app.delete('/api/admin/lists/:type', (req, res) => {
  const { type } = req.params;
  if (!['blacklist', 'whitelist', 'combinations', 'safe_combinations'].includes(type)) {
    res.status(400).json({ error: 'type must be blacklist, whitelist, combinations, or safe_combinations' });
    return;
  }
  const term = String(req.body?.term ?? '').trim();
  if (!term) { res.status(400).json({ error: 'term is required' }); return; }

  let csvFile: string;
  if (type === 'combinations') csvFile = 'problematic_combinations.csv';
  else if (type === 'safe_combinations') csvFile = 'safe_combinations.csv';
  else csvFile = `${type}.csv`;
  const filePath = join(ATLAS_DATA_DIR, csvFile);
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const header = lines[0];
  const filtered = lines.slice(1).filter((line) => {
    if (!line.trim()) return false;
    const first = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(',')[0];
    return first !== term;
  });
  writeFileSync(filePath, [header, ...filtered].join('\n'), 'utf-8');

  forceRebuild();
  res.json({ ok: true, message: `"${term}" removed from ${type}`, version: data.payload.version });
});

// ---- Static demo UI ----
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`\n  Security Validation POC running:`);
  console.log(`   Demo UI:   http://127.0.0.1:${PORT}/`);
  console.log(`   Sync API:  http://127.0.0.1:${PORT}/api/security/sync`);
  console.log(`   Health:    http://127.0.0.1:${PORT}/health\n`);
});

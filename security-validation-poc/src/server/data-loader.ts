import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BloomFilter } from '../core/bloom-filter.js';
import {
  buildNormalizationConfig,
  normalizeText,
  normalizeToken,
} from '../core/normalize.js';
import { BlacklistTerm, CombinationRule, SafeCombination, SyncPayload } from '../core/types.js';

// Construct-form (smichut) mapping. In production this would live in the DB
// alongside the lists; for the POC we seed it from the atlas POC.
const CONSTRUCT_FORMS: [string, string][] = [
  ['לשכת', 'לשכה'],
  ['יחידת', 'יחידה'],
  ['חטיבת', 'חטיבה'],
  ['מחלקת', 'מחלקה'],
  ['מפקדת', 'מפקדה'],
];

// Minimal RFC-4180-ish CSV parser (handles quoted fields and escaped quotes).
function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.length))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => (obj[h] = r[idx] ?? ''));
      return obj;
    });
}

export interface LoadedData {
  payload: SyncPayload;
  // Sorted normalized whitelist terms (with originals) for prefix suggestions.
  suggestionIndex: { normalized: string; term: string }[];
  stats: {
    blacklist: number;
    whitelist: number;
    combinations: number;
    bloomKB: number;
    payloadKB: number;
    buildMs: number;
  };
}

export function loadData(dataDir: string): LoadedData {
  const t0 = performance.now();

  const blacklistRows = parseCsv(readFileSync(join(dataDir, 'blacklist.csv'), 'utf-8'));
  const comboRows = parseCsv(
    readFileSync(join(dataDir, 'problematic_combinations.csv'), 'utf-8'),
  );
  const whitelistRows = parseCsv(readFileSync(join(dataDir, 'whitelist.csv'), 'utf-8'));

  const blacklist: BlacklistTerm[] = blacklistRows.map((r) => ({
    term: r.term,
    normalizedTerm: r.normalized_term,
    category: r.category ?? '',
    riskLevel: Number(r.risk_level) || 50,
    action: 'BLOCK',
    notes: r.notes,
  }));

  const combinations: CombinationRule[] = comboRows.map((r) => ({
    phrase: r.combination,
    normalizedPhrase: r.normalized_combination,
    riskLabel: r.risk ?? 'High',
    riskLevel: Number(r.risk_level) || 90,
    notes: r.notes,
  }));

  // Safe combinations — override individual blocks when words appear together.
  let safeCombinationRows: Record<string, string>[] = [];
  try {
    safeCombinationRows = parseCsv(readFileSync(join(dataDir, 'safe_combinations.csv'), 'utf-8'));
  } catch {
    // File doesn't exist yet — that's fine, start empty.
  }

  // Build a BOUNDED prefix vocabulary used identically on server + client so
  // normalization is deterministic. Derived purely from the data (generic).
  const prefixVocabulary = new Set<string>();
  for (const t of blacklist) {
    for (const w of t.normalizedTerm.split(' ')) if (w) prefixVocabulary.add(w);
  }
  for (const c of combinations) {
    for (const w of c.normalizedPhrase.split(' ')) if (w) prefixVocabulary.add(w);
  }

  const cfg = buildNormalizationConfig(CONSTRUCT_FORMS, [...prefixVocabulary]);

  // Build the whitelist bloom filter using the SAME normalization as the client.
  const normalizedWhitelist = new Set<string>();
  const suggestionIndex: { normalized: string; term: string }[] = [];
  for (const r of whitelistRows) {
    const norm = r.normalized_term
      ? normalizeText(r.normalized_term, cfg)
      : normalizeToken(r.term, cfg);
    if (!norm) continue;
    if (!normalizedWhitelist.has(norm)) {
      normalizedWhitelist.add(norm);
      suggestionIndex.push({ normalized: norm, term: r.term });
    }
  }

  const { size, hashes } = BloomFilter.optimal(normalizedWhitelist.size, 0.001);
  const bloom = new BloomFilter(size, hashes);
  for (const term of normalizedWhitelist) bloom.add(term);

  suggestionIndex.sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0));

  const bitsBase64 = bloom.toBase64();

  const safeCombinations: SafeCombination[] = safeCombinationRows.map((r) => ({
    phrase: r.phrase,
    normalizedPhrase: normalizeText(r.phrase, cfg),
    notes: r.notes,
  }));

  const version = createHash('sha1')
    .update(bitsBase64.slice(0, 200) + `:${blacklist.length}:${combinations.length}:${safeCombinations.length}:${normalizedWhitelist.size}`)
    .digest('hex')
    .slice(0, 12);

  const payload: SyncPayload = {
    version,
    updatedAt: new Date().toISOString(),
    blacklist,
    combinations,
    safeCombinations,
    constructForms: CONSTRUCT_FORMS,
    prefixVocabulary: [...prefixVocabulary],
    whitelist: { bits: bitsBase64, size, hashes, count: normalizedWhitelist.size },
  };

  const payloadKB = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024);
  const buildMs = Math.round(performance.now() - t0);

  return {
    payload,
    suggestionIndex,
    stats: {
      blacklist: blacklist.length,
      whitelist: normalizedWhitelist.size,
      combinations: combinations.length,
      bloomKB: Math.round((size / 8) / 1024),
      payloadKB,
      buildMs,
    },
  };
}

// Binary-search lower bound for a prefix over the sorted suggestion index.
export function suggest(
  index: { normalized: string; term: string }[],
  prefix: string,
  limit: number,
): { suggestions: string[]; total: number } {
  if (!prefix) return { suggestions: [], total: 0 };
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].normalized < prefix) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (let i = lo; i < index.length; i++) {
    if (!index[i].normalized.startsWith(prefix)) break;
    total++;
    if (out.length < limit && !seen.has(index[i].term)) {
      seen.add(index[i].term);
      out.push(index[i].term);
    }
  }
  return { suggestions: out, total };
}

export function dataSignature(dataDir: string): string {
  // Cheap change detector based on file mtimes/sizes.
  return ['blacklist.csv', 'problematic_combinations.csv', 'whitelist.csv']
    .map((f) => {
      try {
        const s = statSync(join(dataDir, f));
        return `${s.size}:${s.mtimeMs}`;
      } catch {
        return 'missing';
      }
    })
    .join('|');
}

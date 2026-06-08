// Browser entry — bundled by esbuild into public/engine.js (global SecurityValidation).
// This is the kernel of what would become the `useSecurityValidation` hook +
// `<TextField securityValidation />` wrapper in the client package.

import { SyncPayload, ValidationResult } from '../core/types.js';
import { ValidationEngine } from '../core/validation-engine.js';

const SYNC_URL = '/api/security/sync';
const SUGGEST_URL = '/api/security/suggest';
const SYNC_CACHE_KEY = 'security-sync-payload';

export interface SyncInfo {
  version: string;
  fromCache: boolean;
  syncMs: number;
  buildMs: number;
  payloadKB: number;
  stats: { blacklist: number; whitelist: number; combinations: number };
}

let engine: ValidationEngine | null = null;

// ---- Sync: download payload (ETag-cached) and build the local engine ----
export async function init(): Promise<SyncInfo> {
  const cachedRaw = localStorage.getItem(SYNC_CACHE_KEY);
  const cached: { etag: string; payload: SyncPayload } | null = cachedRaw
    ? JSON.parse(cachedRaw)
    : null;

  const t0 = performance.now();
  const res = await fetch(SYNC_URL, {
    headers: cached ? { 'If-None-Match': `"${cached.etag}"` } : {},
  });
  const syncMs = +(performance.now() - t0).toFixed(1);

  let payload: SyncPayload;
  let fromCache = false;
  if (res.status === 304 && cached) {
    payload = cached.payload;
    fromCache = true;
  } else {
    payload = (await res.json()) as SyncPayload;
    localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify({ etag: payload.version, payload }));
  }

  const tb = performance.now();
  engine = new ValidationEngine(payload);
  const buildMs = +(performance.now() - tb).toFixed(1);

  return {
    version: payload.version,
    fromCache,
    syncMs,
    buildMs,
    payloadKB: Math.round((cachedRaw && fromCache ? cachedRaw.length : JSON.stringify(payload).length) / 1024),
    stats: {
      blacklist: payload.blacklist.length,
      whitelist: payload.whitelist.count,
      combinations: payload.combinations.length,
    },
  };
}

// ---- Real-time validation (synchronous, zero network) ----
export function validate(text: string): ValidationResult & { tookMs: number } {
  if (!engine) throw new Error('Engine not initialized — call init() first');
  const t0 = performance.now();
  const result = engine.validate(text);
  return { ...result, tookMs: +(performance.now() - t0).toFixed(3) };
}

// ---- Suggestions (debounced + abortable + cached) ----
const suggestCache = new Map<string, string[]>();
let abortController: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function lastToken(text: string): string {
  // If text ends with whitespace the user hasn't started a new word yet → empty.
  if (!text || /\s$/.test(text)) return '';
  const parts = text.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

export function suggest(
  text: string,
  onResult: (suggestions: string[], info: { fromCache: boolean; tookMs: number }) => void,
  debounceMs = 300,
): void {
  const token = lastToken(text);
  if (token.length < 2) {
    onResult([], { fromCache: true, tookMs: 0 });
    return;
  }
  const cached = suggestCache.get(token);
  if (cached) {
    onResult(cached, { fromCache: true, tookMs: 0 });
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    abortController?.abort();
    abortController = new AbortController();
    const t0 = performance.now();
    try {
      const res = await fetch(`${SUGGEST_URL}?q=${encodeURIComponent(token)}&limit=5`, {
        signal: abortController.signal,
      });
      const data = await res.json();
      suggestCache.set(token, data.suggestions);
      onResult(data.suggestions, { fromCache: false, tookMs: +(performance.now() - t0).toFixed(1) });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e);
    }
  }, debounceMs);
}

// ---- Server re-validation (defense-in-depth, on submit) ----
export async function validateOnServer(text: string): Promise<ValidationResult & { tookMs: number }> {
  const res = await fetch('/api/security/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res.json();
}

// ---- Debounced server verification (corrects Bloom false-positives) ----
let verifyTimer: ReturnType<typeof setTimeout> | null = null;
let verifyAbort: AbortController | null = null;

/**
 * Call after every local validate(). Debounces a server round-trip.
 * When the server responds, calls onCorrected ONLY if the result differs
 * from the Bloom-based local result (i.e., a false-positive was detected).
 */
export function verifyWithServer(
  text: string,
  localResult: ValidationResult,
  onCorrected: (serverResult: ValidationResult) => void,
  debounceMs = 400,
): void {
  if (!text.trim()) return;
  if (verifyTimer) clearTimeout(verifyTimer);
  verifyTimer = setTimeout(async () => {
    verifyAbort?.abort();
    verifyAbort = new AbortController();
    try {
      const res = await fetch('/api/security/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: verifyAbort.signal,
      });
      const serverResult: ValidationResult = await res.json();
      // Compare token statuses — if any differ, push correction
      const differs = serverResult.tokens.some((st, i) => {
        const lt = localResult.tokens[i];
        return !lt || st.status !== lt.status;
      }) || serverResult.action !== localResult.action;
      if (differs) onCorrected(serverResult);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error('[verify]', e);
    }
  }, debounceMs);
}

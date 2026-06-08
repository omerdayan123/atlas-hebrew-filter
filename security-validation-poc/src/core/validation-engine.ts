import { BloomFilter } from './bloom-filter.js';
import {
  buildNormalizationConfig,
  NormalizationConfig,
  normalizeText,
  normalizeToken,
  tokenize,
} from './normalize.js';
import {
  BlacklistTerm,
  CombinationRule,
  SafeCombination,
  SyncPayload,
  TokenResult,
  TokenStatus,
  ValidationResult,
} from './types.js';

const FUZZY_THRESHOLD = 0.86;
const COMBO_TOKEN_THRESHOLD = 0.82;
const COMBO_WINDOW = 4;

// Levenshtein-ratio similarity (good-enough stand-in for Python's
// SequenceMatcher.ratio for the POC). Returns 1.0 for an exact match.
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const dist = prev[lb];
  return 1 - dist / Math.max(la, lb);
}

export class ValidationEngine {
  readonly version: string;
  private readonly cfg: NormalizationConfig;
  private readonly whitelist: BloomFilter;

  // Single-token risk terms, indexed by length for fast fuzzy pre-filtering.
  private readonly singleByLength = new Map<number, BlacklistTerm[]>();
  private readonly singleExact = new Map<string, BlacklistTerm>();
  // Multi-token risk phrases (substring matched against normalized text).
  private readonly multiPhrases: BlacklistTerm[] = [];

  private readonly combinations: CombinationRule[];
  private readonly comboVocabulary: Set<string>;
  private readonly safeCombinations: SafeCombination[];

  // Incremental per-token classification cache (keyed by normalized token).
  private readonly tokenCache = new Map<string, TokenStatus>();

  constructor(payload: SyncPayload) {
    this.version = payload.version;
    this.cfg = buildNormalizationConfig(payload.constructForms, payload.prefixVocabulary);
    this.whitelist = BloomFilter.fromBase64(
      payload.whitelist.bits,
      payload.whitelist.size,
      payload.whitelist.hashes,
    );

    for (const term of payload.blacklist) {
      const tokenCount = term.normalizedTerm.split(' ').filter(Boolean).length;
      if (tokenCount <= 1) {
        this.singleExact.set(term.normalizedTerm, term);
        const len = term.normalizedTerm.length;
        const bucket = this.singleByLength.get(len) ?? [];
        bucket.push(term);
        this.singleByLength.set(len, bucket);
      } else {
        this.multiPhrases.push(term);
      }
    }

    this.combinations = payload.combinations;
    this.comboVocabulary = new Set();
    for (const rule of this.combinations) {
      for (const tok of rule.normalizedPhrase.split(' ')) {
        if (tok) this.comboVocabulary.add(tok);
      }
    }
    this.safeCombinations = payload.safeCombinations ?? [];
  }

  normalize(text: string): string {
    return normalizeText(text, this.cfg);
  }

  // Match a single normalized token against the risk blacklist, using a
  // length-bucket pre-filter so fuzzy comparisons stay tiny (~±1 length).
  private matchRiskToken(token: string): BlacklistTerm | null {
    const exact = this.singleExact.get(token);
    if (exact) return exact;
    if (token.length < 5) return null; // fuzzy only for longer tokens
    for (let len = token.length - 1; len <= token.length + 1; len++) {
      const bucket = this.singleByLength.get(len);
      if (!bucket) continue;
      for (const term of bucket) {
        if (similarity(token, term.normalizedTerm) >= FUZZY_THRESHOLD) return term;
      }
    }
    return null;
  }

  private classifyToken(token: string): TokenStatus {
    const cached = this.tokenCache.get(token);
    if (cached) return cached;
    let status: TokenStatus;
    if (this.matchRiskToken(token)) status = 'BLOCK';
    else if (this.tryPrefixStrippedBlacklist(token)) status = 'BLOCK';
    else if (this.whitelist.has(token)) status = 'ALLOW';
    else if (this.tryPrefixStrippedWhitelist(token)) status = 'ALLOW';
    else status = 'UNKNOWN';
    this.tokenCache.set(token, status);
    return status;
  }

  // Try progressively stripping Hebrew prefixes and check each stripped form
  // against the blacklist. Handles "ובמודיעין" → "מודיעין" even with double prefixes.
  private static readonly PREFIXES = new Set(['ב', 'ל', 'מ', 'ה', 'ו', 'כ', 'ש']);
  private tryPrefixStrippedBlacklist(token: string): boolean {
    let t = token;
    while (t.length > 2 && ValidationEngine.PREFIXES.has(t[0])) {
      t = t.slice(1);
      if (this.matchRiskToken(t)) return true;
    }
    return false;
  }

  // Try progressively stripping Hebrew prefixes and check each stripped form
  // against the Bloom whitelist. Handles "ואהוב" → "אהוב" without needing
  // all 129k whitelist words in the prefix vocabulary (which would bloat the payload).
  private tryPrefixStrippedWhitelist(token: string): boolean {
    let t = token;
    while (t.length > 2 && ValidationEngine.PREFIXES.has(t[0])) {
      t = t.slice(1);
      if (this.whitelist.has(t)) return true;
    }
    return false;
  }

  private comboTokenMatches(candidate: string, target: string): boolean {
    return candidate === target || similarity(candidate, target) >= COMBO_TOKEN_THRESHOLD;
  }

  private detectCombinations(normalized: string, tokens: string[]): CombinationRule[] {
    // Fast path: skip entirely unless 2+ tokens are in the combination vocabulary.
    const relevant = tokens.filter((t) => this.comboVocabulary.has(t));
    const matches: CombinationRule[] = [];
    for (const rule of this.combinations) {
      const phraseTokens = rule.normalizedPhrase.split(' ').filter(Boolean);
      if (!phraseTokens.length) continue;
      if (normalized.includes(rule.normalizedPhrase)) {
        matches.push(rule);
        continue;
      }
      if (phraseTokens.length === 1 || relevant.length < 2) continue;

      const starts: number[] = [];
      for (let i = 0; i < tokens.length; i++) {
        if (this.comboTokenMatches(tokens[i], phraseTokens[0])) starts.push(i);
      }
      for (const start of starts) {
        let cursor = start + 1;
        let found = true;
        for (let t = 1; t < phraseTokens.length; t++) {
          const end = Math.min(tokens.length, cursor + COMBO_WINDOW);
          let next = -1;
          for (let i = cursor; i < end; i++) {
            if (this.comboTokenMatches(tokens[i], phraseTokens[t])) {
              next = i;
              break;
            }
          }
          if (next === -1) {
            found = false;
            break;
          }
          cursor = next + 1;
        }
        if (found) {
          matches.push(rule);
          break;
        }
      }
    }
    return matches;
  }

  // Find indices of tokens that participate in a matched combination phrase.
  private findComboTokenIndices(tokens: string[], rule: CombinationRule): number[] {
    const phraseTokens = rule.normalizedPhrase.split(' ').filter(Boolean);
    if (!phraseTokens.length) return [];
    for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
      const indices: number[] = [];
      let cursor = i;
      let found = true;
      for (const pt of phraseTokens) {
        const end = Math.min(tokens.length, cursor + COMBO_WINDOW);
        let next = -1;
        for (let j = cursor; j < end; j++) {
          if (this.comboTokenMatches(tokens[j], pt)) { next = j; break; }
        }
        if (next === -1) { found = false; break; }
        indices.push(next);
        cursor = next + 1;
      }
      if (found) return indices;
    }
    return [];
  }

  // Detect safe combinations — returns a set of token indices that are safe.
  // Rule: combo tokens must be adjacent (exact consecutive match).
  // Words before or after the combo are fine.
  private detectSafeCombinations(tokens: string[]): Set<number> {
    const safeIndices = new Set<number>();
    for (const sc of this.safeCombinations) {
      const phraseTokens = sc.normalizedPhrase.split(' ').filter(Boolean);
      if (phraseTokens.length < 2) continue;
      for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
        let match = true;
        for (let j = 0; j < phraseTokens.length; j++) {
          if (tokens[i + j] !== phraseTokens[j]) { match = false; break; }
        }
        if (match) {
          for (let j = 0; j < phraseTokens.length; j++) safeIndices.add(i + j);
        }
      }
    }
    return safeIndices;
  }

  validate(text: string): ValidationResult {
    const normalizedText = normalizeText(text, this.cfg);
    const rawTokens = text.split(/\s+/).filter(Boolean);

    const tokens: TokenResult[] = [];
    const tokenStrings: string[] = [];
    const matchedTerms = new Set<string>();
    let maxRisk = 0;

    for (const raw of rawTokens) {
      const normalized = normalizeToken(raw, this.cfg);
      if (!normalized) {
        tokens.push({ raw, normalized: '', status: 'UNKNOWN' });
        continue;
      }
      tokenStrings.push(normalized);
      const risk = this.matchRiskToken(normalized);
      let status: TokenStatus;
      if (risk) {
        status = 'BLOCK';
        matchedTerms.add(risk.term);
        maxRisk = Math.max(maxRisk, risk.riskLevel);
      } else {
        status = this.classifyToken(normalized);
      }
      tokens.push({ raw, normalized, status });
    }

    // Multi-token risk phrases (substring against the normalized text).
    for (const phrase of this.multiPhrases) {
      if (normalizedText.includes(phrase.normalizedTerm)) {
        matchedTerms.add(phrase.term);
        maxRisk = Math.max(maxRisk, phrase.riskLevel);
        // Mark individual tokens that form this phrase as BLOCK.
        const pw = phrase.normalizedTerm.split(' ').filter(Boolean);
        for (let i = 0; i <= tokenStrings.length - pw.length; i++) {
          let match = true;
          for (let j = 0; j < pw.length; j++) {
            if (tokenStrings[i + j] !== pw[j]) { match = false; break; }
          }
          if (match) {
            for (let j = 0; j < pw.length; j++) tokens[i + j].status = 'BLOCK';
          }
        }
      }
    }

    const combos = this.detectCombinations(normalizedText, tokenStrings);
    const matchedCombinations = [...new Set(combos.map((c) => c.phrase))];
    for (const c of combos) maxRisk = Math.max(maxRisk, c.riskLevel);

    // Mark individual tokens that participate in a problematic combination as BLOCK.
    for (const combo of combos) {
      const indices = this.findComboTokenIndices(tokenStrings, combo);
      for (const idx of indices) {
        if (tokens[idx]) tokens[idx].status = 'BLOCK';
      }
    }

    // Safe combinations: override BLOCK→ALLOW for tokens that appear in a safe phrase.
    const safeIndices = this.detectSafeCombinations(tokenStrings);
    for (const idx of safeIndices) {
      if (tokens[idx] && tokens[idx].status === 'BLOCK') {
        tokens[idx].status = 'ALLOW';
        // Remove the term from matchedTerms since it's safe in context
        matchedTerms.delete(tokens[idx].raw);
      }
    }

    const hasRisk = tokens.some(t => t.status === 'BLOCK');
    const reasons: string[] = [];
    if (matchedTerms.size > 0) reasons.push('Matched sensitive terminology');
    if (combos.length > 0 && hasRisk) reasons.push('Matched problematic term combination');
    if (!reasons.length) reasons.push('No sensitive terminology detected');

    return {
      action: hasRisk ? 'BLOCK' : 'ALLOW',
      riskScore: maxRisk,
      normalizedText,
      matchedTerms: [...matchedTerms].sort(),
      matchedCombinations,
      tokens,
      reason: reasons.join('; '),
    };
  }
}

export { tokenize };

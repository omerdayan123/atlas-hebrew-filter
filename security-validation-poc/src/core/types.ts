// Shared types between server (source of truth) and client (real-time engine).

export type ValidationAction = "BLOCK" | "ALLOW";
export type TokenStatus = "BLOCK" | "ALLOW" | "UNKNOWN";

export interface BlacklistTerm {
  term: string;
  normalizedTerm: string;
  category: string;
  riskLevel: number;
  action: ValidationAction; // always BLOCK in practice
  notes?: string;
}

export interface CombinationRule {
  phrase: string;
  normalizedPhrase: string;
  riskLabel: string;
  riskLevel: number;
  notes?: string;
}

export interface SafeCombination {
  phrase: string;
  normalizedPhrase: string;
  notes?: string;
}

// The payload the client downloads on app-load (cached by version/ETag).
export interface SyncPayload {
  version: string;
  updatedAt: string;
  // Risk terms — small list, fuzzy-matched on the client.
  blacklist: BlacklistTerm[];
  // Problematic word combinations.
  combinations: CombinationRule[];
  // Safe combinations — override individual BLOCK when these words appear together.
  safeCombinations: SafeCombination[];
  // Construct-form (smichut) mapping, e.g. "לשכת" -> "לשכה".
  constructForms: [string, string][];
  // Bounded vocabulary used for deterministic prefix-stripping on BOTH sides.
  prefixVocabulary: string[];
  // Bloom filter over the ~129k normalized whitelist terms.
  whitelist: {
    bits: string; // base64-encoded bit array
    size: number; // number of bits (m)
    hashes: number; // number of hash functions (k)
    count: number; // number of inserted terms (n)
  };
}

export interface TokenResult {
  raw: string;
  normalized: string;
  status: TokenStatus;
}

export interface ValidationResult {
  action: ValidationAction;
  riskScore: number;
  normalizedText: string;
  matchedTerms: string[];
  matchedCombinations: string[];
  tokens: TokenResult[];
  reason: string;
}

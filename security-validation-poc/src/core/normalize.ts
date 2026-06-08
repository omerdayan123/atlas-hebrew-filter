// Generic Hebrew normalization — a faithful TypeScript port of scripts/normalize.py,
// rewritten so that the prefix-stripping vocabulary is DATA-DRIVEN (passed in),
// not hard-coded. Server and client construct this with the SAME vocabulary so
// that normalization (and therefore bloom lookups) are deterministic on both sides.

const HEBREW_PREFIXES = new Set(['ב', 'ל', 'מ', 'ה', 'ו', 'כ', 'ש']);

// Hebrew niqqud / cantillation marks + general combining marks.
const NIQQUD_RE = /[\u0591-\u05C7]/g;
const QUOTE_RE = /['"״׳`´\u201C\u201D\u2018\u2019]/g;
const SEPARATOR_RE = /[-־–—_/]+/g;
const KEEP_RE = /[^\u0590-\u05FF0-9a-zA-Z\s]+/g;
const TOKEN_KEEP_RE = /[^\u0590-\u05FF0-9a-zA-Z]+/g;

export interface NormalizationConfig {
  constructForms: Map<string, string>;
  knownBases: Set<string>;
}

export function buildNormalizationConfig(
  constructForms: [string, string][],
  prefixVocabulary: string[],
): NormalizationConfig {
  const cf = new Map(constructForms);
  const bases = new Set(prefixVocabulary);
  // Construct-form targets are themselves valid bases.
  for (const target of cf.values()) bases.add(target);
  return { constructForms: cf, knownBases: bases };
}

export function stripNiqqud(text: string): string {
  return text.normalize('NFD').replace(NIQQUD_RE, '');
}

export function normalizeToken(token: string, cfg: NormalizationConfig): string {
  token = stripNiqqud(token).trim().toLowerCase();
  token = token.replace(QUOTE_RE, '');
  token = token.replace(TOKEN_KEEP_RE, '');
  if (!token) return '';

  if (cfg.constructForms.has(token)) return cfg.constructForms.get(token)!;

  // Conservative, generic prefix stripping: only strip when the remaining
  // candidate is a KNOWN base (from the data), preventing over-stripping.
  while (token.length > 3 && HEBREW_PREFIXES.has(token[0])) {
    const candidate = token.slice(1);
    if (!cfg.knownBases.has(candidate) && !cfg.constructForms.has(candidate)) break;
    token = candidate;
    if (cfg.constructForms.has(token)) return cfg.constructForms.get(token)!;
  }
  return token;
}

export function normalizeText(text: string, cfg: NormalizationConfig): string {
  text = stripNiqqud(text);
  text = text.replace(QUOTE_RE, '');
  text = text.replace(SEPARATOR_RE, ' ');
  text = text.replace(KEEP_RE, ' ');
  const tokens = text
    .split(/\s+/)
    .map((part) => normalizeToken(part, cfg))
    .filter(Boolean);
  return tokens.join(' ');
}

export function tokenize(text: string, cfg: NormalizationConfig): string[] {
  const normalized = normalizeText(text, cfg);
  return normalized ? normalized.split(' ') : [];
}

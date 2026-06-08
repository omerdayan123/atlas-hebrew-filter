"use strict";
var SecurityValidation = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/web/browser-engine.ts
  var browser_engine_exports = {};
  __export(browser_engine_exports, {
    init: () => init,
    lastToken: () => lastToken,
    suggest: () => suggest,
    validate: () => validate,
    validateOnServer: () => validateOnServer,
    verifyWithServer: () => verifyWithServer
  });

  // src/core/bloom-filter.ts
  function murmur3(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      let k = str.charCodeAt(i);
      k = Math.imul(k, 3432918353);
      k = k << 15 | k >>> 17;
      k = Math.imul(k, 461845907);
      h ^= k;
      h = h << 13 | h >>> 19;
      h = Math.imul(h, 5) + 3864292196;
    }
    h ^= str.length;
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  }
  var BloomFilter = class _BloomFilter {
    constructor(size, hashes, bits) {
      this.size = size;
      this.hashes = hashes;
      this.bits = bits ?? new Uint8Array(Math.ceil(size / 8));
    }
    // Optimal parameters for n items at target false-positive rate p.
    static optimal(n, p = 1e-3) {
      const size = Math.ceil(-n * Math.log(p) / (Math.LN2 * Math.LN2));
      const hashes = Math.max(1, Math.round(size / n * Math.LN2));
      return { size, hashes };
    }
    *indexes(item) {
      const h1 = murmur3(item, 0);
      const h2 = murmur3(item, 2538058380) | 1;
      for (let i = 0; i < this.hashes; i++) {
        yield (h1 + Math.imul(i, h2) >>> 0) % this.size;
      }
    }
    add(item) {
      for (const idx of this.indexes(item)) {
        this.bits[idx >>> 3] |= 1 << (idx & 7);
      }
    }
    has(item) {
      for (const idx of this.indexes(item)) {
        if ((this.bits[idx >>> 3] & 1 << (idx & 7)) === 0) return false;
      }
      return true;
    }
    toBase64() {
      if (typeof Buffer !== "undefined") {
        return Buffer.from(this.bits).toString("base64");
      }
      let binary = "";
      for (let i = 0; i < this.bits.length; i++) binary += String.fromCharCode(this.bits[i]);
      return btoa(binary);
    }
    static fromBase64(base64, size, hashes) {
      let bytes;
      if (typeof Buffer !== "undefined") {
        bytes = new Uint8Array(Buffer.from(base64, "base64"));
      } else {
        const binary = atob(base64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      }
      return new _BloomFilter(size, hashes, bytes);
    }
  };

  // src/core/normalize.ts
  var HEBREW_PREFIXES = /* @__PURE__ */ new Set(["\u05D1", "\u05DC", "\u05DE", "\u05D4", "\u05D5", "\u05DB", "\u05E9"]);
  var NIQQUD_RE = /[\u0591-\u05C7]/g;
  var QUOTE_RE = /['"״׳`´\u201C\u201D\u2018\u2019]/g;
  var SEPARATOR_RE = /[-־–—_/]+/g;
  var KEEP_RE = /[^\u0590-\u05FF0-9a-zA-Z\s]+/g;
  var TOKEN_KEEP_RE = /[^\u0590-\u05FF0-9a-zA-Z]+/g;
  function buildNormalizationConfig(constructForms, prefixVocabulary) {
    const cf = new Map(constructForms);
    const bases = new Set(prefixVocabulary);
    for (const target of cf.values()) bases.add(target);
    return { constructForms: cf, knownBases: bases };
  }
  function stripNiqqud(text) {
    return text.normalize("NFD").replace(NIQQUD_RE, "");
  }
  function normalizeToken(token, cfg) {
    token = stripNiqqud(token).trim().toLowerCase();
    token = token.replace(QUOTE_RE, "");
    token = token.replace(TOKEN_KEEP_RE, "");
    if (!token) return "";
    if (cfg.constructForms.has(token)) return cfg.constructForms.get(token);
    while (token.length > 3 && HEBREW_PREFIXES.has(token[0])) {
      const candidate = token.slice(1);
      if (!cfg.knownBases.has(candidate) && !cfg.constructForms.has(candidate)) break;
      token = candidate;
      if (cfg.constructForms.has(token)) return cfg.constructForms.get(token);
    }
    return token;
  }
  function normalizeText(text, cfg) {
    text = stripNiqqud(text);
    text = text.replace(QUOTE_RE, "");
    text = text.replace(SEPARATOR_RE, " ");
    text = text.replace(KEEP_RE, " ");
    const tokens = text.split(/\s+/).map((part) => normalizeToken(part, cfg)).filter(Boolean);
    return tokens.join(" ");
  }

  // src/core/validation-engine.ts
  var FUZZY_THRESHOLD = 0.86;
  var COMBO_TOKEN_THRESHOLD = 0.82;
  var COMBO_WINDOW = 4;
  function similarity(a, b) {
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
  var _ValidationEngine = class _ValidationEngine {
    constructor(payload) {
      // Single-token risk terms, indexed by length for fast fuzzy pre-filtering.
      this.singleByLength = /* @__PURE__ */ new Map();
      this.singleExact = /* @__PURE__ */ new Map();
      // Multi-token risk phrases (substring matched against normalized text).
      this.multiPhrases = [];
      // Incremental per-token classification cache (keyed by normalized token).
      this.tokenCache = /* @__PURE__ */ new Map();
      this.version = payload.version;
      this.cfg = buildNormalizationConfig(payload.constructForms, payload.prefixVocabulary);
      this.whitelist = BloomFilter.fromBase64(
        payload.whitelist.bits,
        payload.whitelist.size,
        payload.whitelist.hashes
      );
      for (const term of payload.blacklist) {
        const tokenCount = term.normalizedTerm.split(" ").filter(Boolean).length;
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
      this.comboVocabulary = /* @__PURE__ */ new Set();
      for (const rule of this.combinations) {
        for (const tok of rule.normalizedPhrase.split(" ")) {
          if (tok) this.comboVocabulary.add(tok);
        }
      }
      this.safeCombinations = payload.safeCombinations ?? [];
    }
    normalize(text) {
      return normalizeText(text, this.cfg);
    }
    // Match a single normalized token against the risk blacklist, using a
    // length-bucket pre-filter so fuzzy comparisons stay tiny (~±1 length).
    matchRiskToken(token) {
      const exact = this.singleExact.get(token);
      if (exact) return exact;
      if (token.length < 5) return null;
      for (let len = token.length - 1; len <= token.length + 1; len++) {
        const bucket = this.singleByLength.get(len);
        if (!bucket) continue;
        for (const term of bucket) {
          if (similarity(token, term.normalizedTerm) >= FUZZY_THRESHOLD) return term;
        }
      }
      return null;
    }
    classifyToken(token) {
      const cached = this.tokenCache.get(token);
      if (cached) return cached;
      let status;
      if (this.matchRiskToken(token)) status = "BLOCK";
      else if (this.tryPrefixStrippedBlacklist(token)) status = "BLOCK";
      else if (this.whitelist.has(token)) status = "ALLOW";
      else if (this.tryPrefixStrippedWhitelist(token)) status = "ALLOW";
      else status = "UNKNOWN";
      this.tokenCache.set(token, status);
      return status;
    }
    tryPrefixStrippedBlacklist(token) {
      let t = token;
      while (t.length > 2 && _ValidationEngine.PREFIXES.has(t[0])) {
        t = t.slice(1);
        if (this.matchRiskToken(t)) return true;
      }
      return false;
    }
    // Try progressively stripping Hebrew prefixes and check each stripped form
    // against the Bloom whitelist. Handles "ואהוב" → "אהוב" without needing
    // all 129k whitelist words in the prefix vocabulary (which would bloat the payload).
    tryPrefixStrippedWhitelist(token) {
      let t = token;
      while (t.length > 2 && _ValidationEngine.PREFIXES.has(t[0])) {
        t = t.slice(1);
        if (this.whitelist.has(t)) return true;
      }
      return false;
    }
    comboTokenMatches(candidate, target) {
      return candidate === target || similarity(candidate, target) >= COMBO_TOKEN_THRESHOLD;
    }
    detectCombinations(normalized, tokens) {
      const relevant = tokens.filter((t) => this.comboVocabulary.has(t));
      const matches = [];
      for (const rule of this.combinations) {
        const phraseTokens = rule.normalizedPhrase.split(" ").filter(Boolean);
        if (!phraseTokens.length) continue;
        if (normalized.includes(rule.normalizedPhrase)) {
          matches.push(rule);
          continue;
        }
        if (phraseTokens.length === 1 || relevant.length < 2) continue;
        const starts = [];
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
    findComboTokenIndices(tokens, rule) {
      const phraseTokens = rule.normalizedPhrase.split(" ").filter(Boolean);
      if (!phraseTokens.length) return [];
      for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
        const indices = [];
        let cursor = i;
        let found = true;
        for (const pt of phraseTokens) {
          const end = Math.min(tokens.length, cursor + COMBO_WINDOW);
          let next = -1;
          for (let j = cursor; j < end; j++) {
            if (this.comboTokenMatches(tokens[j], pt)) {
              next = j;
              break;
            }
          }
          if (next === -1) {
            found = false;
            break;
          }
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
    detectSafeCombinations(tokens) {
      const safeIndices = /* @__PURE__ */ new Set();
      for (const sc of this.safeCombinations) {
        const phraseTokens = sc.normalizedPhrase.split(" ").filter(Boolean);
        if (phraseTokens.length < 2) continue;
        for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
          let match = true;
          for (let j = 0; j < phraseTokens.length; j++) {
            if (tokens[i + j] !== phraseTokens[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            for (let j = 0; j < phraseTokens.length; j++) safeIndices.add(i + j);
          }
        }
      }
      return safeIndices;
    }
    validate(text) {
      const normalizedText = normalizeText(text, this.cfg);
      const rawTokens = text.split(/\s+/).filter(Boolean);
      const tokens = [];
      const tokenStrings = [];
      const matchedTerms = /* @__PURE__ */ new Set();
      let maxRisk = 0;
      for (const raw of rawTokens) {
        const normalized = normalizeToken(raw, this.cfg);
        if (!normalized) {
          tokens.push({ raw, normalized: "", status: "UNKNOWN" });
          continue;
        }
        tokenStrings.push(normalized);
        const risk = this.matchRiskToken(normalized);
        let status;
        if (risk) {
          status = "BLOCK";
          matchedTerms.add(risk.term);
          maxRisk = Math.max(maxRisk, risk.riskLevel);
        } else {
          status = this.classifyToken(normalized);
        }
        tokens.push({ raw, normalized, status });
      }
      for (const phrase of this.multiPhrases) {
        if (normalizedText.includes(phrase.normalizedTerm)) {
          matchedTerms.add(phrase.term);
          maxRisk = Math.max(maxRisk, phrase.riskLevel);
          const pw = phrase.normalizedTerm.split(" ").filter(Boolean);
          for (let i = 0; i <= tokenStrings.length - pw.length; i++) {
            let match = true;
            for (let j = 0; j < pw.length; j++) {
              if (tokenStrings[i + j] !== pw[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              for (let j = 0; j < pw.length; j++) tokens[i + j].status = "BLOCK";
            }
          }
        }
      }
      const combos = this.detectCombinations(normalizedText, tokenStrings);
      const matchedCombinations = [...new Set(combos.map((c) => c.phrase))];
      for (const c of combos) maxRisk = Math.max(maxRisk, c.riskLevel);
      for (const combo of combos) {
        const indices = this.findComboTokenIndices(tokenStrings, combo);
        for (const idx of indices) {
          if (tokens[idx]) tokens[idx].status = "BLOCK";
        }
      }
      const safeIndices = this.detectSafeCombinations(tokenStrings);
      for (const idx of safeIndices) {
        if (tokens[idx] && tokens[idx].status === "BLOCK") {
          tokens[idx].status = "ALLOW";
          matchedTerms.delete(tokens[idx].raw);
        }
      }
      const hasRisk = tokens.some((t) => t.status === "BLOCK");
      const reasons = [];
      if (matchedTerms.size > 0) reasons.push("Matched sensitive terminology");
      if (combos.length > 0 && hasRisk) reasons.push("Matched problematic term combination");
      if (!reasons.length) reasons.push("No sensitive terminology detected");
      return {
        action: hasRisk ? "BLOCK" : "ALLOW",
        riskScore: maxRisk,
        normalizedText,
        matchedTerms: [...matchedTerms].sort(),
        matchedCombinations,
        tokens,
        reason: reasons.join("; ")
      };
    }
  };
  // Try progressively stripping Hebrew prefixes and check each stripped form
  // against the blacklist. Handles "ובמודיעין" → "מודיעין" even with double prefixes.
  _ValidationEngine.PREFIXES = /* @__PURE__ */ new Set(["\u05D1", "\u05DC", "\u05DE", "\u05D4", "\u05D5", "\u05DB", "\u05E9"]);
  var ValidationEngine = _ValidationEngine;

  // src/web/browser-engine.ts
  var SYNC_URL = "/api/security/sync";
  var SUGGEST_URL = "/api/security/suggest";
  var SYNC_CACHE_KEY = "security-sync-payload";
  var engine = null;
  async function init() {
    const cachedRaw = localStorage.getItem(SYNC_CACHE_KEY);
    const cached = cachedRaw ? JSON.parse(cachedRaw) : null;
    const t0 = performance.now();
    const res = await fetch(SYNC_URL, {
      headers: cached ? { "If-None-Match": `"${cached.etag}"` } : {}
    });
    const syncMs = +(performance.now() - t0).toFixed(1);
    let payload;
    let fromCache = false;
    if (res.status === 304 && cached) {
      payload = cached.payload;
      fromCache = true;
    } else {
      payload = await res.json();
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
        combinations: payload.combinations.length
      }
    };
  }
  function validate(text) {
    if (!engine) throw new Error("Engine not initialized \u2014 call init() first");
    const t0 = performance.now();
    const result = engine.validate(text);
    return { ...result, tookMs: +(performance.now() - t0).toFixed(3) };
  }
  var suggestCache = /* @__PURE__ */ new Map();
  var abortController = null;
  var debounceTimer = null;
  function lastToken(text) {
    if (!text || /\s$/.test(text)) return "";
    const parts = text.split(/\s+/);
    return parts[parts.length - 1] ?? "";
  }
  function suggest(text, onResult, debounceMs = 300) {
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
          signal: abortController.signal
        });
        const data = await res.json();
        suggestCache.set(token, data.suggestions);
        onResult(data.suggestions, { fromCache: false, tookMs: +(performance.now() - t0).toFixed(1) });
      } catch (e) {
        if (e.name !== "AbortError") console.error(e);
      }
    }, debounceMs);
  }
  async function validateOnServer(text) {
    const res = await fetch("/api/security/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    return res.json();
  }
  var verifyTimer = null;
  var verifyAbort = null;
  function verifyWithServer(text, localResult, onCorrected, debounceMs = 400) {
    if (!text.trim()) return;
    if (verifyTimer) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(async () => {
      verifyAbort?.abort();
      verifyAbort = new AbortController();
      try {
        const res = await fetch("/api/security/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: verifyAbort.signal
        });
        const serverResult = await res.json();
        const differs = serverResult.tokens.some((st, i) => {
          const lt = localResult.tokens[i];
          return !lt || st.status !== lt.status;
        }) || serverResult.action !== localResult.action;
        if (differs) onCorrected(serverResult);
      } catch (e) {
        if (e.name !== "AbortError") console.error("[verify]", e);
      }
    }, debounceMs);
  }
  return __toCommonJS(browser_engine_exports);
})();

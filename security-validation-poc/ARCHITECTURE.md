# Security Validation Engine — מדריך מלא

> **מטרת המסמך:** להסביר מאפס איך מנגנון ולידציית האבטחה עובד — מה קורה כשמשתמש מקליד אות, איך הנתונים זורמים, מה כל טכנולוגיה עושה, ואיך הצד-לקוח והשרת משתפים פעולה.

---

## תוכן עניינים

1. [מה הבעיה שפותרים](#מה-הבעיה-שפותרים)
2. [ארכיטקטורה כללית](#ארכיטקטורה-כללית)
3. [מה קורה כשהמשתמש מקליד — Flow מלא](#מה-קורה-כשהמשתמש-מקליד)
4. [Normalization — איך מנרמלים עברית](#normalization)
5. [Bloom Filter — מה זה ולמה צריך](#bloom-filter)
6. [Fuzzy Matching — זיהוי מילים דומות](#fuzzy-matching)
7. [Combinations — צירופים בעייתיים](#combinations)
8. [Suggestions — השלמות מהשרת](#suggestions)
9. [Sync — סנכרון נתונים בין שרת ללקוח](#sync)
10. [Flow של השרת](#flow-של-השרת)
11. [מבנה הקוד](#מבנה-הקוד)
12. [טכנולוגיות](#טכנולוגיות)

---

## מה הבעיה שפותרים

יש לנו מערכות שבהן משתמשים מכניסים שמות חופשיים — שמות חדרים, שירותים, משאבים. אנחנו רוצים **למנוע חשיפה מקרית של מונחים רגישים ביטחונית** (שמות יחידות, מבנים ארגוניים צבאיים, צירופים חשודים).

**דוגמאות:**

- `"מרפאה"` → ✅ ALLOW — מילה אזרחית רגילה
- `"יחידת 8200"` → ❌ BLOCK — מספר יחידה רגיש
- `"לשכת אלוף"` → ❌ BLOCK — צירוף שחושף היררכיה צבאית
- `"בלשכת האלוף"` → ❌ BLOCK — אותו דבר עם אותיות שימוש (ב, ה)

**הדרישות:**

1. **זמן אמת** — ולידציה על כל keystroke, ללא השהיה מורגשת
2. **דגל אחד** — מפתח מוסיף `securityValidation` ל-TextField וזהו
3. **Single Source of Truth** — רשימות מנוהלות במקום אחד
4. **Defense in depth** — גם אם הלקוח נפרץ, השרת מאמת שוב

---

## ארכיטקטורה כללית

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                    │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  TextField (securityValidation=true)                              │  │
│  │                                                                    │  │
│  │  "לשכת א" → validate() → { action: BLOCK, tokens: [...] }       │  │
│  │              ↑                                                     │  │
│  │         כל keystroke,                                             │  │
│  │         0 קריאות רשת,                                             │  │
│  │         ~0.1ms                                                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                     ValidationEngine                                    │
│                              │                                          │
│  ┌───────────────────────────┼──────────────────────────────────────┐  │
│  │                   In-Memory Store                                  │  │
│  │                                                                    │  │
│  │  blacklistSet (275 מונחים)      - לזיהוי מילים חסומות            │  │
│  │  combinations (88 כללים)         - לזיהוי צירופים בעייתיים        │  │
│  │  whitelistBloom (129k → 227KB)  - לבדיקה אם מילה אזרחית        │  │
│  │  prefixVocabulary (900 בסיסים)  - לנורמליזציה של ב/ל/מ/ה…       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│              נטען פעם אחת מהשרת (GET /sync)                            │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SERVER (Express)                               │
│                                                                         │
│  GET  /api/security/sync      → מחזיר את כל הנתונים (payload)         │
│  GET  /api/security/suggest   → השלמות (top 5 מילים לפי prefix)       │
│  POST /api/security/validate  → אימות סמכותי (defense-in-depth)       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   In-Memory Index                                  │  │
│  │  (נטען מ-CSV פעם אחת ב-startup, זהה ללקוח)                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                     reads on startup                                     │
│                              │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  data/*.csv                                                        │  │
│  │  blacklist.csv (275) | whitelist.csv (129k) | combinations (88)   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

**העיקרון:** הלקוח מקבל snapshot של כל הנתונים פעם אחת, ומריץ את **אותו** מנוע ולידציה מקומית. אין קריאות רשת על כל keystroke.

---

## מה קורה כשהמשתמש מקליד

נעקוב אחרי מה שקורה כשמשתמש מקליד `"בלשכת האלוף"` תו אחר תו:

### שלב 1: אות ראשונה — `"ב"`

```
input: "ב"
  → validate("ב")
    → normalize("ב") → "ב" (אות בודדה, לא נחתכת)
    → tokens = ["ב"]
    → blacklist.has("ב") → false
    → bloom.has("ב") → false
    → result: { action: "ALLOW", tokens: [{ raw:"ב", status:"UNKNOWN" }] }
    → TextField: מילה צהובה (UNKNOWN — אנחנו עוד לא יודעים מה זה)
```

**זמן: ~0.05ms. אפס קריאות רשת.**

### שלב 2: ממשיך להקליד — `"בלשכת"`

```
input: "בלשכת"
  → validate("בלשכת")
    → normalize("בלשכת"):
        1. strip niqqud → "בלשכת" (אין ניקוד)
        2. remove quotes → "בלשכת"
        3. prefix strip:
           "בלשכת" → candidate "לשכת" → is "לשכת" in knownBases? YES
           → token = "לשכת"
           → is "לשכת" in constructForms? YES → "לשכה"
           RESULT: "לשכה"
    → tokens = ["לשכה"]
    → blacklist.has("לשכה") → false
    → bloom.has("לשכה") → true ✅ (מילה אזרחית — לשכה)
    → result: { action: "ALLOW", tokens: [{ raw:"בלשכת", normalized:"לשכה", status:"ALLOW" }] }
    → TextField: מילה ירוקה
```

**שימו לב:** `"בלשכת"` עברה נורמליזציה → `"לשכה"`. האות `ב` נחתכה (prefix), ו-`לשכת` הפכה ל-`לשכה` (צורת סמיכות).

### שלב 3: רווח + מילה חדשה — `"בלשכת האלוף"`

```
input: "בלשכת האלוף"
  → validate("בלשכת האלוף")
    → normalize:
        "בלשכת" → "לשכה" (כמו קודם)
        "האלוף" → candidate "אלוף" → knownBases.has("אלוף") → YES → "אלוף"
    → tokens = ["לשכה", "אלוף"]

    → PER-TOKEN CHECK:
       "לשכה": blacklist.has → false, bloom.has → true → ALLOW
       "אלוף": blacklist.has → TRUE! (מונח רגיש) → BLOCK

    → COMBINATION CHECK:
       rules.find("לשכה אלוף"):
         normalized phrase = "לשכה אלוף"
         tokens include "לשכה" AND "אלוף"? YES → MATCH!

    → result: {
        action: "BLOCK",
        riskScore: 97,
        matchedTerms: ["אלוף"],
        matchedCombinations: ["לשכת אלוף"],
        tokens: [
          { raw: "בלשכת", normalized: "לשכה", status: "ALLOW" },
          { raw: "האלוף", normalized: "אלוף", status: "BLOCK" }
        ]
      }
    → TextField: "בלשכת" ירוקה, "האלוף" אדומה, גבול השדה אדום
```

**זמן: ~0.1ms. עדיין אפס קריאות רשת.**

---

## Normalization

### למה צריך?

בעברית אפשר לכתוב את אותה מילה בהרבה צורות:

| מה שהמשתמש כתב            | מה שאנחנו רוצים לזהות |
| ------------------------- | --------------------- |
| `בְּלִשְׁכַּת` (עם ניקוד) | `לשכה`                |
| `"לשכת"` (עם גרשיים)      | `לשכה`                |
| `בלשכת` (עם אות שימוש)    | `לשכה`                |
| `לשכת` (צורת סמיכות)      | `לשכה`                |
| `הלשכה` (עם ה"א הידיעה)   | `לשכה`                |

בלי נורמליזציה, נצטרך לשמור את **כל** הצורות ברשימות. עם נורמליזציה — מספיק לשמור `"לשכה"` פעם אחת.

### הצינור (Pipeline)

```typescript
// src/core/normalize.ts

// שלב 1: הסרת ניקוד (marks שמעל/מתחת לאותיות)
function stripNiqqud(text: string): string {
  return text.normalize('NFD').replace(/[\u0591-\u05C7]/g, '');
}
// "בְּלִשְׁכַּת" → "בלשכת"

// שלב 2: הסרת גרשיים וציטוטים
token = token.replace(/['"״׳`´\u201C-\u201F]/g, '');
// "צה״ל" → "צהל"

// שלב 3: נורמליזציה של מפרידים
text = text.replace(/[-־–—_/]+/g, ' ');
// "חדר-כושר" → "חדר כושר"

// שלב 4: החלפת צורות סמיכות (construct forms)
const CONSTRUCT_FORMS = { 'לשכת': 'לשכה', 'יחידת': 'יחידה', ... };
if (constructForms.has(token)) return constructForms.get(token)!;
// "לשכת" → "לשכה"

// שלב 5: הפשטת אותיות שימוש (prefix stripping)
// אותיות שימוש בעברית: ב, ל, מ, ה, ו, כ, ש
// "בלשכת" → "לשכת" → "לשכה"
while (token.length > 3 && HEBREW_PREFIXES.has(token[0])) {
  const candidate = token.slice(1);
  // רק אם התוצאה היא מילה מוכרת!
  if (!knownBases.has(candidate) && !constructForms.has(candidate)) break;
  token = candidate;
}
```

### למה ה-Normalization גנרית (data-driven)?

ה-prefix stripping **לא** hardcoded. הוא עובד רק אם התוצאה היא מילה מוכרת מהנתונים:

```typescript
// knownBases נבנה אוטומטית מכל המילים ברשימות:
const knownBases = new Set([
  ...blacklist.map((t) => t.normalizedTerm.split(" ")).flat(),
  ...combinations.map((c) => c.normalizedPhrase.split(" ")).flat(),
]);
```

**דוגמה:**

- `"במבצע"` → candidate `"מבצע"` → `knownBases.has("מבצע")` = true → חותך ✅
- `"בדיקה"` → candidate `"דיקה"` → `knownBases.has("דיקה")` = false → **לא חותך** ✅

זה מונע חיתוך שגוי של מילים שה-`ב` שלהן הוא חלק מהמילה ולא אות שימוש.

---

## Bloom Filter

### מה הבעיה?

יש לנו **129,343 מילים אזרחיות** (whitelist). אנחנו רוצים לבדוק אם מילה שהמשתמש הקליד נמצאת ברשימה הזו. אבל אנחנו לא יכולים לשלוח 129k strings לדפדפן — זה ~2.5MB ויאט את הטעינה.

### מה זה Bloom Filter?

**Bloom Filter הוא מבנה נתונים מיוחד** שמאפשר לענות על השאלה:

> "האם X נמצא בקבוצה?"

עם שתי תכונות:

1. **אם התשובה "לא" — זה בטוח לא.** (Zero false negatives)
2. **אם התשובה "כן" — זה כנראה כן** (יכול להיות false positive נדיר)

### איך זה עובד — הסבר ויזואלי

```
Bloom Filter = מערך של ביטים (0 או 1)

[0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0]   ← 16 bits (בפועל אצלנו ~1.8 מיליון)
 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15

הוספת "מרפאה":
  hash1("מרפאה") = 3
  hash2("מרפאה") = 7
  hash3("מרפאה") = 14
  → set bits 3, 7, 14:

[0][0][0][1][0][0][0][1][0][0][0][0][0][0][1][0]
          ↑              ↑                    ↑

הוספת "ספרייה":
  hash1("ספרייה") = 1
  hash2("ספרייה") = 7    ← overlap with "מרפאה" — OK!
  hash3("ספרייה") = 11
  → set bits 1, 7, 11:

[0][1][0][1][0][0][0][1][0][0][0][1][0][0][1][0]
    ↑     ↑           ↑        ↑        ↑

בדיקה: "האם מרפאה קיימת?"
  hash1("מרפאה") = 3  → bit 3 = 1 ✓
  hash2("מרפאה") = 7  → bit 7 = 1 ✓
  hash3("מרפאה") = 14 → bit 14 = 1 ✓
  → כל הביטים 1 → "כנראה כן" ✅

בדיקה: "האם טנק קיים?"
  hash1("טנק") = 3  → bit 3 = 1 ✓
  hash2("טנק") = 5  → bit 5 = 0 ✗
  → לפחות ביט אחד 0 → "בוודאות לא" ❌
```

### למה זה מתאים לנו?

| בלי Bloom                     | עם Bloom               |
| ----------------------------- | ---------------------- |
| שולחים 129,343 strings לדפדפן | שולחים מערך ביטים בלבד |
| ~2.5MB gzipped                | **~227KB**             |
| טעינה איטית                   | טעינה מהירה            |
| lookup = O(1)                 | lookup = O(1)          |

### מה קורה ב-false positive?

```
"xyz123" → bloom.has() = true (false positive — המילה לא באמת ברשימה)
→ status = "ALLOW" (ירוק)  ← קצת שגוי, אבל לא מזיק

"צהל" → bloom.has() = false (correct negative)
→ ממשיך לבדוק blacklist → BLOCK (אדום) ← נכון!
```

False positive = מילה לא-מוכרת מוצגת כ-ALLOW (ירוק) במקום UNKNOWN (צהוב). זה לא מסוכן כי:

- מילים **רגישות** תמיד נבדקות מול ה-blacklist **לפני** ה-Bloom
- ה-Bloom רק קובע "ירוק" או "צהוב", לעולם לא מבטל "אדום"

### הקוד

```typescript
// src/core/bloom-filter.ts

class BloomFilter {
  readonly size: number; // כמות ביטים (m) — אצלנו ~1.8 מיליון
  readonly hashes: number; // כמות hash functions (k) — אצלנו 10
  private readonly bits: Uint8Array; // מערך הביטים

  // חישוב הפרמטרים האופטימליים: n=129,343 items, p=0.001 (0.1% false positive)
  static optimal(n: number, p = 0.001) {
    const size = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2)); // ~1.86M bits
    const hashes = Math.round((size / n) * Math.LN2); // 10 hashes
    return { size, hashes };
  }

  // הוספת מילה (בצד השרת בלבד — בונה את ה-filter)
  add(item: string): void {
    for (const idx of this.indexes(item)) {
      this.bits[idx >>> 3] |= 1 << (idx & 7); // set bit
    }
  }

  // בדיקת מילה (בצד הלקוח — real-time)
  has(item: string): boolean {
    for (const idx of this.indexes(item)) {
      if ((this.bits[idx >>> 3] & (1 << (idx & 7))) === 0) return false;
    }
    return true; // all bits set → probably exists
  }
}
```

### סיכום Bloom Filter

| מאפיין              | ערך                                         |
| ------------------- | ------------------------------------------- |
| מספר מילים (n)      | 129,343                                     |
| גודל (m)            | ~1.86 מיליון bits = **227 KB**              |
| hash functions (k)  | 10                                          |
| false positive rate | 0.1% (מילה 1 מ-1000 תראה "ירוקה" בטעות)     |
| false negative rate | **0%** (אף מילה אזרחית לא תיראה "לא מוכרת") |
| lookup time         | **O(1)** — קבוע                             |

---

## Fuzzy Matching

### למה לא מספיק exact match?

משתמש עלול לכתוב מילה רגישה עם שגיאת כתיב קטנה:

| מה כתב     | מה ברשימה   | דמיון | צריך לתפוס? |
| ---------- | ----------- | ----- | ----------- |
| `"מודיעי"` | `"מודיעין"` | 86%   | ✅ כן       |
| `"סיירט"`  | `"סיירת"`   | 92%   | ✅ כן       |
| `"מרפאה"`  | `"מודיעין"` | 35%   | ❌ לא       |

### הסף

- **86% דמיון ומעלה** = נחשב match (עבור blacklist)
- **רק על blacklist!** — whitelist נבדק ב-exact match (דרך Bloom)
- **רק מילים ≥5 תווים** — מילים קצרות נותנות יותר מדי false positives

### אופטימיזציה: Length Buckets

בדיקת fuzzy על 275 מונחים לכל מילה = איטי. אבל:

> מילה בת 6 תווים עם 86% דמיון = מקסימום 1 תו הבדל = המילה ברשימה חייבת להיות באורך 5, 6, או 7.

```typescript
// src/core/validation-engine.ts

// בנייה (פעם אחת): מאנדקסים את ה-blacklist לפי אורך
this.singleByLength = new Map<number, BlacklistTerm[]>();
// { 4: ["8200","9900"], 5: ["אמלח","חטמר"], 6: ["אלוף","מבצע"], ... }

// בדיקה: במקום 275 השוואות, רק ~15-30
private matchRiskToken(token: string): BlacklistTerm | null {
  // First: exact match (O(1) via Map)
  const exact = this.singleExact.get(token);
  if (exact) return exact;

  // Only fuzzy for tokens >= 5 chars
  if (token.length < 5) return null;

  // Check only ±1 length buckets
  for (let len = token.length - 1; len <= token.length + 1; len++) {
    const bucket = this.singleByLength.get(len);
    if (!bucket) continue;
    for (const term of bucket) {
      if (similarity(token, term.normalizedTerm) >= 0.86) return term;
    }
  }
  return null;
}
```

**תוצאה:** במקום 275 comparisons → ~20 comparisons לכל מילה.

---

## Combinations

### מה זה?

לפעמים מילה בודדת היא לגיטימית, אבל **צירוף** של שתי מילים הוא בעייתי:

| מילה 1 | מילה 2 | לבד   | ביחד         |
| ------ | ------ | ----- | ------------ |
| `לשכה` | `אלוף` | ✅/❌ | ❌ **BLOCK** |
| `חמל`  | `צפון` | ❌/✅ | ❌ **BLOCK** |
| `חדר`  | `כושר` | ✅/✅ | ✅ ALLOW     |

### איך הזיהוי עובד

```typescript
// src/core/validation-engine.ts

private detectCombinations(normalized: string, tokens: string[]): CombinationRule[] {
  // Fast path: skip if no tokens match the combination vocabulary
  const relevant = tokens.filter(t => this.comboVocabulary.has(t));
  if (relevant.length < 2) return []; // ← 95% of inputs exit here!

  for (const rule of this.combinations) {
    const phraseTokens = rule.normalizedPhrase.split(' ');
    // e.g. rule = "לשכה אלוף" → phraseTokens = ["לשכה", "אלוף"]

    // Method 1: exact substring match
    if (normalized.includes(rule.normalizedPhrase)) {
      matches.push(rule);
      continue;
    }

    // Method 2: window search (tokens within distance 4)
    // "לשכה X Y אלוף" → window=4 → MATCH (אלוף within 4 of לשכה)
    // "לשכה X Y Z W אלוף" → window=4 → NO MATCH (too far)
  }
}
```

### ה-Window

```
tokens: ["לשכה", "של", "ה", "אלוף", "הראשי"]
          ↑                    ↑
          position 0           position 3

rule: "לשכה אלוף"
  first token: "לשכה" found at position 0
  search window: positions 1..4 (window=4)
  "אלוף" found at position 3 → MATCH! ✅
```

### ה-Combo Vocabulary Trick

```typescript
// Pre-built set of all tokens that appear in any combination rule
this.comboVocabulary = new Set(["לשכה", "אלוף", "חמל", "צפון", "מפקד", ...]);

// Before checking 88 rules: are there even 2 relevant tokens?
const relevant = tokens.filter(t => this.comboVocabulary.has(t));
if (relevant.length < 2) return []; // ← instant exit, no work
```

**95% של הקלטים יוצאים כאן** בלי לבדוק אף כלל.

---

## Suggestions

### למה צריך שרת?

ה-Bloom Filter יכול לענות רק "האם X קיים?" — כן/לא.
הוא **לא יכול** לענות "מה מתחיל ב-X?" — אין דרך לעבור על הערכים.

לכן, **suggestions חייבות לבוא מהשרת**, שם יש את כל 129k המילים.

### איך עובד בצד הלקוח

```typescript
// src/web/browser-engine.ts

export function suggest(text, onResult, debounceMs = 300) {
  const token = lastToken(text);

  // Rule 1: minimum 2 characters
  if (token.length < 2) {
    onResult([]);
    return;
  }

  // Rule 2: check local cache first (0ms)
  const cached = suggestCache.get(token);
  if (cached) {
    onResult(cached);
    return;
  }

  // Rule 3: debounce — wait 300ms of silence before asking the server
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    // Rule 4: abort previous in-flight request
    abortController?.abort();
    abortController = new AbortController();

    // Rule 5: ask the server
    const res = await fetch(`/api/security/suggest?q=${token}&limit=5`, {
      signal: abortController.signal,
    });
    const data = await res.json();

    // Rule 6: cache for future
    suggestCache.set(token, data.suggestions);
    onResult(data.suggestions);
  }, debounceMs);
}
```

### מה עושה ה-Debounce?

```
User types: "מ" → "מר" → "מרפ" → "מרפא"
             │      │       │        │
Timer:     start  restart  restart  restart
             ↓                        ↓
           cancel                   FIRE after 300ms silence
                                      │
                                    GET /suggest?q=מרפא
                                      │
                                    → ["מרפאה", "מרפאת שיניים", ...]
```

**בלי debounce:** 4 requests.
**עם debounce:** request אחד — רק כשהמשתמש עצר להקליד.

### איך עובד בצד השרת

```typescript
// src/server/data-loader.ts

// On startup: sort all 129k terms alphabetically by normalized form
suggestionIndex.sort((a, b) => (a.normalized < b.normalized ? -1 : 1));

// On request: binary search for the prefix
export function suggest(index, prefix, limit): { suggestions: string[] } {
  // Find first item >= prefix using binary search (O(log n))
  let lo = 0,
    hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].normalized < prefix) lo = mid + 1;
    else hi = mid;
  }
  // Collect items that start with the prefix
  const out = [];
  for (let i = lo; i < index.length && out.length < limit; i++) {
    if (!index[i].normalized.startsWith(prefix)) break;
    out.push(index[i].term);
  }
  return { suggestions: out };
}
```

**זמן:** ~0.15ms (binary search + scan). אפס I/O, הכל מהזיכרון.

---

## Sync

### מה זה?

ה-sync הוא הרגע שבו הלקוח מוריד את כל הנתונים מהשרת כדי לבנות את ה-engine המקומי.

### מתי זה קורה?

1. **App load** — פעם אחת כשהאפליקציה נטענת
2. **Cache miss** — אם אין גרסה מקומית ב-localStorage

### מה הלקוח מקבל (SyncPayload)

```typescript
interface SyncPayload {
  version: string; // "2855d063d2bb" — hash שמשתנה כשהרשימות משתנות
  updatedAt: string; // "2026-06-07T10:00:00.000Z"

  blacklist: BlacklistTerm[]; // 275 מונחים (~10KB)
  combinations: CombinationRule[]; // 88 כללים (~5KB)
  constructForms: [string, string][]; // 5 pairs (~0.5KB)
  prefixVocabulary: string[]; // ~900 bases (~8KB)

  whitelist: {
    bits: string; // Bloom filter as base64 (~227KB)
    size: number; // 1,862,000 bits
    hashes: number; // 10
    count: number; // 129,343
  };
}
// Total: ~368KB (before gzip: ~180KB after)
```

### ETag Caching — לא מורידים אם לא השתנה

```
First visit:
  GET /api/security/sync
  → 200 OK, ETag: "2855d063d2bb"
  → Body: { full payload }
  → Client stores in localStorage

Second visit:
  GET /api/security/sync
  Headers: If-None-Match: "2855d063d2bb"
  → 304 Not Modified (no body!)
  → Client uses localStorage version

After admin adds a term:
  GET /api/security/sync
  Headers: If-None-Match: "2855d063d2bb"
  → 200 OK, ETag: "f8a1c2d4e5b6" (new version!)
  → Body: { new payload }
  → Client rebuilds engine
```

---

## Flow של השרת

### Startup

```
Server starts
  │
  ├─ 1. Read blacklist.csv (275 rows)
  ├─ 2. Read whitelist.csv (129,343 rows)
  ├─ 3. Read problematic_combinations.csv (88 rows)
  │
  ├─ 4. Build prefixVocabulary from all blacklist + combination tokens
  │
  ├─ 5. Normalize all whitelist terms (using same normalization as client!)
  │
  ├─ 6. Build Bloom filter (insert all 129k normalized whitelist terms)
  │
  ├─ 7. Build sorted suggestion index (for binary-search prefix lookup)
  │
  ├─ 8. Compute version hash (SHA1 of sizes)
  │
  ├─ 9. Build server-side ValidationEngine (for /validate endpoint)
  │
  └─ 10. Ready! (~1.8 seconds)

  Log: "[startup] blacklist=275 whitelist=129343 combinations=88 bloom=227KB"
```

### Request Handling

```
GET /api/security/sync
  → Check if files changed since last load (file size + mtime)
  → If changed: rebuild everything
  → Check ETag header
  → If match: return 304
  → Else: return full payload with ETag

GET /api/security/suggest?q=מרפ&limit=5
  → Normalize query: "מרפ" → "מרפ"
  → Binary search in sorted suggestion index
  → Return first 5 matches: ["מרפאה", "מרפאת שיניים", ...]
  → ~0.15ms

POST /api/security/validate  { text: "לשכת אלוף" }
  → Run same ValidationEngine as client
  → Return: { action: "BLOCK", matchedCombinations: ["לשכת אלוף"], ... }
  → Used for defense-in-depth on form submit
```

---

## מבנה הקוד

```
security-validation-poc/
│
├── src/
│   ├── core/                           ← 💡 ליבה משותפת (Node + Browser)
│   │   ├── types.ts                      TypeScript interfaces
│   │   ├── normalize.ts                  נורמליזציה עברית (data-driven)
│   │   ├── bloom-filter.ts               Bloom filter implementation
│   │   ├── validation-engine.ts          המנוע: normalize → classify → combine
│   │   └── index.ts                      re-exports
│   │
│   ├── server/                         ← 🖥️ שרת (source of truth)
│   │   ├── data-loader.ts               טוען CSV, בונה payload + bloom + suggest index
│   │   └── index.ts                     Express routes: /sync, /suggest, /validate
│   │
│   └── web/                            ← 🌐 entry point לדפדפן
│       └── browser-engine.ts            init, validate, suggest, validateOnServer
│
├── public/                             ← UI הדגמה
│   ├── index.html                       2 קומפוננטות: background + per-word
│   └── engine.js                        bundle (output of esbuild)
│
├── scripts/
│   └── selftest.ts                      בדיקות אוטומטיות (correctness + perf)
│
├── package.json                         scripts: build:web, start, dev:web
└── tsconfig.json
```

### מה רץ איפה

| קובץ                        | Node (server) | Browser | שניהם |
| --------------------------- | :-----------: | :-----: | :---: |
| `core/normalize.ts`         |               |         |  ✅   |
| `core/bloom-filter.ts`      |               |         |  ✅   |
| `core/validation-engine.ts` |               |         |  ✅   |
| `server/data-loader.ts`     |      ✅       |         |       |
| `server/index.ts`           |      ✅       |         |       |
| `web/browser-engine.ts`     |               |   ✅    |       |

---

## טכנולוגיות

| טכנולוגיה                      | איפה             | למה                                                 |
| ------------------------------ | ---------------- | --------------------------------------------------- |
| **TypeScript**                 | הכל              | type safety, הצוות כבר שם                           |
| **Express**                    | server           | minimal HTTP framework (בפרודקשן = NestJS)          |
| **esbuild**                    | build            | bundles `src/core` + `src/web` → `engine.js` ב-48ms |
| **tsx**                        | dev              | runs TypeScript ישירות ב-Node בלי compile           |
| **Bloom Filter**               | core             | whitelist 129k → 227KB instead of 2.5MB             |
| **Binary Search**              | server (suggest) | prefix lookup ב-O(log n) על 129k מילים              |
| **Levenshtein ratio**          | core (fuzzy)     | זיהוי שגיאות כתיב ב-blacklist                       |
| **ETag/304**                   | sync             | לא מורידים payload אם לא השתנה                      |
| **Debounce + AbortController** | browser          | request אחד ל-"עצירה" בהקלדה, ביטול ישנים           |
| **localStorage**               | browser          | cache של sync payload בין sessions                  |
| **WeakMap**                    | browser          | state ניווט מקלדת לכל field בנפרד                   |

---

## סיכום — מה חשוב לזכור

1. **Validation = client-only, instant.** אף keystroke לא שולח request.
2. **Suggestions = server, debounced.** כי צריך prefix search על 129k.
3. **Submit = server re-validates.** כי אי אפשר לסמוך על הלקוח לבד.
4. **Bloom Filter = 129k מילים ב-227KB.** False positive = מילה לא-מוכרת נראית ירוקה — לא מסוכן.
5. **Normalization = data-driven.** ב/ל/מ/ה נחתכים רק אם התוצאה מוכרת מהרשימות.
6. **Fuzzy matching = 86% דמיון, רק blacklist, רק ≥5 תווים.** Length buckets חותכים 90% מההשוואות.
7. **Combinations = window of 4 tokens.** Fast exit אם אין 2 מילים מהאוצר הרלוונטי.
8. **Sync = פעם אחת + ETag.** ~368KB, cached ב-localStorage.

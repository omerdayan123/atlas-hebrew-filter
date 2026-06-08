/**
 * Comprehensive test suite for the Security Validation Engine.
 * ~400 tests covering: blacklist, whitelist, unknown, prefixes, combinations,
 * safe combinations, construct forms, fuzzy matching, niqqud, edge cases,
 * overall action consistency, and per-token status.
 */
import { loadData } from '../src/server/data-loader.js';
import { ValidationEngine } from '../src/core/validation-engine.js';
import { join } from 'path';

const data = loadData(join(import.meta.dirname, '..', '..', 'data'));
const engine = new ValidationEngine(data.payload);

type Expected = 'BLOCK' | 'ALLOW' | 'UNKNOWN';

interface TestCase {
  input: string;
  expectedAction: 'BLOCK' | 'ALLOW';
  expectedTokens?: Expected[];  // per-token status (optional)
  desc: string;
}

const tests: TestCase[] = [];

// ═══════════════════════════════════════════════════════════════════
// 1. BLACKLIST — EXACT SINGLE WORDS (should BLOCK)
// ═══════════════════════════════════════════════════════════════════
const blacklistSingles = [
  'אלוף', 'מודיעין', 'מבצעים', 'פיקוד', 'מפקדה', 'סייבר', 'לוחמה',
  'כוננות', 'מבצע', 'בכיר', 'בכירים', 'שייטת', 'סיירת', 'קומנדו',
  'גולני', 'גבעתי', 'צנחנים', 'קריפטוגרפיה', 'חמל', 'תצא', 'רמטכל',
  'תאל', 'סדכ', 'רענ', 'רמח', 'רמט', 'רמא', 'רלש', 'מחט', 'מגד',
  'אייל',
];
for (const term of blacklistSingles) {
  tests.push({
    input: term,
    expectedAction: 'BLOCK',
    expectedTokens: ['BLOCK'],
    desc: `Blacklist exact: "${term}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 2. BLACKLIST — MULTI-WORD PHRASES (should BLOCK)
// ═══════════════════════════════════════════════════════════════════
const blacklistMulti = [
  'תת אלוף', 'חירום מבצעי', 'נוהל קרב', 'חדר מצב', 'שם מבצע',
  'חדר מבצעים', 'מבצעים חשאיים', 'סדר כוחות', 'ראש ענף',
  'ראש מחלקה', 'ראש מטה', 'ראש לשכה', 'מפקד חטיבה', 'מפקד גדוד',
  'רב נגד', 'שייטת 13', 'סיירת מטכל', 'רוכב שמיים',
  'חטיבת הקומנדו', 'חטיבת גולני', 'חטיבת גבעתי', 'חטיבת הנחל',
  'חטיבת כפיר', 'חטיבת הצנחנים',
];
for (const phrase of blacklistMulti) {
  tests.push({
    input: phrase,
    expectedAction: 'BLOCK',
    desc: `Blacklist multi-word: "${phrase}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 3. BLACKLIST — NUMERIC UNITS (should BLOCK)
// ═══════════════════════════════════════════════════════════════════
for (const num of ['8200', '9900', '504', '3060', '669']) {
  tests.push({
    input: num,
    expectedAction: 'BLOCK',
    expectedTokens: ['BLOCK'],
    desc: `Blacklist numeric: "${num}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 4. WHITELIST — EXACT SINGLE WORDS (should ALLOW)
// ═══════════════════════════════════════════════════════════════════
const whitelistSingles = [
  'מרפאה', 'מספרה', 'אפסנאות', 'ספרייה', 'קבלה', 'תור', 'שירות',
  'תחזוקה', 'ניקיון', 'חניה', 'משרד', 'יומן', 'הזמנה', 'מועדון',
  'שקם', 'כוורת', 'בריכה', 'כיתה', 'אולם', 'הרצאה', 'שתייה',
  'חובש', 'רופא', 'שיניים', 'חיסון', 'פיזיותרפיה', 'אופטיקה',
  'אהוב',
];
for (const term of whitelistSingles) {
  tests.push({
    input: term,
    expectedAction: 'ALLOW',
    expectedTokens: ['ALLOW'],
    desc: `Whitelist exact: "${term}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 5. WHITELIST — MULTI-WORD (should ALLOW)
// ═══════════════════════════════════════════════════════════════════
const whitelistMulti = [
  'חדר כושר', 'בדיקת דם', 'ציוד משרדי', 'בית כנסת', 'שיעור תורה',
  'אימון גופני', 'רופא משפחה', 'מרפאת שיניים', 'בית מרקחת',
];
for (const phrase of whitelistMulti) {
  tests.push({
    input: phrase,
    expectedAction: 'ALLOW',
    desc: `Whitelist multi-word: "${phrase}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 6. PREFIX STRIPPING — WHITELIST WITH ו/ב/ל/מ/ה/כ/ש
// ═══════════════════════════════════════════════════════════════════
const prefixTests: [string, string][] = [
  ['ואהוב', 'אהוב'],
  ['באהוב', 'אהוב'],
  ['לאהוב', 'אהוב'],
  ['ומרפאה', 'מרפאה'],
  ['במרפאה', 'מרפאה'],
  ['למרפאה', 'מרפאה'],
  ['המרפאה', 'מרפאה'],
  ['כמרפאה', 'מרפאה'],
  ['שמרפאה', 'מרפאה'],
  ['ושירות', 'שירות'],
  ['בשירות', 'שירות'],
  ['לשירות', 'שירות'],
  ['ותור', 'תור'],
  ['בתור', 'תור'],
  ['לתור', 'תור'],
  ['והזמנה', 'הזמנה'],
  ['בהזמנה', 'הזמנה'],
  ['להזמנה', 'הזמנה'],
  ['וספרייה', 'ספרייה'],
  ['בספרייה', 'ספרייה'],
  ['לספרייה', 'ספרייה'],
  ['ומשרד', 'משרד'],
  ['במשרד', 'משרד'],
  ['למשרד', 'משרד'],
  ['וחניה', 'חניה'],
  ['בחניה', 'חניה'],
  ['לחניה', 'חניה'],
  ['ורופא', 'רופא'],
  ['ברופא', 'רופא'],
  ['לרופא', 'רופא'],
  ['וניקיון', 'ניקיון'],
  ['בניקיון', 'ניקיון'],
  ['לניקיון', 'ניקיון'],
  ['ותחזוקה', 'תחזוקה'],
  ['בתחזוקה', 'תחזוקה'],
  ['לתחזוקה', 'תחזוקה'],
  ['ובריכה', 'בריכה'],
  ['לבריכה', 'בריכה'],
  ['הבריכה', 'בריכה'],
  ['וכיתה', 'כיתה'],
  ['בכיתה', 'כיתה'],
  ['לכיתה', 'כיתה'],
  ['ואולם', 'אולם'],
  ['באולם', 'אולם'],
  ['לאולם', 'אולם'],
  ['וחיסון', 'חיסון'],
  ['לחיסון', 'חיסון'],
];
for (const [prefixed, base] of prefixTests) {
  tests.push({
    input: prefixed,
    expectedAction: 'ALLOW',
    expectedTokens: ['ALLOW'],
    desc: `Prefix whitelist: "${prefixed}" → "${base}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 7. PREFIX + BLACKLIST WORDS (should still BLOCK)
// ═══════════════════════════════════════════════════════════════════
const prefixBlacklist: [string, string][] = [
  ['ואלוף', 'אלוף'],
  ['באלוף', 'אלוף'],
  ['לאלוף', 'אלוף'],
  ['והמודיעין', 'מודיעין'],
  ['בפיקוד', 'פיקוד'],
  ['לפיקוד', 'פיקוד'],
  ['וסייבר', 'סייבר'],
  ['בסייבר', 'סייבר'],
  ['ולוחמה', 'לוחמה'],
  ['בכוננות', 'כוננות'],
  ['לכוננות', 'כוננות'],
  ['והמבצע', 'מבצע'],
  ['במבצע', 'מבצע'],
  ['למבצע', 'מבצע'],
  ['ובכיר', 'בכיר'],
  ['ושייטת', 'שייטת'],
  ['בשייטת', 'שייטת'],
  ['וקומנדו', 'קומנדו'],
  ['בקומנדו', 'קומנדו'],
  ['לקומנדו', 'קומנדו'],
];
for (const [prefixed, base] of prefixBlacklist) {
  tests.push({
    input: prefixed,
    expectedAction: 'BLOCK',
    expectedTokens: ['BLOCK'],
    desc: `Prefix blacklist: "${prefixed}" → "${base}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 8. COMMON WORDS IN THE 129K WHITELIST (these are NOT unknown)
// ═══════════════════════════════════════════════════════════════════
const inWhitelist = [
  'בננה', 'שוקולד', 'פיצה', 'אבטיח', 'טלוויזיה', 'מטאור',
  'קוסמוס', 'דינוזאור', 'אסטרונאוט', 'פלנטה', 'גלקסיה',
  'מיקרוסקופ', 'אנטנה', 'פרוטון',
];
for (const word of inWhitelist) {
  tests.push({
    input: word,
    expectedAction: 'ALLOW',
    expectedTokens: ['ALLOW'],
    desc: `Common word in whitelist: "${word}"`,
  });
}
// This word is NOT in the 129k whitelist — genuinely unknown.
tests.push({
  input: 'ניוטרון',
  expectedAction: 'ALLOW',
  expectedTokens: ['UNKNOWN'],
  desc: 'Unknown word: "ניוטרון"',
});

// ═══════════════════════════════════════════════════════════════════
// 9. PROBLEMATIC COMBINATIONS (should BLOCK with tokens marked)
// ═══════════════════════════════════════════════════════════════════
const combos: [string, Expected[]][] = [
  ['לשכת אלוף', ['BLOCK', 'BLOCK']],
  ['חמל צפון', ['BLOCK', 'BLOCK']],
  ['מדור מבצעים', ['BLOCK', 'BLOCK']],
  ['פרויקט מודיעין', ['BLOCK', 'BLOCK']],
  ['בסיס 8200', ['BLOCK', 'BLOCK']],
  ['יחידת מבצעים', ['BLOCK', 'BLOCK']],
  ['מפקדת פיקוד', ['BLOCK', 'BLOCK']],
  ['תחקיר מבצעי', ['BLOCK', 'BLOCK']],
  ['אגף מודיעין', ['BLOCK', 'BLOCK']],
  ['ענף סייבר', ['BLOCK', 'BLOCK']],
  ['מחלקת קריפטוגרפיה', ['BLOCK', 'BLOCK']],
  ['לשכת רמטכל', ['BLOCK', 'BLOCK']],
  ['חדר מבצעים', ['BLOCK', 'BLOCK']],
  ['שם מבצע', ['BLOCK', 'BLOCK']],
  ['בסיס 512', ['BLOCK', 'BLOCK']],
  ['מרכז טילים', ['BLOCK', 'BLOCK']],
  ['חדר בכירים', ['BLOCK', 'BLOCK']],
];
for (const [phrase, tokenStatuses] of combos) {
  tests.push({
    input: phrase,
    expectedAction: 'BLOCK',
    expectedTokens: tokenStatuses,
    desc: `Combo BLOCK: "${phrase}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 10. SAFE COMBINATIONS — blocked words safe in specific context
// ═══════════════════════════════════════════════════════════════════
// Rule: safe combo is valid ONLY when it ends at the last token.
// Words before the combo are fine; words after invalidate it.
tests.push({
  input: 'אייל',
  expectedAction: 'BLOCK',
  expectedTokens: ['BLOCK'],
  desc: 'Safe combo: "אייל" alone → BLOCK',
});
tests.push({
  input: 'אייל אנגל',
  expectedAction: 'ALLOW',
  expectedTokens: ['ALLOW', 'ALLOW'],
  desc: 'Safe combo: "אייל אנגל" → ALLOW (combo at end)',
});
tests.push({
  input: 'אייל אנג\'ל',
  expectedAction: 'ALLOW',
  expectedTokens: ['ALLOW', 'ALLOW'],
  desc: 'Safe combo: "אייל אנג\'ל" → ALLOW (quote normalized)',
});
tests.push({
  input: 'אייל אנג\'ל המלך',
  expectedAction: 'ALLOW',
  desc: 'Safe combo + more words: "אייל אנג\'ל המלך" → ALLOW (combo adjacent)',
});
tests.push({
  input: 'אנגל המלך',
  expectedAction: 'ALLOW',
  desc: '"אנגל המלך" → ALLOW (no blocked words)',
});
tests.push({
  input: 'אייל המלך',
  expectedAction: 'BLOCK',
  desc: '"אייל המלך" → BLOCK (no safe combo match)',
});
tests.push({
  input: 'שלום אייל',
  expectedAction: 'BLOCK',
  desc: '"שלום אייל" → BLOCK (no combo match)',
});
tests.push({
  input: 'שלום אייל אנגל',
  expectedAction: 'ALLOW',
  expectedTokens: ['ALLOW', 'ALLOW', 'ALLOW'],
  desc: '"שלום אייל אנגל" → ALLOW (combo at end)',
});
tests.push({
  input: 'שלום אייל אח אנגל',
  expectedAction: 'BLOCK',
  desc: '"שלום אייל אח אנגל" → BLOCK (not adjacent)',
});
tests.push({
  input: 'אנגל',
  expectedAction: 'ALLOW',
  expectedTokens: ['ALLOW'],
  desc: '"אנגל" alone → ALLOW (whitelisted)',
});

// ═══════════════════════════════════════════════════════════════════
// 11. CONSTRUCT FORMS (smichut) — לשכת→לשכה etc.
// ═══════════════════════════════════════════════════════════════════
const constructPairs: [string, string][] = [
  ['לשכת', 'לשכה'],
  ['יחידת', 'יחידה'],
  ['חטיבת', 'חטיבה'],
  ['מחלקת', 'מחלקה'],
  ['מפקדת', 'מפקדה'],
];
for (const [construct, base] of constructPairs) {
  tests.push({
    input: construct,
    expectedAction: 'BLOCK', // these map to blacklisted bases
    desc: `Construct form: "${construct}" → "${base}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 12. MIXED TEXT — ALLOW sentences (all whitelist/unknown, no block)
// ═══════════════════════════════════════════════════════════════════
const allowSentences = [
  'מרפאה ספרייה חדר כושר',
  'תור לרופא',
  'משרד קבלה ספרייה מרפאה',
  'הזמנה של ציוד משרדי',
  'שירות תחזוקה וניקיון',
  'בדיקת דם אצל רופא משפחה',
  'אימון גופני בבריכה',
  'שיעור בכיתה גדולה',
  'הרצאה באולם הגדול',
  'חובש במרפאה',
  'חדר כושר ומספרה',
  'פיזיותרפיה ואופטיקה',
  'בית מרקחת ובית כנסת',
  'מרפאת שיניים וחיסון',
  'קבלה ויומן',
];
for (const sentence of allowSentences) {
  tests.push({
    input: sentence,
    expectedAction: 'ALLOW',
    desc: `Allow sentence: "${sentence}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 13. MIXED TEXT — BLOCK sentences (contain blacklisted terms)
// ═══════════════════════════════════════════════════════════════════
const blockSentences = [
  'מרפאה סייבר',
  'הזמנה למודיעין',
  'תור אלוף',
  'משרד מבצעים',
  'ספרייה מפקדה',
  'חדר כושר ופיקוד',
  'רופא שייטת',
  'ניקיון מבצע',
  'חניה לוחמה',
  'קומנדו ספרייה',
];
for (const sentence of blockSentences) {
  tests.push({
    input: sentence,
    expectedAction: 'BLOCK',
    desc: `Block sentence: "${sentence}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 14. MIXED TEXT — per-token verification
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: 'מרפאה סייבר ספרייה',
  expectedAction: 'BLOCK',
  expectedTokens: ['ALLOW', 'BLOCK', 'ALLOW'],
  desc: 'Mixed: ALLOW BLOCK ALLOW token ordering',
});
tests.push({
  input: 'רופא אלוף חניה',
  expectedAction: 'BLOCK',
  expectedTokens: ['ALLOW', 'BLOCK', 'ALLOW'],
  desc: 'Mixed: rופא=ALLOW אלוף=BLOCK חניה=ALLOW',
});
tests.push({
  input: 'מרפאה ספרייה',
  expectedAction: 'ALLOW',
  expectedTokens: ['ALLOW', 'ALLOW'],
  desc: 'All whitelist tokens',
});
tests.push({
  input: 'אלוף מודיעין',
  expectedAction: 'BLOCK',
  expectedTokens: ['BLOCK', 'BLOCK'],
  desc: 'All blacklist tokens',
});

// ═══════════════════════════════════════════════════════════════════
// 15. EDGE CASES
// ═══════════════════════════════════════════════════════════════════
tests.push({ input: '', expectedAction: 'ALLOW', desc: 'Empty string' });
tests.push({ input: '   ', expectedAction: 'ALLOW', desc: 'Whitespace only' });
tests.push({ input: 'א', expectedAction: 'ALLOW', desc: 'Single Hebrew char' });
tests.push({ input: 'ab', expectedAction: 'ALLOW', desc: 'Latin chars' });
tests.push({ input: '123', expectedAction: 'ALLOW', desc: 'Non-blacklisted number' });
tests.push({ input: '!@#$%', expectedAction: 'ALLOW', desc: 'Special characters only' });
tests.push({ input: '   מרפאה   ', expectedAction: 'ALLOW', desc: 'Padded whitespace' });
tests.push({ input: 'מרפאה\nספרייה', expectedAction: 'ALLOW', desc: 'Newline separator' });
tests.push({
  input: 'מרפאה'.repeat(50),
  expectedAction: 'ALLOW',
  desc: 'Repeated whitelist word (long string)',
});
tests.push({
  input: Array(100).fill('תור').join(' '),
  expectedAction: 'ALLOW',
  desc: '100 repeated whitelist words',
});
tests.push({
  input: Array(100).fill('אלוף').join(' '),
  expectedAction: 'BLOCK',
  desc: '100 repeated blacklist words',
});

// ═══════════════════════════════════════════════════════════════════
// 16. OVERALL ACTION CONSISTENCY — action must match token statuses
// ═══════════════════════════════════════════════════════════════════
// If any token is BLOCK → action should be BLOCK
// If no BLOCK tokens → action should be ALLOW
const consistencyTexts = [
  'מרפאה', 'אלוף', 'מרפאה אלוף', 'ספרייה חניה', 'סייבר מודיעין',
  'חדר כושר', 'לשכת אלוף', 'תור לרופא', 'בית כנסת',
  'מבצע', 'שירות', 'אייל', 'אייל אנגל',
];
for (const text of consistencyTexts) {
  tests.push({
    input: text,
    expectedAction: 'CHECK_CONSISTENCY', // special marker
    desc: `Action-token consistency: "${text}"`,
  } as any);
}

// ═══════════════════════════════════════════════════════════════════
// 17. DOUBLE PREFIX STRIPPING (ו + ב, ו + ל, etc.)
// ═══════════════════════════════════════════════════════════════════
const doublePrefixWhitelist: [string, string][] = [
  ['ובמרפאה', 'מרפאה'],
  ['ולמרפאה', 'מרפאה'],
  ['ובספרייה', 'ספרייה'],
  ['ולספרייה', 'ספרייה'],
  ['ובחניה', 'חניה'],
  ['ולרופא', 'רופא'],
  ['ובשירות', 'שירות'],
  ['ולתחזוקה', 'תחזוקה'],
  ['ובאולם', 'אולם'],
  ['ולכיתה', 'כיתה'],
];
for (const [prefixed, base] of doublePrefixWhitelist) {
  tests.push({
    input: prefixed,
    expectedAction: 'ALLOW',
    expectedTokens: ['ALLOW'],
    desc: `Double prefix whitelist: "${prefixed}" → "${base}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 18. COMBINATIONS WITH ADDITIONAL WORDS (combo still detected)
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: 'מרפאה לשכת אלוף ספרייה',
  expectedAction: 'BLOCK',
  desc: 'Combo inside longer text: "מרפאה לשכת אלוף ספרייה"',
});
tests.push({
  input: 'הזמנה בסיס 8200 תור',
  expectedAction: 'BLOCK',
  desc: 'Combo inside longer text: "הזמנה בסיס 8200 תור"',
});
tests.push({
  input: 'ספרייה חמל צפון משרד',
  expectedAction: 'BLOCK',
  desc: 'Combo inside longer text: "ספרייה חמל צפון משרד"',
});

// ═══════════════════════════════════════════════════════════════════
// 19. WHITELIST SENTENCES WITH PREFIXES (real-world usage)
// ═══════════════════════════════════════════════════════════════════
const prefixSentences = [
  'במרפאה ובספרייה',
  'לתור ברופא',
  'בחניה הגדולה',
  'להזמנה של ציוד',
  'ובריכה גדולה',
  'בבית כנסת',
  'ובמשרד הקבלה',
  'בשירות ותחזוקה',
  'ולניקיון במשרד',
  'לאימון גופני',
];
for (const sentence of prefixSentences) {
  tests.push({
    input: sentence,
    expectedAction: 'ALLOW',
    desc: `Prefix sentence ALLOW: "${sentence}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 20. UNITS WITH "יחידה" PREFIX
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: 'יחידה 8200',
  expectedAction: 'BLOCK',
  desc: 'Unit: "יחידה 8200"',
});
tests.push({
  input: 'יחידה 3060',
  expectedAction: 'BLOCK',
  desc: 'Unit: "יחידה 3060"',
});

// ═══════════════════════════════════════════════════════════════════
// 21. SPECIFIC UNITS (BLOCK)
// ═══════════════════════════════════════════════════════════════════
const specificUnits = [
  'שלדג', 'דובדבן', 'מגלן', 'אגוז', 'יהלם', 'עוקץ',
  'נחל', 'כפיר',
];
for (const unit of specificUnits) {
  tests.push({
    input: unit,
    expectedAction: 'BLOCK',
    expectedTokens: ['BLOCK'],
    desc: `Specific unit: "${unit}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 22. SAFE COMBO — word order matters
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: 'אנגל אייל',
  expectedAction: 'BLOCK',
  desc: 'Reversed safe combo: "אנגל אייל" — order matters, should BLOCK',
});

// ═══════════════════════════════════════════════════════════════════
// 23. SAFE COMBO — words after combo invalidate it
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: 'שלום אייל אנגל',
  expectedAction: 'ALLOW',
  desc: 'Safe combo at end: "שלום אייל אנגל" → ALLOW',
});
tests.push({
  input: 'אייל אנגל מרפאה',
  expectedAction: 'ALLOW',
  desc: 'Safe combo + word after: "אייל אנגל מרפאה" → ALLOW (combo adjacent)',
});

// ═══════════════════════════════════════════════════════════════════
// 24. MULTIPLE BLOCKED WORDS — one safe, one not
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: 'אייל אנגל סייבר',
  expectedAction: 'BLOCK',
  desc: 'Safe combo + blocked word: "אייל אנגל סייבר" — סייבר still blocks',
});

// ═══════════════════════════════════════════════════════════════════
// 25. BROADER WHITELIST COVERAGE
// ═══════════════════════════════════════════════════════════════════
const moreWhitelist = [
  'שולחן', 'כיסא', 'מחשב', 'מקלדת', 'עכבר', 'מסך', 'מדפסת',
  'טלפון', 'דלת', 'חלון', 'מנורה', 'שעון', 'לוח', 'מפתח',
  'ארון', 'מגירה', 'מדף',
];
for (const word of moreWhitelist) {
  tests.push({
    input: word,
    expectedAction: 'ALLOW',
    desc: `Common whitelist: "${word}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 26. PREFIX ON BLACKLIST — double prefix
// ═══════════════════════════════════════════════════════════════════
const doublePrefixBlacklist: [string, string][] = [
  ['ובמודיעין', 'מודיעין'],
  ['ולפיקוד', 'פיקוד'],
  ['ובסייבר', 'סייבר'],
  ['ולמבצע', 'מבצע'],
];
for (const [prefixed, base] of doublePrefixBlacklist) {
  tests.push({
    input: prefixed,
    expectedAction: 'BLOCK',
    expectedTokens: ['BLOCK'],
    desc: `Double prefix blacklist: "${prefixed}" → "${base}"`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 27. WHITELIST PHRASES — diverse
// ═══════════════════════════════════════════════════════════════════
const diverseWhitelist = [
  'מרפאה', 'תור', 'שירות', 'משרד', 'חניה', 'ספרייה', 'קבלה',
  'יומן', 'מועדון', 'בריכה', 'אולם', 'כיתה', 'הרצאה', 'חובש',
  'רופא', 'חיסון', 'שיניים', 'אהוב',
];
for (const w1 of diverseWhitelist.slice(0, 9)) {
  for (const w2 of diverseWhitelist.slice(9, 18)) {
    tests.push({
      input: `${w1} ${w2}`,
      expectedAction: 'ALLOW',
      desc: `Whitelist pair: "${w1} ${w2}"`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 28. BLACKLIST + WHITELIST MIXED — all combos should BLOCK
// ═══════════════════════════════════════════════════════════════════
const blkSample = ['אלוף', 'סייבר', 'מודיעין', 'פיקוד', 'מבצע'];
const whtSample = ['מרפאה', 'ספרייה', 'תור', 'חניה', 'רופא'];
for (const b of blkSample) {
  for (const w of whtSample) {
    tests.push({
      input: `${w} ${b}`,
      expectedAction: 'BLOCK',
      desc: `Mixed: "${w} ${b}" → BLOCK`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 29. LONG SAFE TEXT (performance sanity)
// ═══════════════════════════════════════════════════════════════════
tests.push({
  input: Array(50).fill('מרפאה ספרייה תור רופא חניה').join(' '),
  expectedAction: 'ALLOW',
  desc: 'Long safe text (250 words) → ALLOW',
});
tests.push({
  input: Array(50).fill('אלוף').join(' ') + ' מרפאה',
  expectedAction: 'BLOCK',
  desc: 'Long block text (51 words) → BLOCK',
});

// ═══════════════════════════════════════════════════════════════════
// 30. COMBINATION DETECTION — individual words from combos
// ═══════════════════════════════════════════════════════════════════
// "רמת דוד" is in combinations — test individual words
tests.push({
  input: 'רמת דוד',
  expectedAction: 'BLOCK',
  expectedTokens: ['BLOCK', 'BLOCK'],
  desc: 'Combo: "רמת דוד" both tokens red',
});

// ═══════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════
let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const t of tests) {
  const r = engine.validate(t.input);

  // Special consistency check
  if ((t as any).expectedAction === 'CHECK_CONSISTENCY') {
    const hasBlock = r.tokens.some((tok) => tok.status === 'BLOCK');
    const ok = hasBlock ? r.action === 'BLOCK' : r.action === 'ALLOW';
    if (ok) {
      passed++;
    } else {
      failed++;
      failures.push(
        `FAIL [${t.desc}]: action=${r.action} but hasBlock=${hasBlock} tokens=[${r.tokens.map((t) => t.status).join(',')}]`,
      );
    }
    continue;
  }

  let ok = r.action === t.expectedAction;
  let detail = '';

  if (!ok) {
    detail = `action: expected=${t.expectedAction} got=${r.action}`;
  }

  if (ok && t.expectedTokens) {
    for (let i = 0; i < t.expectedTokens.length; i++) {
      const expected = t.expectedTokens[i];
      const actual = r.tokens[i]?.status ?? 'MISSING';
      if (actual !== expected) {
        ok = false;
        detail += `token[${i}]: expected=${expected} got=${actual} `;
      }
    }
  }

  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL [${t.desc}]: ${detail} | tokens=[${r.tokens.map((t) => `${t.normalized}:${t.status}`).join(', ')}]`);
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  TOTAL: ${tests.length} | PASSED: ${passed} | FAILED: ${failed}`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length) {
  console.log('Failures:\n');
  for (const f of failures) console.log(`  ${f}`);
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);

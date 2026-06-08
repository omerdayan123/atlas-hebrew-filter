// Self-test: hits the running POC server and exercises the client engine directly.
// Run with: npx tsx scripts/selftest.ts   (server must be running on :8100)
import assert from 'node:assert';

import { ValidationEngine } from '../src/core/validation-engine.js';
import { SyncPayload } from '../src/core/types.js';

const BASE = 'http://127.0.0.1:8100';

interface Case {
  text: string;
  expect: 'BLOCK' | 'ALLOW';
  note: string;
}

const CASES: Case[] = [
  { text: 'מרפאה', expect: 'ALLOW', note: 'civilian clinic (whitelist)' },
  { text: 'חדר כושר', expect: 'ALLOW', note: 'civilian gym' },
  { text: 'תור לרופא', expect: 'ALLOW', note: 'doctor appointment' },
  { text: 'לשכת אלוף', expect: 'BLOCK', note: 'office + senior rank (combination)' },
  { text: 'בלשכת האלוף', expect: 'BLOCK', note: 'same, with prefixes (normalization)' },
  { text: 'יחידת 8200', expect: 'BLOCK', note: 'sensitive unit number' },
  { text: 'חמל צפון', expect: 'BLOCK', note: 'ops room + region (combination)' },
];

function pad(s: string, n: number) {
  return (s + ' '.repeat(n)).slice(0, n);
}

async function main() {
  // 1. Health
  const health = await (await fetch(`${BASE}/health`)).json();
  console.log(
    `\nHEALTH  version=${health.version} blacklist=${health.stats.blacklist} ` +
      `whitelist=${health.stats.whitelist} combos=${health.stats.combinations} ` +
      `bloom=${health.stats.bloomKB}KB payload=${health.stats.payloadKB}KB`,
  );

  // 2. Download sync payload and build the CLIENT engine (exactly like browser)
  const t0 = performance.now();
  const payload = (await (await fetch(`${BASE}/api/security/sync`)).json()) as SyncPayload;
  const syncMs = (performance.now() - t0).toFixed(1);
  const tb = performance.now();
  const engine = new ValidationEngine(payload);
  const buildMs = (performance.now() - tb).toFixed(1);
  console.log(`SYNC    download=${syncMs}ms  buildEngine=${buildMs}ms\n`);

  // 3. Correctness — compare client engine vs server validate
  console.log('--- CORRECTNESS (client engine vs server) ---');
  let pass = 0;
  for (const c of CASES) {
    const client = engine.validate(c.text);
    const server = await (
      await fetch(`${BASE}/api/security/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: c.text }),
      })
    ).json();

    const ok = client.action === c.expect && server.action === c.expect;
    if (ok) pass++;
    const agree = client.action === server.action ? 'agree' : 'DISAGREE';
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${pad(c.text, 16)} expect=${pad(c.expect, 5)} ` +
        `client=${pad(client.action, 5)} server=${pad(server.action, 5)} [${agree}]  ${c.note}`,
    );
  }
  console.log(`\n${pass}/${CASES.length} cases passed\n`);

  // 4. Suggestions
  console.log('--- SUGGESTIONS ---');
  for (const q of ['מר', 'חד', 'תו']) {
    const r = await (await fetch(`${BASE}/api/security/suggest?q=${encodeURIComponent(q)}&limit=5`)).json();
    console.log(`q="${q}"  total=${r.total}  tookMs=${r.tookMs}  -> ${r.suggestions.join(', ')}`);
  }

  // 5. Performance benchmark — client-side validate latency
  console.log('\n--- PERFORMANCE (client-side validate) ---');
  const word = 'מרפאה לשכה אלוף חדר כושר משרד קבלה תור רופא בדיקת דם';
  const inputs: { label: string; text: string }[] = [
    { label: '1 word', text: 'מרפאה' },
    { label: '3 words', text: 'לשכת אלוף מרכזית' },
    { label: '10 words', text: word },
    { label: '50 words', text: Array(5).fill(word).join(' ').split(' ').slice(0, 50).join(' ') },
    { label: '100 words', text: Array(10).fill(word).join(' ').split(' ').slice(0, 100).join(' ') },
  ];
  for (const inp of inputs) {
    const N = 500;
    engine.validate(inp.text); // warm
    const s = performance.now();
    for (let i = 0; i < N; i++) engine.validate(inp.text + (i % 9)); // vary to defeat token cache
    const avg = (performance.now() - s) / N;
    console.log(`${pad(inp.label, 9)} ${avg.toFixed(4)} ms/validate  (${(1000 / avg).toFixed(0)}/sec)`);
  }

  // 6. Bloom false-positive sanity (random non-words should mostly be UNKNOWN)
  console.log('\n--- BLOOM FALSE-POSITIVE CHECK ---');
  let fp = 0;
  const TRIALS = 5000;
  for (let i = 0; i < TRIALS; i++) {
    const rnd = 'zz' + Math.random().toString(36).slice(2, 9);
    const r = engine.validate(rnd);
    if (r.tokens[0]?.status === 'ALLOW') fp++;
  }
  console.log(`false positives: ${fp}/${TRIALS} (${((fp / TRIALS) * 100).toFixed(3)}%) — target ~0.1%`);

  assert(pass === CASES.length, 'Some correctness cases failed');
  console.log('\nALL CHECKS COMPLETE.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

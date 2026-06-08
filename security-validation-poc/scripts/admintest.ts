// Test the admin endpoints: list, add, delete (full roundtrip).
const BASE = "http://127.0.0.1:8100";

async function main() {
  console.log("--- LIST counts ---");
  for (const type of ["blacklist", "whitelist", "combinations"]) {
    const r = await (
      await fetch(`${BASE}/api/admin/lists/${type}?page=1&page_size=3`)
    ).json();
    console.log(
      `${type}: total=${r.total}, sample=${r.items
        .slice(0, 3)
        .map((i: any) => i.term)
        .join(", ")}`,
    );
  }

  console.log('\n--- SEARCH blacklist for "8200" ---');
  const search = await (
    await fetch(`${BASE}/api/admin/lists/blacklist?q=8200`)
  ).json();
  console.log(
    `found ${search.total}: ${search.items.map((i: any) => `${i.term}[${i.normalized}] risk=${i.riskLevel}`).join(", ")}`,
  );

  // Add a test term to blacklist
  const TEST_TERM = "בדיקתאדמין" + Date.now();
  console.log(`\n--- ADD "${TEST_TERM}" to blacklist ---`);
  const add = await (
    await fetch(`${BASE}/api/admin/lists/blacklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: TEST_TERM,
        category: "test",
        notes: "added by test",
      }),
    })
  ).json();
  console.log(
    `add: ok=${add.ok} msg="${add.message}" newVersion=${add.version}`,
  );

  // Verify it now BLOCKs via validate
  console.log(`\n--- VALIDATE "${TEST_TERM}" (should now BLOCK) ---`);
  const val = await (
    await fetch(`${BASE}/api/security/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: TEST_TERM }),
    })
  ).json();
  console.log(`validate: action=${val.action} (expect BLOCK)`);

  // Search for it
  const find = await (
    await fetch(
      `${BASE}/api/admin/lists/blacklist?q=${encodeURIComponent(TEST_TERM)}`,
    )
  ).json();
  console.log(`search after add: found ${find.total}`);

  // Delete it
  console.log(`\n--- DELETE "${TEST_TERM}" ---`);
  const del = await (
    await fetch(`${BASE}/api/admin/lists/blacklist`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: TEST_TERM }),
    })
  ).json();
  console.log(`delete: ok=${del.ok} msg="${del.message}"`);

  // Verify gone
  const gone = await (
    await fetch(
      `${BASE}/api/admin/lists/blacklist?q=${encodeURIComponent(TEST_TERM)}`,
    )
  ).json();
  console.log(`search after delete: found ${gone.total} (expect 0)`);

  // Verify it's ALLOW again
  const val2 = await (
    await fetch(`${BASE}/api/security/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: TEST_TERM }),
    })
  ).json();
  console.log(`validate after delete: action=${val2.action} (expect ALLOW)`);

  const ok =
    add.ok &&
    val.action === "BLOCK" &&
    del.ok &&
    gone.total === 0 &&
    val2.action === "ALLOW";
  console.log(`\n${ok ? "ALL ADMIN TESTS PASSED" : "SOME ADMIN TESTS FAILED"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import assert from "node:assert/strict";
import XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { serpCache } from "../shared/schema.ts";

const sourcePath = "reports/salon-directory-with-second-pilot.xlsx";
const pilotPath = "reports/salon-directory-with-public-web-facebook-pilot.xlsx";
const outputPath = "reports/salon-directory-with-public-web-facebook-reviewed.xlsx";
const sample = [2, 6, 8, 9, 10644, 10648, 10655, 5622, 5633, 5636];
const source = XLSX.readFile(sourcePath);
const workbook = XLSX.readFile(pilotPath);
const sheet = workbook.Sheets["Public web FB pilot"];
assert.ok(sheet, "Missing pilot evidence sheet");
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
const main = XLSX.utils.sheet_to_json(source.Sheets.Sheet1, { header: 1, defval: "" });
assert.deepEqual(rows.slice(1, 11).map(row => row[0]), sample);
const resultRows = [[
  "Workbook row", "Place ID", "Search type", "Exact query", "Cache key",
  "Provider call recorded", "Cache hit in pilot", "Result rank", "Result title",
  "Source URL", "Indexed snippet (not direct verification)", "Email string in snippet",
  "Review status",
]];

const header = [
  "Google Place ID (workbook)",
  "Identity clue: source address",
  "Phone clue (when evidenced)",
  "Public-web search link",
  "Facebook search link",
];
rows[0].push(...header);
for (let index = 0; index < sample.length; index++) {
  const workbookRow = sample[index];
  const identity = main[workbookRow - 1];
  const record = rows[index + 1];
  assert.equal(record[1], identity[0], `Business mismatch on row ${workbookRow}`);
  assert.equal(record[3], identity[2], `Address mismatch on row ${workbookRow}`);
  assert.equal(identity[14], "", `Row ${workbookRow} already has an email`);
  const phoneClue = workbookRow === 9 ? "(323) 991-4102 in matched Facebook post" :
    workbookRow === 2 ? "Earlier indexed Facebook snippet matched phone; number not recorded in this pilot" : "";
  record.push(identity[1], identity[2], phoneClue,
    `https://www.google.com/search?q=${encodeURIComponent(record[13])}`,
    `https://www.google.com/search?q=${encodeURIComponent(record[14])}`);
  assert.equal(record[4] + record[5], 2, `Unexpected call count on row ${workbookRow}`);
  for (const [kind, query, calls, selectedLink] of [
    ["web", record[13], record[4], record[9]],
    ["facebook", record[14], record[5], record[10]],
  ]) {
    const key = `public-web-fb-pilot:v1:${identity[1]}:${kind}`;
    const [cached] = await db.select().from(serpCache).where(and(
      eq(serpCache.queryTemplate, key), eq(serpCache.zipCode, String(identity[8])),
      eq(serpCache.state, identity[7]),
    ));
    assert.ok(cached, `Missing tracked response for ${key}`);
    const results = cached.resultsJson;
    assert.ok(Array.isArray(results), `Invalid cached results for ${key}`);
    for (const [rank, result] of results.entries()) {
      const snippet = String(result.snippet || "");
      const emails = [...new Set(snippet.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])].join("; ");
      resultRows.push([
        workbookRow, identity[1], kind, query, key, calls, 0, rank + 1,
        result.title || "", result.link || "", snippet, emails,
        result.link && result.link === selectedLink
          ? "Source discussed in pilot summary; inspect page and identity before use"
          : "Indexed result only; not a directly verified salon email",
      ]);
    }
    if (!results.length) resultRows.push([
      workbookRow, identity[1], kind, query, key, calls, 0, 0, "", "", "", "",
      "No organic results returned",
    ]);
  }
}
await pool.end();
assert.equal(rows.slice(1, 11).reduce((sum, row) => sum + row[4] + row[5], 0), 20);
workbook.Sheets["Public web FB pilot"] = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(resultRows), "Organic query results");
workbook.Sheets["Organic query results"]["!cols"] = [
  { wch: 16 }, { wch: 32 }, { wch: 16 }, { wch: 85 }, { wch: 75 },
  { wch: 20 }, { wch: 19 }, { wch: 13 }, { wch: 65 }, { wch: 90 },
  { wch: 120 }, { wch: 50 }, { wch: 70 },
];
workbook.Sheets["Organic query results"]["!autofilter"] = { ref: `A1:M${resultRows.length}` };
workbook.Sheets["Public web FB pilot"]["!cols"] = [
  { wch: 17 }, { wch: 38 }, { wch: 8 }, { wch: 47 },
  ...Array.from({ length: 3 }, () => ({ wch: 18 })),
  { wch: 40 }, { wch: 64 }, { wch: 75 }, { wch: 75 },
  { wch: 38 }, { wch: 95 }, { wch: 85 }, { wch: 85 },
  { wch: 32 }, { wch: 47 }, { wch: 65 }, { wch: 85 }, { wch: 85 },
];
workbook.Sheets["Public web FB pilot"]["!autofilter"] = { ref: "A1:T11" };
XLSX.writeFile(workbook, outputPath);

const written = XLSX.readFile(outputPath);
for (const name of source.SheetNames) {
  assert.deepEqual(
    XLSX.utils.sheet_to_json(written.Sheets[name], { header: 1, defval: "" }),
    XLSX.utils.sheet_to_json(source.Sheets[name], { header: 1, defval: "" }),
    `Original sheet changed: ${name}`,
  );
}
const reviewed = XLSX.utils.sheet_to_json(written.Sheets["Public web FB pilot"], { header: 1, defval: "" });
assert.deepEqual(reviewed.slice(1, 11).map(row => row[0]), sample);
assert.equal(reviewed.slice(1, 11).reduce((sum, row) => sum + row[4] + row[5], 0), 20);
const resultAudit = XLSX.utils.sheet_to_json(written.Sheets["Organic query results"], { header: 1, defval: "" });
assert.ok(resultAudit.length >= 21, "Every request must have a result or explicit empty response");
assert.equal(new Set(resultAudit.slice(1).map(row => row[4])).size, 20);
console.log(`Wrote ${outputPath}; all original sheets unchanged; 10 rows, 20 cached tracked requests, ${resultAudit.length - 1} result records.`);
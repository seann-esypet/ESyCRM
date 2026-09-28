const fs = require("fs");
const crypto = require("crypto");
const XLSX = require("xlsx");

const source = XLSX.readFile("attached_assets/0_CRM_Data_CA_NY_TX_Statewide_UNREGISTERED_Grooming_Salons_08_1790473643094.xlsx");
const rows = XLSX.utils.sheet_to_json(source.Sheets.Sheet1, { defval: "" });
const prior = XLSX.readFile("reports/salon-dataforseo-120-pilot.xlsx");
const priorIds = new Set(XLSX.utils.sheet_to_json(prior.Sheets.Sample)
  .map(row => row["Google Place ID"]).filter(Boolean));
const byId = new Map();
for (const [index, row] of rows.entries()) {
  const id = String(row.GooglePlaceID || "").trim();
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push({ row, sourceRow: index + 2 });
}
const buckets = { CA: [], NY: [], TX: [] };
const excludedObviousNonSalon = [];
const obviousNonSalonName = /\b(?:petco|petsmart|pet supplies plus|walgreens|dollar general|family dollar|ace hardware|lowe's market|shop 'n save|laundry room|animal rescue|veterinary|vet services|vet center|vca|whole pets market)\b/i;
for (const [placeId, entries] of byId) {
  const { row, sourceRow } = entries[0];
  if (!buckets[row.varLocationState] || priorIds.has(placeId)) continue;
  if (entries.some(entry => String(entry.row["Email Address"] || "").trim())) continue;
  if (String(row["Business Status"] || "").toUpperCase() !== "OPERATIONAL") continue;
  if (obviousNonSalonName.test(String(row.varLocationName || ""))) {
    excludedObviousNonSalon.push(placeId);
    continue;
  }
  const score = crypto.createHash("sha256").update(`salon-public-web-next-100-v1:${placeId}`).digest("hex");
  buckets[row.varLocationState].push({
    placeId,
    name: row.varLocationName,
    address: row.FormattedAddress,
    city: row.varLocationCity,
    state: row.varLocationState,
    zip: row.varLocationZip,
    sourceRow,
    score,
  });
}
const quotas = { CA: 34, NY: 33, TX: 33 };
const selected = Object.keys(quotas).flatMap(state => {
  if (buckets[state].length < quotas[state]) throw new Error(`Too few eligible ${state} rows`);
  return buckets[state].sort((a, b) => a.score.localeCompare(b.score)).slice(0, quotas[state]);
});
if (selected.length !== 100 || selected.some(row => priorIds.has(row.placeId))) throw new Error("Selection failed");
fs.writeFileSync("reports/salon-public-web-next-100-selection.json", JSON.stringify({
  method: "Deterministic SHA-256 within state from distinct operational Place IDs in the original directory, with blank Email Address across all duplicate rows; exclude all 120 IDs from previous provider pilot",
  sourceRowCount: rows.length,
  excludedPriorPlaceIds: priorIds.size,
  excludedObviousNonSalonPlaceIds: excludedObviousNonSalon.length,
  eligibleByState: Object.fromEntries(Object.entries(buckets).map(([state, list]) => [state, list.length])),
  quotas,
  selected,
}, null, 2));
console.log(JSON.stringify({ selected: selected.length, quotas, eligible: Object.fromEntries(Object.entries(buckets).map(([state, list]) => [state, list.length])), priorIds: priorIds.size }));
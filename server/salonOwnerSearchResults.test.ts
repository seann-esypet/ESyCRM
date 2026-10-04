import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerSearchResponse, readOwnerSearchCache } from "./salonOwnerSearchResults";

test("nested overview lists preserve relevant block citations, not every overview reference", () => {
  const result = parseOwnerSearchResponse({
    ai_overview: {
      text_blocks: [
        { type: "paragraph", snippet: "Puppy Cutz in Detroit." },
        { type: "list", reference_indexes: [7], list: [
          { title: "Details", list: [{ title: "Owner", snippet: "Eric" }] },
        ] },
      ],
      references: [
        { index: 3, title: "Another Salon", link: "https://other.example" },
        { index: 7, title: "Puppy Cutz", link: "https://puppy.example" },
      ],
    },
  }, "Puppy Cutz", "Puppy Cutz Detroit");
  assert.equal(result.results.length, 1);
  assert.match(result.results[0].snippet!, /Puppy Cutz.*\nOwner: Eric/);
  assert.deepEqual(result.results[0].citations?.map(item => item.link), ["https://puppy.example/"]);
});

test("unrelated overview, unrelated citation and unrelated sections cannot borrow target relevance", () => {
  const cases = [
    [{ type: "paragraph", snippet: "Other Salon. Owner: Rachel" }],
    [{ type: "paragraph", snippet: "Puppy Cutz in Detroit." }, { type: "heading", snippet: "Other Salon" }, { type: "list", list: [{ title: "Owner", snippet: "Rachel" }] }],
    [{ type: "paragraph", snippet: "Puppy Cutz in Detroit." }, { type: "list", list: [{ title: "Owner", snippet: "Rachel", reference_indexes: [0] }] }],
  ];
  for (const text_blocks of cases) {
    const result = parseOwnerSearchResponse({ ai_overview: {
      text_blocks, references: [{ index: 0, title: "Other Salon", snippet: "Owner Rachel", link: "https://other.example" }],
    } }, "Puppy Cutz", "Puppy Cutz Detroit");
    assert.deepEqual(result.results, []);
  }
});

test("malformed payloads are bounded, unsupported citation URLs are not clickable, and legacy caches remain readable", () => {
  for (const payload of [null, "invalid", { ai_overview: { text_blocks: "invalid" }, organic_results: null }]) {
    assert.deepEqual(parseOwnerSearchResponse(payload, "Puppy Cutz", "query"), { results: [] });
  }
  const result = parseOwnerSearchResponse({ ai_overview: {
    text_blocks: [{ type: "paragraph", snippet: "Puppy Cutz. Owner: Eric", reference_indexes: [0] }],
    references: [{ index: 0, title: "Puppy Cutz", link: "javascript:alert(1)" }],
  } }, "Puppy Cutz", "query");
  assert.deepEqual(result.results[0].citations, []);
  assert.equal(result.results[0].summaryKind, "google_ai_overview");
  const legacy = [{ title: "Puppy Cutz", snippet: "Owner: Eric" }];
  assert.deepEqual(readOwnerSearchCache(legacy), { results: legacy });
  assert.deepEqual(readOwnerSearchCache({ version: 2, ...result }), result);
});
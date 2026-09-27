import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildGoogleMapsParams, parseGoogleMapsResults } from "./lead-discovery";
import { strongMatch } from "./salonEnrichment";

const row = {
  businessName: "Paws Grooming",
  placeId: "ChIJsamplePlaceId",
  address: "12 Main Street, Austin, TX 78701",
  address1: "12 Main Street",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

test("Place ID lookup uses the exact ID without a broad search query", () => {
  const params = buildGoogleMapsParams("test-key", '"Paws Grooming"', "78701", row.placeId);
  assert.equal(params.get("engine"), "google_maps");
  assert.equal(params.get("type"), "place");
  assert.equal(params.get("place_id"), row.placeId);
  assert.equal(params.has("q"), false);
});

test("rows without Place IDs retain the existing Google Maps search", () => {
  const params = buildGoogleMapsParams("test-key", '"Paws Grooming"', "78701");
  assert.equal(params.get("type"), "search");
  assert.equal(params.get("q"), '"Paws Grooming" 78701');
  assert.equal(params.has("place_id"), false);
});

test("a Place Details response supplies the official website and phone", () => {
  const [place] = parseGoogleMapsResults({
    place_results: {
      title: "Paws Grooming",
      address: "12 Main Street Austin TX 78701",
      place_id: row.placeId,
      data_id: "0x123:0x456",
      website: "https://paws.example",
      phone: "(512) 555-0134",
    },
  });
  assert.equal(place.placeId, row.placeId);
  assert.equal(place.link, "https://paws.example");
  assert.equal(place.phone, "(512) 555-0134");
  assert.equal(strongMatch(row, place), true);
});

test("a provider data_id is never mistaken for a Google Place ID", () => {
  const [place] = parseGoogleMapsResults({
    place_results: {
      title: row.businessName,
      address: row.address,
      data_id: "0x123:0x456",
    },
  });
  assert.equal(place.placeId, undefined);
  assert.equal(strongMatch(row, place), true); // name and address, not ID
});

test("matching Place IDs establish the business identity", () => {
  assert.equal(strongMatch(row, {
    title: "Paws Grooming LLC",
    address: "12 Main St, Austin TX 78701",
    placeId: row.placeId,
  }), true);
});

test("a conflicting Place ID is rejected even if the name and address match", () => {
  assert.equal(strongMatch(row, {
    title: row.businessName,
    address: row.address,
    placeId: "ChIJotherPlace",
  }), false);
});

test("a listing without a Place ID needs a strong name and address match", () => {
  assert.equal(strongMatch(row, {
    title: "Paws Grooming",
    address: "12 Main Street Austin TX 78701",
  }), true);
  assert.equal(strongMatch(row, {
    title: "Another Pet Store",
    address: "12 Main Street Austin TX 78701",
  }), false);
});
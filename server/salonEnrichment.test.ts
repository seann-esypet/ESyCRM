import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildGoogleMapsParams, crawlWebsite, parseGoogleMapsResults } from "./lead-discovery";
import { strongMatch } from "./salonEnrichment";
import { bookingPlatformForUrl, extractSalonEmailFromBookingHtml, findSalonEmailOnBookingPage, importableSalonEmail } from "./bookingPageEmail";

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

test("a hosted booking link is not mistaken for the salon's website", () => {
  assert.equal(bookingPlatformForUrl("https://groomer.io/request/4furm"), "Groomer.io");
  assert.equal(bookingPlatformForUrl("https://www.booksy.com/en-us/123"), "Booksy");
  assert.equal(bookingPlatformForUrl("https://www.my-grooming-salon.example/contact"), null);
  assert.equal(bookingPlatformForUrl("https://notbooksy.com/contact"), null);
});

const bookingUrl = "https://groomer.io/request/4furm";

test("salon email on a matching booking page can be reviewed for import", () => {
  const html = `<body><h1>DoggyStyle Salon</h1><main>
    <a href="mailto:hello@doggystylesalon.com">Email the salon</a>
    </main><footer>support@groomer.io</footer></body>`;
  const email = extractSalonEmailFromBookingHtml(html, "Doggy Style Salon", bookingUrl);
  assert.equal(email, "hello@doggystylesalon.com");
  const row = {
    email, bookingUrl, websiteUrl: null, identityMatchStatus: "strong", reviewStatus: "approved",
    evidence: { email: { value: email, source: "booking_page", confidence: "medium", sourceUrl: bookingUrl } },
  } as Parameters<typeof importableSalonEmail>[0];
  assert.equal(importableSalonEmail(row), email);
  assert.equal(importableSalonEmail({ ...row, reviewStatus: "needs_review" }), null);
  assert.equal(importableSalonEmail({ ...row, bookingUrl: "https://booksy.com/another-salon" }), null);
  assert.equal(importableSalonEmail({ ...row, email: "different@doggystylesalon.com" }), null);
});

test("an approved email from a matched alternate salon website can be imported", () => {
  const email = "hello@pawssalon.example";
  const sourceUrl = "https://pawssalon.example/contact";
  const emailEvidence = { value: email, source: "serp_fallback_website", confidence: "medium", sourceUrl };
  const row = {
    email, websiteUrl: "https://pawssalon.example/", bookingUrl: null,
    identityMatchStatus: "strong", reviewStatus: "approved",
    evidence: { email: emailEvidence },
  } as Parameters<typeof importableSalonEmail>[0];
  assert.equal(importableSalonEmail(row), email);
  assert.equal(importableSalonEmail({ ...row, reviewStatus: "needs_review" }), null);
  assert.equal(importableSalonEmail({ ...row, identityMatchStatus: "unmatched" }), null);
  assert.equal(importableSalonEmail({ ...row, email: "another@pawssalon.example" }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...emailEvidence, sourceUrl: "https://book.cuddlesapp.com/salon" } } }), null);
  assert.equal(importableSalonEmail({ ...row, evidence: { email: { ...emailEvidence, sourceUrl: "http://pawssalon.example" } } }), null);
});

test("booking providers and unrelated salons cannot supply a sequence email", () => {
  const boilerplate = `<body><h1>DoggyStyle Salon</h1><main>Book now</main>
    <script>const email="owner@doggystylesalon.com"</script>
    <footer><a href="mailto:support@groomer.io">Help</a></footer></body>`;
  assert.equal(extractSalonEmailFromBookingHtml(boilerplate, "Doggy Style Salon", bookingUrl), null);
  assert.equal(extractSalonEmailFromBookingHtml(
    `<body><h1>Another Salon</h1><p>owner@doggystylesalon.com</p></body>`,
    "Doggy Style Salon", bookingUrl,
  ), null);
  assert.equal(extractSalonEmailFromBookingHtml(
    `<body><h1>DoggyStyle Salon</h1><p>support@groomer.io</p></body>`,
    "Doggy Style Salon", bookingUrl,
  ), null);
});

test("booking email lookup requests only the exact page and never follows a redirect", async () => {
  const originalFetch = globalThis.fetch;
  const visited: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      visited.push(String(input));
      return new Response(`<body><h1>DoggyStyle Salon</h1><p>salon@doggystylesalon.com</p></body>`, {
        headers: { "content-type": "text/html" },
      });
    };
    assert.equal(await findSalonEmailOnBookingPage(bookingUrl, "Doggy Style Salon"), "salon@doggystylesalon.com");
    assert.deepEqual(visited, [bookingUrl]);
    globalThis.fetch = async (input) => {
      visited.push(String(input));
      return new Response(null, { status: 302, headers: { location: "https://groomer.io/contact" } });
    };
    assert.equal(await findSalonEmailOnBookingPage(bookingUrl, "Doggy Style Salon"), null);
    assert.deepEqual(visited, [bookingUrl, bookingUrl]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a site-builder image beside grooming copy is not a booking link", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(`<body><h1>Felix's Pet Grooming</h1>
      <p>Book your grooming appointment by calling 323-585-2670.</p>
      <img src="https://sites.google.com/sitesv-images-rt/image-id">
      <p>felixdoggrooming@gmail.com</p></body>`, {
      headers: { "content-type": "text/html" },
    });
    const result = await crawlWebsite("https://sites.google.com/view/felixspetgrooming/home");
    assert.equal(result.email, "felixdoggrooming@gmail.com");
    assert.equal(result.bookingUrl, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Google Sites redirect to a salon booking page keeps the destination", async () => {
  const originalFetch = globalThis.fetch;
  const destination = "https://book.cuddlesapp.com/felix-s-pet-grooming";
  try {
    globalThis.fetch = async () => new Response(`<body><h1>Felix's Pet Grooming</h1>
      <a href="https://www.google.com/url?q=https%3A%2F%2Fbook.cuddlesapp.com%2Ffelix-s-pet-grooming&amp;sa=D">Book now</a>
      <p>felixdoggrooming@gmail.com — 323-585-2670</p></body>`);
    const result = await crawlWebsite("https://sites.google.com/view/felixspetgrooming/home");
    assert.equal(result.bookingUrl, destination);
    assert.equal(result.softwareName, "CuddlesApp");
    assert.equal(bookingPlatformForUrl(destination), "CuddlesApp");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
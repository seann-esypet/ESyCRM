import { strict as assert } from "node:assert";
import { test } from "node:test";
import { crawlWebsite } from "./lead-discovery";
import { fetchPublicPage, type SalonFetchRuntime } from "./salonPublicFetch";

function runtimeFor(
  handler: (url: URL) => { status?: number; location?: string; body?: string },
  resolve?: SalonFetchRuntime["resolve"],
): { runtime: SalonFetchRuntime; visits: string[] } {
  const visits: string[] = [];
  return {
    visits,
    runtime: {
      resolve: resolve ?? (async () => [{ address: "8.8.8.8", family: 4 }]),
      request: async url => {
        visits.push(url.href);
        const result = handler(url);
        return {
          status: result.status ?? 200,
          headers: result.location ? { location: result.location } : {},
          body: result.body ?? "",
        };
      },
    },
  };
}

test("safe page fetch blocks private literals, private DNS answers, and unsafe redirects", async () => {
  let requestCount = 0;
  const privateRuntime: SalonFetchRuntime = {
    resolve: async () => [{ address: "10.1.2.3", family: 4 }],
    request: async () => { requestCount++; return { status: 200, headers: {}, body: "no" }; },
  };
  await assert.rejects(fetchPublicPage("https://salon.example/", { runtime: privateRuntime }), /private or reserved/);
  await assert.rejects(fetchPublicPage("http://127.0.0.1/", { runtime: privateRuntime }), /private or reserved/);
  assert.equal(requestCount, 0);

  const reboundRuntime = runtimeFor(
    url => ({ status: 302, location: "https://www.salon.example/" }),
    async hostname => hostname.startsWith("www.")
      ? [{ address: "192.168.1.4", family: 4 }]
      : [{ address: "8.8.8.8", family: 4 }],
  );
  await assert.rejects(fetchPublicPage("https://salon.example/", {
    runtime: reboundRuntime.runtime,
    allowedHosts: ["salon.example", "www.salon.example"],
  }), /private or reserved/);
  assert.deepEqual(reboundRuntime.visits, ["https://salon.example/"]);

  const redirectRuntime = runtimeFor(url => url.hostname === "salon.example"
    ? { status: 302, location: "http://127.0.0.1/admin" }
    : { body: "unexpected" });
  await assert.rejects(fetchPublicPage("https://salon.example/", {
    runtime: redirectRuntime.runtime,
    allowedHosts: ["salon.example"],
  }), /outside the submitted site/);
  assert.deepEqual(redirectRuntime.visits, ["https://salon.example/"]);

  const oversized = runtimeFor(() => ({ body: "0123456789" }));
  await assert.rejects(fetchPublicPage("https://salon.example/", {
    runtime: oversized.runtime,
    maxBytes: 4,
  }), /size limit/);

  const jsonResponse: SalonFetchRuntime = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => ({
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: `{"email":"fake@salon.example"}`,
    }),
  };
  await assert.rejects(fetchPublicPage("https://salon.example/", { runtime: jsonResponse }), /Unsupported page content type application\/json/);

  const legacyHtml: SalonFetchRuntime = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => ({ status: 200, headers: {}, body: "<p>legacy html</p>" }),
  };
  const accepted = await fetchPublicPage("https://salon.example/", { runtime: legacyHtml });
  assert.equal(accepted.body, "<p>legacy html</p>");
});

test("crawl recovers canonical protocol/host variants and discovered contact slash variants", async () => {
  const mocked = runtimeFor(url => {
    if (url.href === "https://www.paws.test/") {
      return { body: `<a href="/our-contact">Contact us</a><a href="https://vendor.example/support">Support</a>` };
    }
    if (url.href === "https://www.paws.test/our-contact/") {
      return { body: `<h1>Contact</h1><a href="mailto:hello&#64;paws.test">Email us</a>` };
    }
    return { status: 404, body: "missing" };
  });
  const result = await crawlWebsite("http://paws.test", { runtime: mocked.runtime });
  assert.equal(result.resolvedWebsiteUrl, "https://www.paws.test/");
  assert.equal(result.email, "hello@paws.test");
  assert.equal(result.emailSourceUrl, "https://www.paws.test/our-contact/");
  assert.equal(result.emailSourceType, "mailto");
  assert.ok(mocked.visits.includes("https://www.paws.test/our-contact"));
  assert.ok(mocked.visits.includes("https://www.paws.test/our-contact/"));
  assert.equal(mocked.visits.some(url => url.includes("vendor.example")), false);
});

test("Cloudflare visible email is attributed, metadata stays review-only, and purpose/vendor false positives are not promoted", async () => {
  const email = "hello@citybark.test";
  const key = 0x42;
  const encoded = [key, ...Array.from(email).map(character => character.charCodeAt(0) ^ key)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const mocked = runtimeFor(url => {
    if (url.href === "https://citybark.test/") return {
      body: `<meta name="email" content="owner@citybark.test">
        <span class="__cf_email__" data-cfemail="${encoded}"></span>
        <p>For vaccination records and proof, email records@citybark.test</p>`,
    };
    return { status: 404 };
  });
  const result = await crawlWebsite("https://citybark.test/", { runtime: mocked.runtime });
  assert.equal(result.email, email);
  assert.equal(result.emailSourceType, "cloudflare");
  assert.equal(result.emailSourceUrl, "https://citybark.test/");
  assert.equal(result.metadataEmail, "owner@citybark.test");
  assert.equal(result.metadataEmailSourceUrl, "https://citybark.test/");
  assert.ok(result.partialFailures.some(failure => /404/.test(failure)));
});

test("script-only mailto is metadata-only and mailto recipient parsing yields valid email tokens", async () => {
  const scriptOnly = runtimeFor(() => ({
    body: `<script>const link = '<a href="mailto:hidden@script.test">Email</a>';</script>
      <main><h1>Salon</h1></main>`,
  }));
  const scriptResult = await crawlWebsite("https://script.test/", { runtime: scriptOnly.runtime });
  assert.equal(scriptResult.email, undefined);
  assert.equal(scriptResult.metadataEmail, "hidden@script.test");

  const recipientList = runtimeFor(() => ({
    body: `<a href="mailto:Salon Team &lt;hello@recipients.test&gt;, other@recipients.test?subject=Hello">Email</a>`,
  }));
  const recipientResult = await crawlWebsite("https://recipients.test/", { runtime: recipientList.runtime });
  assert.equal(recipientResult.email, "hello@recipients.test");
  assert.equal(recipientResult.emailSourceType, "mailto");
});

test("encoded Cloudflare mailbox explicitly restricted to vaccination records is not promoted", async () => {
  const email = "records@purpose.test";
  const key = 0x37;
  const encoded = [key, ...Array.from(email).map(character => character.charCodeAt(0) ^ key)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const mocked = runtimeFor(() => ({
    body: `<p>For vaccination records and proof, send documents to
      <span class="__cf_email__" data-cfemail="${encoded}">[email protected]</span></p>`,
  }));
  const result = await crawlWebsite("https://purpose.test/", { runtime: mocked.runtime });
  assert.equal(result.email, undefined);
  assert.equal(result.metadataEmail, undefined);

  const encodedMailto = runtimeFor(() => ({
    body: `<p>For vaccination records and proof, email <a href="mailto:records%40purpose-mailto.test">the records desk</a></p>`,
  }));
  const mailtoResult = await crawlWebsite("https://purpose-mailto.test/", { runtime: encodedMailto.runtime });
  assert.equal(mailtoResult.email, undefined);
  assert.equal(mailtoResult.metadataEmail, undefined);
});

test("metadata-only address never becomes the primary email and booking platforms are not crawled", async () => {
  const mocked = runtimeFor(url => url.href === "https://metadata.test/"
    ? { body: `<html><head><meta property="og:email" content="hello@metadata.test"></head><body><h1>Salon</h1></body></html>` }
    : { status: 404 });
  const result = await crawlWebsite("https://metadata.test/", { runtime: mocked.runtime });
  assert.equal(result.email, undefined);
  assert.equal(result.metadataEmail, "hello@metadata.test");
  assert.equal(result.metadataEmailSourceUrl, "https://metadata.test/");

  const vendor = runtimeFor(() => ({ body: "must not fetch" }));
  await assert.rejects(
    crawlWebsite("https://www.booksy.com/en-us/salon", { runtime: vendor.runtime }),
    /booking or social platform/,
  );
  assert.deepEqual(vendor.visits, []);
});

test("fetch timeout is a wall-clock deadline for a never-ending or late response", async () => {
  const never: SalonFetchRuntime = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => new Promise(() => {}),
  };
  const start = Date.now();
  await assert.rejects(fetchPublicPage("https://hang.test/", { runtime: never, timeoutMs: 25 }), /timed out/);
  assert.ok(Date.now() - start < 500);

  const late: SalonFetchRuntime = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => new Promise(resolve => setTimeout(
      () => resolve({ status: 200, headers: {}, body: "too late" }), 60,
    )),
  };
  await assert.rejects(fetchPublicPage("https://late.test/", { runtime: late, timeoutMs: 10 }), /timed out/);
});

test("out-of-range and surrogate numeric entities are preserved without throwing", async () => {
  const mocked = runtimeFor(() => ({
    body: `<p>&#999999999999999999999999999999; &#xD800;</p><p>hello@entities.test</p>`,
  }));
  const result = await crawlWebsite("https://entities.test/", { runtime: mocked.runtime });
  assert.equal(result.email, "hello@entities.test");
  assert.match(result.html, /&#999999999999999999999999999999;/);
  assert.match(result.html, /&#xD800;/);
});

test("crawl reports detailed failures and enforces a bounded request budget", async () => {
  const mocked = runtimeFor(() => ({ status: 503, body: "unavailable" }));
  await assert.rejects(
    crawlWebsite("https://down.test/", { runtime: mocked.runtime }),
    error => {
      assert.match(String(error), /Unable to fetch website/);
      assert.match(String(error), /HTTP 503/);
      return true;
    },
  );
  assert.ok(mocked.visits.length <= 12);
});
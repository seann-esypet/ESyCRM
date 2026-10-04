import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OwnerNameReview } from "../client/src/components/owner-name-review";
import { EMPTY_OWNER_NAME_RESULT } from "@shared/salonOwnerName";

test("owner review renders stronger section borders and explains saved legacy timeouts", () => {
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, {
      client,
      children: createElement(OwnerNameReview, {
        rowId: "fixture",
        businessName: "Example Salon",
        ownerName: {
          ...EMPTY_OWNER_NAME_RESULT,
          status: "failed",
          providerCalls: 1,
          pagesFetched: 0,
          error: "The operation was aborted due to timeout",
        },
        sequences: [{ id: "fixture-sequence", subject: "Example" }],
      }),
    }));
    assert.match(html, /border-2 border-slate-400/);
    assert.match(html, /border-2 border-red-400/);
    assert.match(html, /border-t-2 border-slate-400/);
    assert.match(html, /owner lookup timed out before completing/);
    assert.match(html, /reviewed email is unchanged/);
    assert.match(html, /retry may use another lookup credit/);
    assert.doesNotMatch(html, /The operation was aborted due to timeout/);
  } finally { client.clear(); }
});

test("owner review displays first-name AI suggestions and citations without enabling approval", () => {
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, {
      client,
      children: createElement(OwnerNameReview, {
        rowId: "fixture",
        businessName: "Puppy Cutz",
        ownerName: {
          ...EMPTY_OWNER_NAME_RESULT,
          status: "needs_review",
          providerCalls: 1,
          candidates: [{
            id: "owner-eric", firstName: "Eric", lastName: null,
            role: "Unconfirmed Google AI Overview mention",
            roleConfirmed: false, businessMatched: false, confidence: "low",
            sources: [
              { kind: "google_ai_overview", url: "https://www.google.com/search?q=Puppy+Cutz", excerpt: "Puppy Cutz. Groomer / Owner: Eric" },
              { kind: "google_ai_citation", url: "https://fixture.example/puppy-cutz", excerpt: "AI Overview citation (not yet verified): Puppy Cutz" },
            ],
          }],
        },
        sequences: [],
      }),
    }));
    assert.match(html, /Eric/);
    assert.match(html, /Google AI Overview · unverified suggestion/);
    assert.match(html, /AI Overview citation · not yet verified/);
    assert.match(html, /A citation is not proof of ownership/);
    assert.match(html, /href="https:\/\/fixture.example\/puppy-cutz"/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>.*?Approve selected owner/s);
    assert.doesNotMatch(html, /Owner approved/);
  } finally { client.clear(); }
});
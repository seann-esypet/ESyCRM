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
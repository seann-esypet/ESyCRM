import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SalesLeadListUpload from "../client/src/components/sales-lead-list-upload";

test("sales lead upload explains the ordinary Excel/CSV path without implying approval or sending", () => {
  const html = renderToStaticMarkup(createElement(SalesLeadListUpload, { onSuccess: () => {} }));
  assert.match(html, /Upload a Lead List/);
  assert.match(html, /CSV or Excel/);
  assert.match(html, /id="sales-lead-list-file"/);
  assert.match(html, /Uploaded emails and names are unverified/);
  assert.match(html, /No contacts are imported, no paid lookups run, and no emails are sent/);
  assert.match(html, /border-2 border-slate-400/);
  assert.doesNotMatch(html, /Upload JSON report|Load reviewed pilot/);
});
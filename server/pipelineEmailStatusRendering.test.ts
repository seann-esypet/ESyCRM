import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PipelineEmailStatus from "../client/src/components/deals/pipeline-email-status";
import type { PipelineEmailSummary } from "@shared/pipelineEmailSummary";

const summary: PipelineEmailSummary = {
  contactId: "fixture", contactState: "available", email: "fixture@example.test",
  sequenceStatus: "not_enrolled", logCount: 0, sentCount: 0, latestSentAt: null,
  scheduledCount: 0, processingCount: 0, failedCount: 0, nextScheduledAt: null,
  historyUncertain: false,
};
const props = {
  contactId: "fixture", summary, email: summary.email,
  contactKnown: true, contactsLoading: false, loading: false, failed: false,
  onRetry: () => {}, onOpenHistory: () => {},
};

test("not enrolled and scheduled statuses are bold, distinct and have non-color cues in both sizes", () => {
  for (const compact of [false, true]) {
    const empty = renderToStaticMarkup(createElement(PipelineEmailStatus, { ...props, compact }));
    const scheduled = renderToStaticMarkup(createElement(PipelineEmailStatus, {
      ...props, compact, summary: { ...summary, sequenceStatus: "scheduled", logCount: 1, scheduledCount: 1 },
    }));
    for (const html of [empty, scheduled]) {
      assert.match(html, /data-pipeline-sequence-status-label/);
      assert.match(html, /text-sm font-bold/);
      assert.match(html, /min-h-7/);
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /No recorded emails sent/);
      assert.match(html, /aria-label="Email history"/);
    }
    assert.match(empty, /data-pipeline-sequence-status="Not in a sequence"/);
    assert.match(empty, /bg-amber-100/);
    assert.match(empty, /lucide-circle-minus/);
    assert.match(scheduled, /data-pipeline-sequence-status="Scheduled"/);
    assert.match(scheduled, /bg-sky-100/);
    assert.match(scheduled, /lucide-calendar-clock/);
    assert.match(scheduled, /Next email is scheduled, not yet sent/);
    assert.match(empty, /dark:text-amber-100/);
    assert.match(scheduled, /dark:text-sky-100/);
  }
});

test("scheduled status remains separate from previous recorded sends", () => {
  const html = renderToStaticMarkup(createElement(PipelineEmailStatus, {
    ...props, summary: {
      ...summary, sequenceStatus: "scheduled", logCount: 2, sentCount: 1,
      scheduledCount: 1, latestSentAt: "2026-10-01T14:00:00.000Z",
    },
  }));
  assert.match(html, /data-pipeline-sequence-status="Scheduled"/);
  assert.match(html, /1 recorded sent/);
});

test("loading, failure and missing contacts never acquire a not-enrolled or scheduled treatment", () => {
  for (const overrides of [{ loading: true }, { failed: true }, { contactId: null }]) {
    const html = renderToStaticMarkup(createElement(PipelineEmailStatus, { ...props, ...overrides }));
    assert.doesNotMatch(html, /bg-amber-100|bg-sky-100/);
    if ("loading" in overrides) assert.match(html, /Loading sequence status/);
    else assert.match(html, /Status unavailable/);
    if ("failed" in overrides) assert.match(html, /Retry email status/);
    if ("contactId" in overrides) assert.match(html, /disabled=""/);
  }
});

test("other sequence statuses and uncertain history remain explicit", () => {
  const cases = [
    ["sending", "Sending"],
    ["failed", "Failed attempt"],
    ["reply_stopped", "Stopped after reply"],
    ["historical", "Previously enrolled"],
  ] as const;
  for (const [sequenceStatus, label] of cases) {
    const html = renderToStaticMarkup(createElement(PipelineEmailStatus, {
      ...props, summary: { ...summary, sequenceStatus, logCount: 1, historyUncertain: true },
    }));
    assert.match(html, new RegExp(`data-pipeline-sequence-status="${label}"`));
    assert.match(html, /History incomplete\/unknown/);
    assert.doesNotMatch(html, /bg-amber-100|bg-sky-100/);
  }
});
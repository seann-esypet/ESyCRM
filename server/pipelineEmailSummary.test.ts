import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPipelineEmailSummaries, loadPipelineEmailSummaries, pipelineEmailQueryScope,
  summarizePipelineContact, PIPELINE_SUMMARY_BATCH_SIZE,
  type PipelineEmailLog, type PipelineSummaryRepository,
} from "./pipelineEmailSummary";
import { matchesPipelineEmailFilters } from "../shared/pipelineEmailSummary";

const contact = { id: "c1", userId: "owner-a", email: "salon@example.test" };
const sentDate = "2026-10-01T14:00:00.000Z";
const scheduledDate = "2026-10-05T14:00:00.000Z";
function log(overrides: Partial<PipelineEmailLog> = {}): PipelineEmailLog {
  return {
    id: "l1", contactId: contact.id, userId: contact.userId, status: "pending",
    sentAt: null, scheduledSendAt: scheduledDate, emailResponseReceived: "false", brevoMessageId: null,
    ...overrides,
  };
}

test("no logs confirms no enrollment and no recorded sends", () => {
  const result = summarizePipelineContact(contact.id, contact, []);
  assert.equal(result.sequenceStatus, "not_enrolled");
  assert.equal(result.sentCount, 0);
  assert.equal(result.logCount, 0);
  assert.equal(result.historyUncertain, false);
});

for (const [status, sequenceStatus] of [["pending", "scheduled"], ["processing", "sending"], ["failed", "failed"]]) {
  test(`${status} attempts are participation, not successful sends`, () => {
    const result = summarizePipelineContact(contact.id, contact, [log({ status })]);
    assert.equal(result.sequenceStatus, sequenceStatus);
    assert.equal(result.logCount, 1);
    assert.equal(result.sentCount, 0);
    assert.equal(result.latestSentAt, null);
    assert.equal(result.failedCount, status === "failed" ? 1 : 0);
  });
}

test("successful sends are retained alongside scheduled, processing and failed later steps", () => {
  for (const status of ["pending", "processing", "failed"]) {
    const result = summarizePipelineContact(contact.id, contact, [
      log({ id: "sent", status: "sent", sentAt: sentDate }), log({ status }),
    ]);
    assert.equal(result.sentCount, 1);
    assert.equal(result.latestSentAt, sentDate);
    assert.notEqual(result.sequenceStatus, "not_enrolled");
  }
});

test("reply-stopped logs retain previously sent evidence without inventing delivery", () => {
  const result = summarizePipelineContact(contact.id, contact, [
    log({ status: "replied", sentAt: sentDate, emailResponseReceived: "true" }),
  ]);
  assert.equal(result.sequenceStatus, "reply_stopped");
  assert.equal(result.sentCount, 1);
  assert.equal(result.latestSentAt, sentDate);
  assert.equal("deliveredCount" in result, false);
});

test("a reply without outbound evidence is ambiguous, never a fabricated send", () => {
  const result = summarizePipelineContact(contact.id, contact, [log({ status: "replied" })]);
  assert.equal(result.sequenceStatus, "reply_stopped");
  assert.equal(result.sentCount, 0);
  assert.equal(result.historyUncertain, true);
  assert.equal(matchesPipelineEmailFilters(result, "all", "none"), false);
});

test("finished or historical send logs remain previously enrolled", () => {
  const result = summarizePipelineContact(contact.id, contact, [
    log({ status: "sent", sentAt: sentDate }),
  ]);
  assert.equal(result.sequenceStatus, "historical");
  assert.equal(result.sentCount, 1);
});

test("recorded successful sends with a missing date remain known, but date stays unknown", () => {
  const result = summarizePipelineContact(contact.id, contact, [log({ status: "sent" })]);
  assert.equal(result.sentCount, 1);
  assert.equal(result.latestSentAt, null);
  assert.equal(result.historyUncertain, false);
});

test("persisted send evidence survives a subsequent status change in the same record", () => {
  for (const status of ["pending", "processing", "failed", "replied"]) {
    const result = summarizePipelineContact(contact.id, contact, [log({ status, sentAt: sentDate })]);
    assert.equal(result.sentCount, 1);
    assert.equal(result.latestSentAt, sentDate);
  }
  assert.equal(summarizePipelineContact(contact.id, contact,
    [log({ status: "replied", brevoMessageId: "provider-accepted-id" })]).sentCount, 1);
});

test("invalid dates and unknown historical status cannot confirm absence of emails", () => {
  for (const record of [log({ status: "stopped" }), log({ status: "failed", sentAt: "invalid" })]) {
    const result = summarizePipelineContact(contact.id, contact, [record]);
    assert.equal(result.sentCount, 0);
    assert.equal(result.latestSentAt, null);
    assert.equal(result.historyUncertain, true);
  }
});

test("multiple strategy/track records are counted once each, independently from contact classification", () => {
  const records = [
    log({ id: "legacy-sent", status: "sent", sentAt: sentDate }),
    log({ id: "directory-sent", status: "sent", sentAt: "2026-10-02T14:00:00.000Z" }),
    log({ id: "directory-pending" }),
  ];
  const result = summarizePipelineContact(contact.id, contact, records.concat(records[0]));
  assert.equal(result.logCount, 3);
  assert.equal(result.sentCount, 2);
  assert.equal(result.latestSentAt, "2026-10-02T14:00:00.000Z");
  assert.equal(result.sequenceStatus, "scheduled");
  assert.equal(result.nextScheduledAt, scheduledDate);
});

test("next schedule is the earliest pending date, not an earlier sent or failed step", () => {
  const result = summarizePipelineContact(contact.id, contact, [
    log({ id: "later", scheduledSendAt: "2026-10-19T13:30:27.000Z" }),
    log({ id: "next", scheduledSendAt: "2026-10-12T13:30:27.000Z" }),
    log({ id: "sent", status: "sent", sentAt: sentDate, scheduledSendAt: sentDate }),
    log({ id: "failed", status: "failed", scheduledSendAt: sentDate }),
  ]);
  assert.equal(result.nextScheduledAt, "2026-10-12T13:30:27.000Z");
  assert.equal(result.scheduledCount, 2);
  assert.equal(summarizePipelineContact(contact.id, contact, [
    log({ status: "sent", sentAt: sentDate }),
  ]).nextScheduledAt, null);
});

test("missing current email does not erase history, while unavailable contacts never expose logs", () => {
  const missingEmail = summarizePipelineContact(contact.id, { ...contact, email: null },
    [log({ status: "sent", sentAt: sentDate })]);
  assert.equal(missingEmail.email, null);
  assert.equal(missingEmail.sentCount, 1);
  const missingContact = summarizePipelineContact(contact.id, undefined, [log({ status: "sent", sentAt: sentDate })]);
  assert.equal(missingContact.contactState, "unavailable");
  assert.equal(missingContact.sequenceStatus, "unavailable");
  assert.equal(missingContact.sentCount, 0);
});

test("salespeople cannot override their owner scope; administrator filters apply consistently", () => {
  assert.equal(pipelineEmailQueryScope("salesperson", "owner-a", "owner-b"), "owner-a");
  assert.equal(pipelineEmailQueryScope("salesperson", "owner-a", undefined), "owner-a");
  assert.equal(pipelineEmailQueryScope("admin", "admin-id", "owner-b"), "owner-b");
  assert.equal(pipelineEmailQueryScope("admin", "admin-id", undefined), null);
  assert.equal(pipelineEmailQueryScope("admin", "admin-id", ["owner-b"]), null);
});

test("foreign contacts and foreign-owner logs are filtered even if a repository returns them", () => {
  const otherContact = { id: "c2", userId: "owner-b", email: "private@example.test" };
  const records = [
    log({ id: "own", status: "sent", sentAt: sentDate }),
    log({ id: "foreign-log", userId: "owner-b", status: "sent", sentAt: sentDate }),
    log({ id: "foreign-contact", userId: "owner-b", contactId: otherContact.id, status: "sent", sentAt: sentDate }),
  ];
  const own = buildPipelineEmailSummaries(["c1", "c2"], [contact, otherContact], records, "owner-a");
  assert.equal(own.c1.sentCount, 1);
  assert.equal(own.c2.contactState, "unavailable");
  assert.equal(own.c2.email, null);
  assert.equal(own.c2.sentCount, 0);
  const all = buildPipelineEmailSummaries(["c1", "c2"], [contact, otherContact], records, null);
  assert.equal(all.c1.sentCount, 2);
  assert.equal(all.c2.sentCount, 1);
  const ownerFiltered = buildPipelineEmailSummaries(["c1", "c2"], [contact, otherContact], records, "owner-b");
  assert.equal(ownerFiltered.c1.contactState, "unavailable");
  assert.equal(ownerFiltered.c2.sentCount, 1);
});

test("status and recorded-send filters combine without confusing enrollment with sending", () => {
  const pending = summarizePipelineContact(contact.id, contact, [log()]);
  const sentPending = summarizePipelineContact(contact.id, contact, [
    log({ id: "sent", status: "sent", sentAt: sentDate }), log(),
  ]);
  assert.equal(matchesPipelineEmailFilters(pending, "scheduled", "none"), true);
  assert.equal(matchesPipelineEmailFilters(pending, "enrolled", "sent"), false);
  assert.equal(matchesPipelineEmailFilters(sentPending, "scheduled", "sent"), true);
  assert.equal(matchesPipelineEmailFilters(sentPending, "not_enrolled", "sent"), false);
  assert.equal(matchesPipelineEmailFilters(undefined, "all", "all"), true);
  assert.equal(matchesPipelineEmailFilters(undefined, "all", "none"), false);
  assert.equal(matchesPipelineEmailFilters(undefined, "unavailable", "all"), true);
  assert.equal(matchesPipelineEmailFilters(pending, "unavailable", "all"), false);
  assert.equal(matchesPipelineEmailFilters(summarizePipelineContact("missing", undefined, []), "unavailable", "all"), true);
  assert.equal(matchesPipelineEmailFilters(summarizePipelineContact("missing", undefined, []), "not_enrolled", "none"), false);
});

test("batch loader deduplicates shared-contact deals, honors stage/owner scope and bounds ID batches", async () => {
  const count = PIPELINE_SUMMARY_BATCH_SIZE + 1;
  const ids = Array.from({ length: count }, (_, index) => `contact-${index}`);
  const reads: Array<{ kind: string; ids: string[]; scope: string | null }> = [];
  const repository: PipelineSummaryRepository = {
    getDeals: async (scope, stage) => {
      assert.equal(scope, "owner-a");
      assert.equal(stage, "qualified_lead");
      return ids.map(contactId => ({ contactId })).concat([{ contactId: ids[0] }, { contactId: null }]);
    },
    getContacts: async (batch, scope) => {
      reads.push({ kind: "contacts", ids: batch, scope });
      return batch.map(id => ({ ...contact, id }));
    },
    getLogs: async (batch, scope) => {
      reads.push({ kind: "logs", ids: batch, scope });
      return batch.includes(ids[0]) ? [log({ contactId: ids[0], status: "sent", sentAt: sentDate })] : [];
    },
  };
  const result = await loadPipelineEmailSummaries("owner-a", "qualified_lead", repository);
  assert.equal(Object.keys(result).length, count);
  assert.equal(result[ids[0]].sentCount, 1);
  assert.equal(reads.length, 4);
  assert.ok(reads.every(read => read.ids.length <= PIPELINE_SUMMARY_BATCH_SIZE && read.scope === "owner-a"));
});

test("empty batches do not query unrelated contacts or history", async () => {
  const result = await loadPipelineEmailSummaries("owner-a", undefined, {
    getDeals: async () => [{ contactId: null }],
    getContacts: async () => { throw new Error("must not query"); },
    getLogs: async () => { throw new Error("must not query"); },
  });
  assert.deepEqual(result, {});
});

test("batch read failures propagate instead of pretending history is empty", async () => {
  await assert.rejects(loadPipelineEmailSummaries("owner-a", undefined, {
    getDeals: async () => [{ contactId: contact.id }],
    getContacts: async () => [contact],
    getLogs: async () => { throw new Error("history temporarily unavailable"); },
  }), /history temporarily unavailable/);
});
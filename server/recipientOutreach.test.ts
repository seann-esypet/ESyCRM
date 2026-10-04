import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "./db";
import { claimRecipientSend, recipientHistory, recordRecipientOutcome, reserveRecipientLog, reconcileRecipientOutcome } from "./recipientOutreach";
import { normalizeRecipient, recipientConflict, latestRecipientEvents, type RecipientEvent } from "./recipientPolicy";

test("normalization never guesses aliases; sent intro allows only its intended later steps", () => {
  assert.equal(normalizeRecipient("  Team@Fixture.Example "), "team@fixture.example");
  assert.notEqual(normalizeRecipient("te.am+sale@fixture.example"), "team@fixture.example");
  const event: RecipientEvent = { logId: "log1", userId: "owner1", contactId: "contact1", recipient: "team@fixture.example",
    sequenceTrack: "directory_general", sequenceNumber: 1, state: "sent", at: "2026-10-01T01:00:00Z" };
  assert.match(recipientConflict(event.recipient, 1, "salon_custom", "owner2", "contact2", [event], new Set())!, /Previously emailed/);
  assert.equal(recipientConflict(event.recipient, 2, event.sequenceTrack, event.userId, event.contactId, [event], new Set()), null);
  assert.match(recipientConflict(event.recipient, 2, "salon_custom", event.userId, event.contactId, [event], new Set())!, /preceding/);
  assert.match(recipientConflict(event.recipient, 2, event.sequenceTrack, "owner2", "contact2", [event], new Set())!, /preceding/);
  assert.equal(latestRecipientEvents([{ ...event, state: "attempted" }, event])[0].state, "sent");
});
test("transactional address reservations cover concurrent owners, sends, edits, follow-ups and failed status save", async () => {
  const database = db as any, original = { transaction: database.transaction, select: database.select };
  let memory: Record<string, any[]> = {
    contacts: [{ id:"c1",userId:"owner1",email:" Team@Fixture.Example " },{ id:"c2",userId:"owner2",email:"team@fixture.example" }],
    activities: [], email_sequence_logs: [],
  };
  let queue = Promise.resolve(), failSave = false, locks = 0;
  const dialect = new PgDialect();
  const matches = (row: any, condition: any, table: string) => {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition);
    if (query.sql.includes('lower(trim(')) return normalizeRecipient(row.email) === query.params[0];
    const field = query.sql.includes('"type"') ? "type" : "id";
    return row[field] === query.params[0];
  };
  const tx: any = {
    execute: async () => { locks++; },
    select: () => {
      let table = "", condition: any;
      const read = () => structuredClone((memory[table] || []).filter(row => matches(row, condition, table)));
      const builder: any = { from(t: any) { table=getTableName(t); return builder; },
        where(c: any) { condition=c;return builder; }, for() { return builder; }, then(r:any,j:any) { return Promise.resolve(read()).then(r,j); } };
      return builder;
    },
    insert: (table: any) => ({ values(value: any) {
      const inserted = { ...value, id: value.id || `e${memory.activities.length}`, sequenceTrack:value.sequenceTrack||"directory_general" };
      memory[getTableName(table)].push(inserted);
      return { returning: async () => [structuredClone(inserted)], then: (r:any,j:any) => Promise.resolve().then(r,j) };
    }}),
    update: (table: any) => ({ set(value: any) { return { where(condition: any) {
      if (failSave && value.status === "sent") throw new Error("Fixture failed local status save.");
      for (const row of memory[getTableName(table)]) if (matches(row, condition, getTableName(table))) Object.assign(row,value);
      return { returning:async()=>[], then:(r:any,j:any)=>Promise.resolve().then(r,j) };
    }}; }}),
  };
  database.select = tx.select;
  database.transaction = (callback: any) => {
    const result = queue.then(async () => {
      const before = structuredClone(memory);
      try { return await callback(tx); } catch(error) { memory=before;throw error; }
    });
    queue = result.catch(()=>{});
    return result;
  };
  const input = (contactId:string,step=1) => ({ contactId, sequenceId:`template-${step}`, sequenceTrack:"directory_general", sequenceNumber:step, status:"pending" });
  try {
    await assert.rejects(()=>reserveRecipientLog(input("c1"),"owner1","stale-preview@fixture.example"),/email changed during enrollment/);
    const concurrent = await Promise.allSettled([reserveRecipientLog(input("c1"),"owner1"),reserveRecipientLog(input("c2"),"owner2")]);
    assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
    const log = (concurrent.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<any>).value;
    const owner = log.userId, contactId=log.contactId;
    const other = await recipientHistory("team@fixture.example", owner==="owner1"?"owner2":"owner1");
    assert.equal(other.label,"Already scheduled");assert.equal(other.crossOwner,true);assert.equal(other.history.length,0);
    const claims = await Promise.all([claimRecipientSend(log.id),claimRecipientSend(log.id)]);
    assert.equal(claims.filter(claim=>"recipient" in claim).length,1);
    failSave=true;
    await assert.rejects(()=>recordRecipientOutcome(log.id,true,"provider-accepted"), /failed local status save/);
    failSave=false;
    assert.equal((await recipientHistory("team@fixture.example", owner)).label,"Uncertain history");
    assert.ok("rejection" in await claimRecipientSend(log.id));
    await assert.rejects(()=>reconcileRecipientOutcome(log.id,owner,owner,{confirmed:true,outcome:"accepted",recipient:"someone-else@fixture.example",providerMessageId:"receipt",acceptedAt:"2026-01-01T12:00:00Z",note:"Checked provider receipt."}),/differs from retained/);
    await reconcileRecipientOutcome(log.id,owner,owner,{confirmed:true,outcome:"accepted",recipient:"team@fixture.example",providerMessageId:"provider-reconciled",acceptedAt:"2026-01-01T12:00:00Z",note:"Inspected the provider receipt for this exact actual recipient."});
    assert.equal((await recipientHistory("team@fixture.example", owner)).label,"Previously emailed");
    await assert.rejects(()=>reserveRecipientLog(input(contactId),owner), /Previously emailed/);
    const followup=await reserveRecipientLog(input(contactId,2),owner);
    assert.ok("recipient" in await claimRecipientSend(followup.id));
    await recordRecipientOutcome(followup.id,true,"provider-followup");
    const step3=await reserveRecipientLog(input(contactId,3),owner);
    memory.contacts.find(c=>c.id===contactId).email="new@fixture.example";
    assert.match((await claimRecipientSend(step3.id) as { rejection:string }).rejection,/changed/);
    assert.equal(memory.email_sequence_logs.find(l=>l.id===step3.id).status,"needs_review");
    memory.contacts=memory.contacts.filter(c=>c.id!==contactId);
    assert.equal((await recipientHistory("team@fixture.example",null)).label,"Previously emailed");
    assert.ok(memory.activities.every(event=>!event.contactId));
    memory.contacts.push({id:"legacy",userId:"legacyOwner",email:"legacy@fixture.example"});
    memory.email_sequence_logs.push({id:"unknown-history",contactId:"legacy",userId:"legacyOwner",status:"sent",sequenceNumber:1});
    assert.equal((await recipientHistory("legacy@fixture.example","legacyOwner")).label,"Uncertain history");
    await assert.rejects(()=>reserveRecipientLog(input("legacy"),"legacyOwner"), /Uncertain history/);
    assert.ok(locks>=6);
  } finally { database.transaction=original.transaction;database.select=original.select; }
});
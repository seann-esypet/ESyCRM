import test from "node:test";
import assert from "node:assert/strict";
import { sameSalonWebsite, salonRelativePage } from "@shared/salonWebsiteScope";
import { salonEmailHtmlContextRestriction } from "./salonEmailPolicy";
import { ownerLookupWebsiteUrl, getSalonOwnerNameResult } from "./salonOwnerNames";
import { AI_OVERVIEW_TOKEN_NOTICE } from "@shared/salonOwnerName";

test("opening-hour appointment-only text does not restrict a separate contact mailbox",()=>{
  const markup=`<main><section><h2>Opening Hours</h2><p>Monday – Appointment Only</p></section>
    <section><h2>Contact</h2><p>team@fixture.test</p></section></main>`;
  assert.equal(salonEmailHtmlContextRestriction("team@fixture.test",markup),null);
  for(const label of ["For bookings only","Email for appointments only","Existing clients only","Send vaccination records"]){
    assert.ok(salonEmailHtmlContextRestriction("team@fixture.test",`<div>${label}<p>team@fixture.test</p></div>`),label);
  }
});
test("Google Sites pages are tenant scoped and eligible for free owner-page inspection",()=>{
  const base=new URL("https://sites.google.com/view/fixture/home?authuser=2");
  assert.equal(salonRelativePage(base,"/about").href,"https://sites.google.com/view/fixture/about");
  assert.equal(sameSalonWebsite(base,new URL("https://sites.google.com/view/fixture/contact")),true);
  assert.equal(sameSalonWebsite(base,new URL("https://sites.google.com/view/different/contact")),false);
  assert.equal(sameSalonWebsite(base,new URL("https://sites.google.com/contact")),false);
  assert.equal(sameSalonWebsite(base,new URL("https://google.com/view/fixture/contact")),false);
  const row:any={websiteUrl:base.href,evidence:{},sourceData:{}};
  assert.equal(ownerLookupWebsiteUrl(row),base.href);
  assert.equal(ownerLookupWebsiteUrl({...row,websiteUrl:"https://www.google.com/search?q=owner"}),null);
  assert.equal(ownerLookupWebsiteUrl({...row,websiteUrl:"https://sites.google.com/view/fixture/login"}),null);
});
test("stored optional AI-token notices are separated without clearing genuine lookup errors or changing approval",()=>{
  const raw:any={status:"failed",approvedAt:null,candidates:[],providerCalls:2,error:AI_OVERVIEW_TOKEN_NOTICE+"; Owner lookup incomplete: Provider timed out"};
  const row:any={evidence:{ownerName:raw}};
  const result=getSalonOwnerNameResult(row);
  assert.deepEqual(result.notices,[AI_OVERVIEW_TOKEN_NOTICE]);
  assert.equal(result.error,"Owner lookup incomplete: Provider timed out");
  assert.equal(result.status,"failed");assert.equal(result.providerCalls,2);
  assert.equal(raw.error,AI_OVERVIEW_TOKEN_NOTICE+"; Owner lookup incomplete: Provider timed out");
});

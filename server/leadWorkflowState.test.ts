import { test } from "node:test";
import assert from "node:assert/strict";
import { leadResearchNeedsRefresh, leadSchedulePreviewReady } from "@shared/leadWorkflowState";
import { salonCrmDuplicates, salonCrmDuplicateReasons } from "./salonCrmDuplicates";
import { renderLeadSequencePreview } from "./leadSequencePreview";

test("research refresh continues through pause-in-flight and stops only after terminal row results",()=>{
  assert.equal(leadResearchNeedsRefresh({status:"running"},[]),true);
  assert.equal(leadResearchNeedsRefresh({status:"paused"},[{status:"processing"}]),true);
  assert.equal(leadResearchNeedsRefresh({status:"completed"},[{status:"enriched"}]),false);
  assert.equal(leadResearchNeedsRefresh({status:"paused"},[{status:"failed"}]),false);
});
test("a pre-link, different-recipient or incomplete message preview cannot authorize scheduling",()=>{
  const contact={id:"linked-contact",email:" TEAM@fixture.example "};
  const sequence={renderedSubject:"Subject",renderedBody:"Message",greetingPreview:"Hi team",previewFingerprint:"fingerprint"};
  assert.equal(leadSchedulePreviewReady(undefined,null,sequence),false);
  assert.equal(leadSchedulePreviewReady("linked-contact",{...contact,id:"old-contact"},sequence),false);
  assert.equal(leadSchedulePreviewReady("linked-contact",contact,{...sequence,renderedBody:""}),false);
  assert.equal(leadSchedulePreviewReady("linked-contact",contact,{...sequence,previewFingerprint:null}),false);
  assert.equal(leadSchedulePreviewReady("linked-contact",{...contact,email:""},sequence),false);
  assert.equal(leadSchedulePreviewReady("linked-contact",contact,sequence),true);
});
test("preview fingerprints bind the actual recipient, contact and rendered message, without requiring a first name",()=>{
  const contact:any={id:"c",email:"team@fixture.example",company:"Fixture Grooming",firstName:null,useBusinessNameForEmail:"Yes"};
  const sender:any={id:"owner",firstName:"Fixture",lastName:"Salesperson"};
  const sequence:any={id:"sequence",subject:"Hello [Contact_Company]",body:"<p>[Contact_Greeting],</p><p>Review our invitation.</p>"};
  const preview=renderLeadSequencePreview(sequence,contact,sender);
  assert.ok(preview.renderedSubject.trim()&&preview.renderedBody.trim()&&preview.greetingPreview.trim());
  assert.equal(preview.previewFingerprint,renderLeadSequencePreview(sequence,{...contact,email:" TEAM@FIXTURE.EXAMPLE "},sender).previewFingerprint);
  assert.notEqual(preview.previewFingerprint,renderLeadSequencePreview(sequence,{...contact,email:"different@fixture.example"},sender).previewFingerprint);
  assert.notEqual(preview.previewFingerprint,renderLeadSequencePreview({...sequence,body:"Changed invitation."},contact,sender).previewFingerprint);
});
test("CRM and importer share email, phone, business/address and Place ID duplicate candidates",()=>{
  const row:any={businessName:"Fixture Grooming",address1:"1 Main Street",address:"1 Main Street Austin",zipCode:"78701",phone:"(512) 555-0100",placeId:"place-1"};
  const base:any={id:"base",company:"Other business",address:"Elsewhere",zipCode:"78701",phone:null,email:"different@fixture.example",notes:"Manual notes"};
  const contacts=[
    {...base,id:"email1",email:"TEAM@fixture.example"},
    {...base,id:"email2",email:" team@fixture.example "},
    {...base,id:"phone",phone:"5125550100"},
    {...base,id:"address",company:"Fixture Grooming",address:"1 Main Street"},
    {...base,id:"place",notes:JSON.stringify({placeId:" PLACE-1 "})},
    {...base,id:"unrelated"},
  ];
  const matches=salonCrmDuplicates(row,contacts,"team@fixture.example");
  assert.deepEqual(matches.map(contact=>contact.id),["email1","email2","phone","address","place"]);
  assert.ok(matches.find(contact=>contact.id==="email2")); // Multiple matches do not make any explicit selection impossible.
  assert.deepEqual(salonCrmDuplicateReasons(row,contacts[2],"team@fixture.example"),["Phone number"]);
  assert.deepEqual(salonCrmDuplicateReasons(row,contacts[4],"team@fixture.example"),["Place ID"]);
  assert.equal(salonCrmDuplicates({...row,zipCode:"99999"},[contacts[3]],"team@fixture.example").length,0);
});
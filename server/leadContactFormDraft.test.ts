import { test } from "node:test";
import assert from "node:assert/strict";
import { renderContactFormDraft } from "./leadContactFormDraft";
import { historicalApprovalEvidence } from "./leadWorkspacePolicy";
import { groomingReviewFor, directoryEligibility } from "@shared/directoryEligibility";
import express from "express";
import { storage } from "./storage";
import { registerLeadWorkspaceRoutes } from "./leadWorkspaceRoutes";

const row:any={businessName:"Fixture Grooming",city:"Austin",address:"1 Main Street",state:"TX",email:"team@fixture.example"};
const sender:any={firstName:"Sales",lastName:"Person",email:"login@fixture.example",workEmail:"sales@fixture.example",replyToEmail:"reply@fixture.example"};
const sequence:any={subject:"A message for [Contact_First_Name]",body:"<p>[Contact_Greeting]</p><p>Our saved outreach message.</p><a href=\"https://fixture.example/info\">Details</a>"};
const attempted:any={status:"failed",lookedUpAt:"2026-10-07T12:00:00Z",error:"Provider timed out",candidates:[],usePersonalName:false};
test("a draft requires an owner-research attempt, not a paid provider request at generation",()=>{
  assert.throws(()=>renderContactFormDraft(row,{...attempted,status:"not_searched"} as any,sequence,sender),/owner research first/);
  assert.throws(()=>renderContactFormDraft(row,{...attempted,lookedUpAt:null} as any,sequence,sender),/owner research first/);
  const draft=renderContactFormDraft(row,attempted,sequence,sender);
  assert.equal(draft.name,"Sales Person");assert.equal(draft.replyEmail,"reply@fixture.example");
  assert.equal(draft.greeting,"Hi Fixture Grooming team,");assert.match(draft.body,/Hi Fixture Grooming team,/);
  assert.match(draft.body,/Details \(https:\/\/fixture.example\/info\)/);assert.doesNotMatch(draft.body,/<p>/);
  assert.equal(draft.personalized,false);assert.equal(draft.ownerSearch.error,"Provider timed out");
  assert.match(renderContactFormDraft(row,attempted,{...sequence,body:"Hi Unrelated Person,\nOur saved message."},sender).body,/^Hi Fixture Grooming team,\n\nOur saved message/);
  assert.match(renderContactFormDraft(row,attempted,{...sequence,body:"Our saved message."},sender).body,/^Hi Fixture Grooming team,/);
  assert.throws(()=>renderContactFormDraft(row,attempted,{...sequence,body:""},sender),/no body/);
});
test("first-name drafting needs strong owner approval metadata and an explicit personal-greeting choice",()=>{
  const candidate:any={id:"owner",firstName:"Avery",lastName:"Smith",role:"owner",roleConfirmed:true,businessMatched:true,
    sources:[{kind:"website_about",url:"https://fixture.example/about",excerpt:"Fixture Grooming owner Avery Smith"}]};
  const owner:any={...attempted,status:"needs_review",approvedAt:"2026-10-07T12:00:00Z",selectedCandidateId:"owner",usePersonalName:true,candidates:[candidate]};
  assert.equal(renderContactFormDraft(row,owner,sequence,sender).greeting,"Hi Avery,");
  for(const changed of [{usePersonalName:false},{selectedCandidateId:null},{approvedAt:null},{candidates:[{...candidate,businessMatched:false}]},
    {candidates:[{...candidate,roleConfirmed:false}]},{candidates:[{...candidate,sources:[{kind:"google_ai_overview",url:"https://fixture.example",excerpt:"AI suggestion"}]}]}]){
    assert.equal(renderContactFormDraft(row,{...owner,...changed},sequence,sender).personalized,false);
  }
});
test("optional email and grooming review inputs keep actual email and supplied URL validation",()=>{
  const blankSource=historicalApprovalEvidence(row,{});
  assert.equal(blankSource.sourceUrl,null);assert.equal(blankSource.identityConfirmed,false);assert.equal(blankSource.sourceInspected,false);
  assert.throws(()=>historicalApprovalEvidence({...row,email:null},{}),/usable business email/);
  assert.throws(()=>historicalApprovalEvidence(row,{sourceUrl:"javascript:alert(1)"}),/HTTPS/);
  assert.throws(()=>historicalApprovalEvidence(row,{sourceUrl:"not a URL"}),/valid public/);
  assert.equal(historicalApprovalEvidence({...row,evidence:{email:{sourceUrl:"not a URL"}}},{sourceUrl:""}).sourceUrl,null);
  const review=groomingReviewFor(row,"approved","");
  assert.equal(review.note,"");
  assert.equal(directoryEligibility({...row,evidence:{groomingReview:review}}).decision,"approved");
});
test("draft endpoints enforce row and message ownership, use the logged-in sender and never mutate records",async()=>{
  const fixture:any={...row,id:"fixture-row",userId:"owner",status:"enriched",evidence:{ownerName:attempted}};
  const originals:Record<string,any>={};
  let writes=0;
  const overrides:any={
    getSalonEnrichmentRow:async(id:string,scope:string|null)=>id===fixture.id&&(scope===null||scope===fixture.userId)?fixture:undefined,
    getEmailSequences:async(actor:string)=>[{...sequence,id:"message",userId:actor,sequenceTrack:"salon_no_software",strategy:"standard",sequenceNumber:1,isActive:"true"}],
    getEmailSequence:async(id:string,actor:string)=>id==="message"?{...sequence,userId:actor,sequenceNumber:1,isActive:"true"}:undefined,
    getUser:async(id:string)=>({...sender,id,firstName:id}),
    updateSalonEnrichmentRow:async()=>{writes++;throw new Error("Draft preview must not write");},
  };
  for(const key of Object.keys(overrides)){originals[key]=(storage as any)[key];(storage as any)[key]=overrides[key];}
  const app=express();app.use(express.json());
  registerLeadWorkspaceRoutes(app,(req:any,res,next)=>{
    const id=req.headers["x-fixture-user"];if(!id)return res.sendStatus(401);
    req.user={role:id==="admin"?"admin":"salesperson",claims:{sub:id,role:"admin"}};next();
  });
  const server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/leads/rows/fixture-row`;
  const request=(actor:string,body:any)=>fetch(base+"/form-draft",{method:"POST",headers:{"Content-Type":"application/json","x-fixture-user":actor},body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(base+"/form-draft-templates")).status,401);
    assert.equal((await request("stranger",{sequenceId:"message"})).status,400,"spoofed admin claim cannot expose another salesperson's row");
    assert.equal((await request("owner",{sequenceId:"other-users-message"})).status,400);
    assert.equal((await fetch(base+"/form-draft-templates",{headers:{"x-fixture-user":"owner"}})).status,200);
    const own=await request("owner",{sequenceId:"message"});assert.equal(own.status,200);
    assert.equal((await own.json()).name,"owner Person");
    const admin=await request("admin",{sequenceId:"message"});assert.equal(admin.status,200);
    assert.equal((await admin.json()).name,"admin Person","admin drafting uses admin sender, not record owner's profile");
    fixture.evidence.ownerName={...attempted,lookedUpAt:null};
    assert.equal((await request("owner",{sequenceId:"message"})).status,400);
    assert.equal(writes,0);
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    for(const key of Object.keys(overrides))(storage as any)[key]=originals[key];
  }
});

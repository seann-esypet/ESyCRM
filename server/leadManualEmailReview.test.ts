import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { storage } from "./storage";
import { registerLeadWorkspaceRoutes } from "./leadWorkspaceRoutes";
import { directoryEligibility } from "@shared/directoryEligibility";

test("manual email entry persists without approval, and approval remains scoped, deliberate and independent of grooming",async()=>{
  let row:any={id:"row",batchId:"batch",userId:"owner",businessName:"Fixture Grooming",address:"123 Main Street",
    email:null,reviewStatus:"needs_review",status:"enriched",identityMatchStatus:"strong",serpCallsUsed:17,
    sourceData:{"Provider category":"Pet groomer"},evidence:{ownerName:{status:"failed",lookedUpAt:"2026-10-06T12:00:00Z",candidates:[],providerCalls:2,error:"Provider timed out"}}};
  const ownerBefore=structuredClone(row.evidence.ownerName);
  let writes=0,refreshes=0;
  const originals:Record<string,any>={};
  const overrides:any={
    getSalonEnrichmentRow:async(id:string,scope:string|null)=>id===row.id&&(scope===null||scope===row.userId)?row:undefined,
    updateSalonEnrichmentRow:async(id:string,patch:any,userId:string)=>{
      assert.equal(id,row.id);assert.equal(userId,row.userId);writes++;row={...row,...patch};return row;
    },
    refreshSalonEnrichmentBatchCounts:async()=>{refreshes++;},
  };
  for(const key of Object.keys(overrides)){originals[key]=(storage as any)[key];(storage as any)[key]=overrides[key];}
  const app=express();app.use(express.json());
  registerLeadWorkspaceRoutes(app,(req:any,res,next)=>{
    const id=req.headers["x-fixture-user"];if(!id)return res.sendStatus(401);
    req.user={role:id==="admin"?"admin":"salesperson",claims:{sub:id,role:"admin"}};next();
  });
  const server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/leads/rows/row/review`;
  const request=(body:any,actor="owner")=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-fixture-user":actor},body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(url,{method:"POST"})).status,401);
    assert.equal((await request({confirmed:true,decision:"approved",email:"team@fixture.test"},"stranger")).status,400);
    assert.equal((await request({decision:"approved",email:"team@fixture.test"})).status,400);
    assert.equal((await request({confirmed:true,decision:"approved",sourceUrl:"team@fixture.test",reviewNote:"team@fixture.test"})).status,400);
    assert.equal(writes,0,"notes and URL cannot silently become an email");
    for(const email of ["","not-email","mailto:team@fixture.test","support@groomer.io",{}, "a".repeat(260)+"@fixture.test"]){
      assert.equal((await request({confirmed:true,decision:"needs_review",email})).status,400);
    }
    const saved=await request({confirmed:true,decision:"needs_review",email:" Team@Fixture.test ",sourceUrl:"",reviewNote:""});
    assert.equal(saved.status,200);assert.equal(row.email,"team@fixture.test");
    assert.equal(row.reviewStatus,"needs_review");assert.equal(row.evidence.email.source,"manual_entry");
    assert.equal(row.evidence.email.fetchedAt,null);assert.equal(row.evidence.email.reviewedAt,null);
    assert.deepEqual(row.evidence.ownerName,ownerBefore);assert.equal(row.serpCallsUsed,17);
    assert.equal((await request({confirmed:true,decision:"approved",email:"team@fixture.test",sourceUrl:""},"admin")).status,200);
    assert.equal(row.reviewStatus,"approved");assert.equal(row.evidence.email.source,"manual_approval");
    assert.equal(row.sourceData.Outcome,"manually_approved_email");
    assert.equal(row.sourceData.reviewHistory.at(-1).previousEvidence.value,"team@fixture.test");
    const protectedWrites=writes;
    assert.equal((await request({confirmed:true,decision:"approved",email:"different@fixture.test"})).status,400);
    assert.equal((await request({confirmed:true,decision:"needs_review",email:"team@fixture.test"})).status,400);
    row.importedContactId="contact";assert.equal((await request({confirmed:true,decision:"approved",email:"team@fixture.test"})).status,400);
    row.importedContactId=null;row.status="processing";assert.equal((await request({confirmed:true,decision:"needs_review",email:"team@fixture.test"})).status,400);
    assert.equal(writes,protectedWrites);
    row.status="enriched";row.reviewStatus="needs_review";
    row.sourceData={"Provider category":"Restaurant",Outcome:"unrelated_business",category:"unrelated_business"};
    row.evidence={...row.evidence,provider:{categories:["Veterinarian"]}};
    assert.equal(directoryEligibility(row).blocked,true);
    assert.equal((await request({confirmed:true,decision:"needs_review",email:"team@fixture.test",sourceUrl:""})).status,200);
    assert.equal(directoryEligibility(row).blocked,true,"saving email cannot erase grooming exclusion");
    assert.equal(row.sourceData.Outcome,"unrelated_business");
    assert.equal((await request({confirmed:true,decision:"approved",email:"team@fixture.test",sourceUrl:""})).status,400);
    assert.equal(row.reviewStatus,"needs_review");assert.equal(row.serpCallsUsed,17);
    assert.equal(refreshes,writes);
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    for(const key of Object.keys(overrides))(storage as any)[key]=originals[key];
  }
});

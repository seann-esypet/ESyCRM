// Isolated browser fixtures: intercept every API; never touch live records or providers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import Papa from "papaparse";
import { unifiedUploadRow, leadView, historicalApprovalEvidence } from "../server/leadWorkspacePolicy.ts";
import { renderLeadSequencePreview } from "../server/leadSequencePreview.ts";
import { leadResearchResults, filterLeadResearchRows } from "../server/leadResearchResults.ts";
import { evaluateGroomingPages } from "../server/groomingChecks.ts";
const profile = await mkdtemp(join(tmpdir(),"leads-browser-"));
const chrome = spawn("chromium",["--headless","--no-sandbox","--disable-dev-shm-usage","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
const pending=new Map(),errors=[],writes=[];
let ws,id=0,role="salesperson",rows=[],batches=[],scheduled=false,researchActive=false,linkedPreviewReads=0,failSearchSave=false;
let fullResearchReadOnlyReason=null;
let providerCreditsRemaining=35,providerCreditsStatus="available";
let providerCreditsMonthlyLimit=250;
let sharedProviderBudget={monthYear:"2026-10",monthlyQuota:250,hardStopAt:200,used:200,remaining:0};
const fixtureSequence={id:"fixture-sequence",sequenceNumber:1,sequenceTrack:"directory_general",isActive:"true",subject:"Are you listed?",body:"<p>[Contact_Greeting],</p><p>Fixture invitation.</p>",name:"Directory introduction"};
const fixtureSender={id:"fixture-owner",firstName:"Fixture",lastName:"Salesperson"};
function linkedContact(row){return row.importedContactId?{id:row.importedContactId,email:row.importedContactId==="fixture-phone-contact"?"existing@fixture-contact.example":row.email,company:row.businessName,firstName:null,useBusinessNameForEmail:"Yes"}:null;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={}) {
  return new Promise((resolve,reject)=>{
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error(`Timeout ${method}`));},15000);
    pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));
  });
}
async function evaluate(expression) {
  const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression,label) {
   for(let attempt=0;attempt<240;attempt++){try{if(await evaluate(`Boolean(${expression})`))return;}catch{}await pause(100);}
  throw new Error(`Missing ${label}: ${await evaluate("document.body?.innerText || location.href")}`);
}
const button=(text,scope="document")=>`Array.from(${scope}.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const article="document.querySelector('article')";
async function click(text,scope="document"){await until(button(text,scope),text);await evaluate(`${button(text,scope)}.click()`);await pause(150);}
function fixtureOwnerName(businessName,found=false){
  return {status:"needs_review",selectedCandidateId:null,approvedAt:null,usePersonalName:false,
    providerCalls:found?1:0,pagesFetched:found?1:0,candidates:[
      {id:"foreign-owner",firstName:"Rachel",lastName:null,role:"Unconfirmed search-result mention",
        roleConfirmed:false,businessMatched:false,confidence:"low",sources:[{kind:"organic_summary",
          url:"https://fixture.example/other",excerpt:"LEXY'S PET PARLOR — Rachel, the owner."}]},
      ...(found?[{id:"matched-owner",firstName:"Avery",lastName:"Smith",role:"founder",
        roleConfirmed:false,businessMatched:false,confidence:"low",sources:[{kind:"organic_page",
          url:"https://fixture.example/interview",excerpt:`My name is Avery Smith, and I'm the founder of ${businessName}.`}]},
        {id:"ai-owner",firstName:"Eric",lastName:null,role:"Unconfirmed Google AI Overview mention",
          roleConfirmed:false,businessMatched:false,confidence:"low",sources:[
            {kind:"google_ai_overview",url:"https://www.google.com/search?q=fixture",excerpt:`${businessName}. Groomer / Owner: Eric`},
            {kind:"google_ai_citation",url:"https://fixture.example/ai-citation",excerpt:`AI Overview citation (not yet verified): ${businessName}`},
          ]}]:[]),
    ]};
}
async function reviewThroughScheduling(entry) {
  await click("Review details",article);
  await evaluate(`(()=>{const e=${article}.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Inspected source, matched this exact location and general contact email.');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  for(const text of ["I inspected the source","I confirm this source"])await evaluate(`Array.from(${article}.querySelectorAll('label')).find(e=>e.textContent.includes(${JSON.stringify(text)})).querySelector('[role=checkbox]').click()`);
  await click("Approve email",article);
  await until("document.querySelector('article').innerText.includes('approved')","approval");
  const contactAction = await evaluate(`(()=>{
    const action=${button("Add approved lead to Contacts",article)};
    const panel=action.closest("section");
    const owner=${article}.querySelector('[aria-label^="Owner name review"]');
    return {height:action.getBoundingClientRect().height,disabled:action.disabled,
      prominentPanel:panel.getAttribute("aria-labelledby")?.startsWith("crm-action-"),
      beforeOwner:!owner||Boolean(action.compareDocumentPosition(owner)&Node.DOCUMENT_POSITION_FOLLOWING),
      count:Array.from(${article}.querySelectorAll("button")).filter(e=>e.textContent.trim()==="Add approved lead to Contacts").length};
  })()`);
  assert.ok(contactAction.height>=44,"Contacts action has a large touch target");
  assert.equal(contactAction.disabled,false,"approved eligible lead can be added");
  assert.equal(contactAction.prominentPanel,true,"action is in the prominent Contacts panel");
  assert.equal(contactAction.beforeOwner,true,"action appears before the long owner review");
  assert.equal(contactAction.count,1,"only one primary Contacts action");
  await until("document.querySelector('article').innerText.includes('Unrelated search-result suggestions have been hidden')","unrelated saved suggestions hidden");
  assert.equal((await evaluate(`${article}.innerText`)).includes("Rachel"),false);
  await click("Retry owner search",article);
  await click("Confirm & search",article);
  await until("document.querySelector('article').innerText.includes('Avery Smith')","new owner result appears without navigation");
  await until("document.querySelector('article').innerText.includes('Eric')","first-name AI Overview suggestion");
  assert.equal(await evaluate(`${article}.innerText.includes("Google AI Overview · unverified suggestion")`),true);
  assert.equal(await evaluate(`${article}.innerText.includes("AI Overview citation · not yet verified")`),true);
  assert.equal(await evaluate(`${article}.innerText.includes("A citation is not proof of ownership")`),true);
  await evaluate(`Array.from(${article}.querySelectorAll('label')).find(e=>e.textContent.includes("Eric")&&e.querySelector('input[name^="owner-"]')).querySelector('input').click()`);
  assert.equal(await evaluate(`${button("Approve selected owner",article)}.disabled`),true);
  assert.equal((await evaluate(`${article}.innerText`)).includes("Rachel"),false);
  await click("Add approved lead to Contacts",article);
  if(entry==="upload"){
    await until("document.querySelector('article').innerText.includes('Possible duplicate contacts')","multiple duplicate choices");
    await evaluate(`Array.from(${article}.querySelectorAll('label')).find(e=>e.textContent.includes('Existing phone-linked business')).querySelector('input[type=radio]').click()`);
    await click("Confirm link to selected contact",article);
  }
  await until("document.querySelector('article').innerText.includes('Open contact')","contact link");
  await click("Create Pipeline deal",article);
  await until("document.querySelector('article').innerText.includes('Open pipeline deal')","deal link");
  assert.deepEqual(writes,[entry,"review","crm","pipeline"]);
  await evaluate(`${article}.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until("document.querySelector('[role=option]')","sequence choices");
  await evaluate("(()=>{const e=Array.from(document.querySelectorAll('[role=option]')).find(e=>e.innerText.includes('Are you listed?'));e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
  await until("document.querySelector('article').innerText.includes('Personalization preview')","separate sequence preview");
  await until("document.querySelector('article').innerText.includes('Fixture invitation.')","freshly rendered post-link message");
  assert.ok(linkedPreviewReads>0);
  const expected=entry==="upload"?"existing@fixture-contact.example":"team@fixture-search.example";
  assert.ok((await evaluate("document.querySelector('article').innerText")).includes(`Recipient: ${expected}`));
  assert.equal(await evaluate(`${button("Confirm schedule",article)}.disabled`),true);
  assert.equal(scheduled,false);
  await evaluate(`Array.from(${article}.querySelectorAll('label')).find(e=>e.textContent.includes('I reviewed the recipient')).querySelector('[role=checkbox]').click()`);
  await click("Confirm schedule",article);
  await until("document.querySelector('article').innerText.includes('Already scheduled')","retained scheduling history");
  assert.deepEqual(writes,[entry,"review","crm","pipeline","schedule"]);
}
async function fullResearchUiCase(origin){
  writes.length=0;
  const batch={id:"fixture-full-list",name:"Full Research fixture",status:"completed",totalRows:1,createdAt:new Date().toISOString()};
  batches.push(batch);
  rows=[{...unifiedUploadRow({Business:"Full Research Fixture Grooming",Address:"1 Main Street Austin TX",State:"TX"},0,"fixture-owner"),id:"fixture-full-row",batchId:batch.id,serpCallsUsed:0}];
  const selector=id=>`document.querySelector('[data-testid="${id}"]')`;
  const load=async()=>{await send("Page.navigate",{url:origin+"/leads/"+batch.id});await until(selector("full-research-panel"),"Full Research controls");await pause(150);};
  const press=async id=>{await until(`${selector(id)}&&!${selector(id)}.disabled`,id);await evaluate(`${selector(id)}.click()`);await pause(100);};
  await load();
  assert.equal(await evaluate(`${selector("full-research-start")}.disabled`),true);
  assert.equal(await evaluate(`${selector("full-research-businesses-hour")}.value`),"20");
   assert.equal(await evaluate(`${selector("full-research-paid-hour")}.value`),"80");
  assert.equal(await evaluate(`${selector("full-research-paid-total")}.value`),"200");
  assert.deepEqual(writes,[]);
  await press("full-research-consent");await press("full-research-start");
  await until(selector("full-research-pause"),"waiting hourly can be paused");
  assert.deepEqual(writes,["full-start"]);
  assert.equal(await evaluate("document.body.innerText.includes('Review estimate & research')"),false);
  await press("full-research-pause");await until(selector("full-research-resume"),"separate resume confirmation");
  assert.equal(await evaluate(`${selector("full-research-resume")}.disabled`),true);
  await evaluate("document.getElementById('full-research-resume-confirmation').click()");
  await press("full-research-resume");await until(selector("full-research-pause"),"resumed hourly queue");
  const run=batch.researchProgress.fullResearch;
  run.enabled=false;run.status="budget_exhausted";
  run.attempts=Array.from({length:200},()=>({rowId:rows[0].id,tool:"business_search",at:new Date().toISOString()}));
  await load();
   if(await evaluate(`Boolean(${selector("full-research-finished-dialog")})`))await click("Dismiss");
  await evaluate(`(()=>{const e=${selector("full-research-paid-total")};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'300');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await press("full-research-consent");
  assert.equal(await evaluate(`${selector("full-research-start")}.disabled`),true);
  await press("full-research-budget-increase-consent");await press("full-research-start");
  await until(selector("full-research-pause"),"higher explicitly authorized total");
  assert.equal(batch.researchProgress.fullResearch.attempts.length,200);
  assert.equal(batch.researchProgress.fullResearch.limits.paidCallsPerList,300);
  batch.researchProgress.fullResearch={...batch.researchProgress.fullResearch,enabled:false,status:"interrupted",currentRowId:rows[0].id};
  await load();await until(selector("full-research-recover"),"interruption recovery");
  assert.equal(await evaluate(`${selector("full-research-recover")}.disabled`),true);
  assert.equal(await evaluate(`!!${selector("full-research-resume")}`),false);
  await evaluate("document.getElementById('full-research-recover-confirmation').click()");
  await press("full-research-recover");await until(selector("full-research-resume"),"recovery requires separate resume");
  assert.deepEqual(writes,["full-start","full-pause","full-resume","full-start","full-recover"]);
  assert.ok(rows.every(row=>!row.importedContactId&&row.reviewStatus!=="approved"));
  for(const [label,width,height,mobile] of [["desktop",1365,900,false],["mobile",402,874,true]]){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile});
    await load();
    assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
    await send("Page.captureScreenshot",{format:"jpeg",quality:65}).then(r=>writeFile(`reports/workflow-fixtures/${role}-full-research-${label}.jpg`,Buffer.from(r.data,"base64")));
  }
}
async function groomingUiCase(origin) {
  writes.length=0;
  const batch={id:"fixture-grooming-checks",name:"Grooming checks fixture",status:"completed",totalRows:1,createdAt:new Date().toISOString()};
  const target={...unifiedUploadRow({Business:"Paws and Co",Address:"123 Main Street, Austin TX 78701",State:"TX",
    Email:"office@fixture.example","Email Source URL":"https://fixture.example/services"},0,"fixture-owner"),
    id:"fixture-grooming-row",batchId:batch.id,address1:"123 Main Street",city:"Austin",zipCode:"78701",state:"TX",
    email:"office@fixture.example",status:"enriched",reviewStatus:"needs_review",processedAt:new Date().toISOString()};
  const checks=evaluateGroomingPages(target,[{url:"https://fixture.example/services",
    html:"<h1>Paws and Co</h1><p>We are a pet store. We offer pet grooming services.</p><footer>123 Main Street Austin TX 78701</footer>"}]);
  checks.aiAnswers=[{question:"shop",text:"Google AI suggests Paws and Co is a grooming salon. This claim needs verification.",
    sourceUrl:"https://www.google.com/search?q=fixture",citations:["https://fixture.example/services"]}];
  const owner={status:"needs_review",approvedAt:null,selectedCandidateId:null,usePersonalName:false,candidates:[
    {id:"fixture-avery",firstName:"Avery",lastName:"Smith",role:"owner",roleConfirmed:true,businessMatched:true,confidence:"high",
      sources:[{kind:"business_website",url:"https://fixture.example/about",excerpt:"Paws and Co Owner: Avery Smith"}]}]};
  target.evidence={...target.evidence,groomingChecks:checks,ownerName:owner,
    email:{value:target.email,source:"website",sourceUrl:"https://fixture.example/services",confidence:"high",purpose:"general",rationale:"Fixture public business email; human review required."}};
  rows=[target];batches=[batch];
  const load=async()=>{await send("Page.navigate",{url:origin+"/leads/"+batch.id});await until("document.querySelector('article')","grooming candidate");await pause(300);};
  for(const [label,width,height,mobile] of [["desktop",1365,900,false],["mobile",402,874,true]]){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile});
    await load();
    if(mobile){await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click()`);await until(`document.querySelector('button[aria-label="Expand sidebar"]')`,"collapsed sidebar");}
    assert.equal(await evaluate(`document.querySelector('[aria-label="Found contact details"]').innerText.includes('Avery Smith')`),true);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Found contact details"]').innerText.includes('Unverified candidate')`),true);
    assert.equal(await evaluate(`document.querySelector('[data-testid="lead-highlight-email"]').innerText`),target.email);
    assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-testid="lead-highlight-email"]')).fontSize)>=18`));
    assert.equal(await evaluate(`document.querySelector('[aria-label="Found contact details"] a[href^="mailto:"]')===null`),true);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('article')).borderTopWidth`),"2px");
    await evaluate(`document.querySelector('[aria-label="Found contact details"]').scrollIntoView({block:'start'})`);
    await pause(250);
    assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
    await send("Page.captureScreenshot",{format:"jpeg",quality:75}).then(r=>writeFile(`reports/workflow-fixtures/${role}-contact-highlights-${label}.jpg`,Buffer.from(r.data,"base64")));
    await click("Review details",article);
    await until(`document.querySelector('[data-testid="grooming-offersGrooming"]')`,"grooming checks visible");
    assert.equal(await evaluate(`document.querySelector('[data-testid="grooming-offersGrooming"]').innerText.includes('Yes')`),true);
    assert.equal(await evaluate(`document.querySelector('[data-testid="grooming-groomingShop"]').innerText.includes('No')`),true);
    assert.equal(await evaluate(`document.querySelector('[data-testid="grooming-ai-answers"]').innerText.includes('Google AI suggests')`),true);
    await evaluate(`document.querySelector('[data-testid="grooming-offersGrooming"] summary').click()`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="grooming-offersGrooming"] details').open`),true);
    await evaluate(`document.querySelector('[aria-label="Grooming business checks"]').scrollIntoView({block:'start'})`);
    await pause(250);
    assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
    await send("Page.captureScreenshot",{format:"jpeg",quality:75}).then(r=>writeFile(`reports/workflow-fixtures/${role}-grooming-checks-${label}.jpg`,Buffer.from(r.data,"base64")));
  }
  assert.deepEqual(writes,[],"reading findings and expanding sources cannot approve, import, schedule or research");
  target.reviewStatus="approved";
  target.evidence.ownerName={...owner,status:"approved",selectedCandidateId:"fixture-avery",approvedAt:new Date().toISOString()};
  await load();
  assert.equal(await evaluate(`document.querySelector('[aria-label="Found contact details"]').innerText.includes('Owner approved')`),true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Found contact details"]').innerText.includes('Approved')`),true);
  target.address="999 Other Street, Austin TX 78701";await load();await click("Review details",article);
  assert.equal(await evaluate(`document.querySelector('[data-testid="grooming-offersGrooming"]').innerText.includes('Unknown')`),true);
  assert.equal(await evaluate(`document.querySelector('[data-testid="grooming-ai-answers"]').innerText.includes('Google AI suggests')`),false);
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
}
async function futureResearchDefaultsUiCase(origin) {
  writes.length=0;
  const previousSharedBudget=sharedProviderBudget;
  sharedProviderBudget={monthYear:"2026-10",monthlyQuota:1000,hardStopAt:800,used:200,remaining:600};
  const selector=id=>`document.querySelector('[data-testid="${id}"]')`;
  const fresh={id:`fixture-future-${role}`,name:"New research defaults fixture",status:"completed",
    totalRows:1,createdAt:new Date().toISOString()};
  const saved={...fresh,id:`fixture-saved-hourly-${role}`,name:"Saved 40/hour fixture",status:"paused",
    researchProgress:{workflow:"unified_leads",fullResearch:{
      status:"paused",enabled:false,limits:{businessesPerHour:20,paidCallsPerHour:40,paidCallsPerList:200},
      startedAt:new Date().toISOString(),processedIds:[],startedRows:[],currentRowId:null,nextRunAt:null,error:null,
      attempts:[{rowId:"fixture-old-hourly-row",tool:"business_search",at:new Date().toISOString()}]}}};
  batches=[fresh,saved];
  rows=[fresh,saved].map((batch,index)=>({...unifiedUploadRow({Business:batch.name,Address:"Austin TX",State:"TX"},index,"fixture-owner"),
    id:`fixture-hourly-row-${index}`,batchId:batch.id,serpCallsUsed:index}));
  const load=async batch=>{
    await send("Page.navigate",{url:origin+"/leads/"+batch.id});
    await until(selector("full-research-panel"),"hourly allowance form");await pause(200);
  };
  for(const [label,width,height,mobile] of [["desktop",1365,900,false],["mobile",402,874,true]]){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile});
    await load(fresh);
    if(mobile){
      await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click()`);
      await until(`document.querySelector('button[aria-label="Expand sidebar"]')`,"unobstructed phone form");
    }
    assert.equal(await evaluate(`${selector("full-research-paid-hour")}.value`),"80");
    assert.equal(await evaluate(`${selector("full-research-businesses-hour")}.value`),"20");
    assert.equal(await evaluate(`${selector("full-research-paid-total")}.value`),"200");
    assert.equal(await evaluate(`${selector("full-research-start")}.disabled`),true);
    assert.equal(await evaluate(`${selector("full-research-limit-scope")}.innerText.includes('Saved searches resume')`),true);
    await pause(500);
    await evaluate(`${selector("full-research-businesses-hour")}.scrollIntoView({block:'start'})`);
    await pause(200);
    assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
    await send("Page.captureScreenshot",{format:"jpeg",quality:70}).then(r=>writeFile(`reports/workflow-fixtures/${role}-future-hourly-${label}.jpg`,Buffer.from(r.data,"base64")));
  }
  for(const state of ["paused","running","waiting_hourly","interrupted"]){
    const run=saved.researchProgress.fullResearch;
    run.status=state;run.enabled=["running","waiting_hourly"].includes(state);
    run.currentRowId=state==="interrupted"?"fixture-old-hourly-row":null;
    const before=JSON.stringify(saved);
    await load(saved);
    assert.equal(await evaluate(`${selector("full-research-paid-hour")}.value`),"40");
    assert.equal(await evaluate(`${selector("full-research-paid-hour")}.disabled`),true);
    assert.equal(JSON.stringify(saved),before,"opening an old run cannot change caps, counters or enabled state");
  }
  const run=saved.researchProgress.fullResearch;
  run.status="paused";run.enabled=false;run.currentRowId=null;
  await load(saved);
  const before=JSON.stringify(run);
  await evaluate("document.getElementById('full-research-resume-confirmation').click()");
  await click("Confirm and resume");
  await until(`${selector("full-research-pause")}`,"old run explicitly resumed");
  assert.equal(saved.researchProgress.fullResearch.limits.paidCallsPerHour,40);
  assert.deepEqual(saved.researchProgress.fullResearch.attempts,JSON.parse(before).attempts);
  assert.deepEqual(writes,["full-resume"],"viewing and default changes initiate no requests; resume is separate");
  // A completed old search offers 80 for a NEW confirmation while progress still
  // reports the old saved 40/hour allowance. Polling must not overwrite edits.
  writes.length=0;
  saved.researchProgress.fullResearch.status="completed";saved.researchProgress.fullResearch.enabled=false;
  await until(`${selector("full-research-paid-hour")}.value==='80'`,"new-search default after completion without remount");
  const completed=JSON.stringify(saved);
  await evaluate(`(()=>{const e=${selector("full-research-paid-hour")};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'75');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(1800);
  assert.equal(await evaluate(`${selector("full-research-paid-hour")}.value`),"75","polling preserves unconfirmed form edits");
  assert.equal(JSON.stringify(saved),completed);
  assert.deepEqual(writes,[]);
  sharedProviderBudget=previousSharedBudget;
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
}
async function researchStatusUiCase(origin) {
  writes.length=0;
  const selector=id=>`document.querySelector('[data-testid="${id}"]')`;
  const banner=selector("full-research-status"),dialog=selector("full-research-finished-dialog");
  const batch={id:`fixture-status-${role}`,name:"TX research status fixture",totalRows:3,
    status:"running",createdAt:new Date().toISOString(),researchProgress:{workflow:"unified_leads",
      fullResearch:{status:"running",enabled:true,notificationId:`${role}-run-1`,startedAt:new Date().toISOString(),
        limits:{businessesPerHour:20,paidCallsPerHour:40,paidCallsPerList:200},
        processedIds:[],startedRows:[],attempts:[],currentRowId:null,nextRunAt:null,error:null}}};
  batches=[batch];
  rows=Array.from({length:3},(_,index)=>({...unifiedUploadRow({Business:`Status fixture Grooming ${index}`,Address:"Austin TX",State:"TX"},index,"fixture-owner"),
    id:`fixture-status-row-${index}`,batchId:batch.id,serpCallsUsed:0}));
  const run=batch.researchProgress.fullResearch;
  const load=async()=>{await send("Page.navigate",{url:origin+"/leads/"+batch.id});await until(banner,"status banner");};
  const status=async text=>until(`${banner}?.innerText.includes(${JSON.stringify(text)})`,text);
  const screenshot=async suffix=>{
    await evaluate(`${banner}.scrollIntoView({block:'center'})`);
    await pause(400); // Let scrolling and the modal entrance finish before visual checks.
    if(await evaluate(`Boolean(${dialog})`)){
      assert.equal(await evaluate(`getComputedStyle(${dialog}).opacity`),"1");
      assert.notEqual(await evaluate(`getComputedStyle(${dialog}).backgroundColor`),"rgba(0, 0, 0, 0)");
    }
    await send("Page.captureScreenshot",{format:"jpeg",quality:70}).then(r=>writeFile(`reports/workflow-fixtures/${role}-research-status-${suffix}.jpg`,Buffer.from(r.data,"base64")));
  };
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await load();await status("Researching");
  assert.equal(await evaluate(`${banner}.getAttribute('role')`),"status");
  assert.equal(await evaluate(`${banner}.getAttribute('aria-live')`),"polite");
  assert.notEqual(await evaluate(`getComputedStyle(${selector("full-research-animation")}).animationName`),"none");
  assert.equal(await evaluate(`${banner}.getBoundingClientRect().height>=90`),true);
  await screenshot("running-desktop");
  await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  assert.equal(await evaluate(`getComputedStyle(${selector("full-research-animation")}).animationName`),"none");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.research-progress-sweep')).animationName`),"none");
  await send("Emulation.setEmulatedMedia",{features:[]});
  run.status="waiting_hourly";batch.status="paused";run.nextRunAt=new Date(Date.now()+3600000).toISOString();
  await status("Waiting—resumes automatically");
  assert.equal(await evaluate(`Boolean(${selector("full-research-animation")})`),false);
  assert.equal(await evaluate(`Boolean(${dialog})`),false);
  assert.equal(await evaluate(`${banner}.innerText.includes('Next eligible run')`),true);
  run.waitReason="provider_rate_limit";run.providerRateLimitCount=1;
  run.error="Temporary provider rate limit. Automatic retry 1/5 is scheduled; paid attempts remain counted.";
  rows[0].sourceData={...rows[0].sourceData,stagingState:"verification_attempted",fullResearchState:"waiting_hourly",fullResearchWaitReason:"provider_rate_limit"};
  await status("Waiting for provider—resumes automatically");
  await until(`document.querySelector('article')?.innerText.includes('Waiting for provider cooldown')`,"row provider cooldown badge");
  assert.equal(await evaluate(`${banner}.innerText.includes('cooldown')`),true);
  assert.equal(await evaluate(`Boolean(${dialog})`),false);
  assert.equal(await evaluate(`Boolean(${selector("full-research-pause")})`),true);
  assert.equal(await evaluate(`Boolean(${selector("full-research-resume")})`),false);
  await screenshot("provider-wait-desktop");
  await send("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click()`);
  await until(`document.querySelector('button[aria-label="Expand sidebar"]')`,"collapsed phone navigation");
  await screenshot("provider-wait-mobile");
  assert.equal(await evaluate(`${banner}.getBoundingClientRect().right<=window.innerWidth`),true);
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('button[aria-label="Expand sidebar"]')?.click()`);
  rows[0].sourceData={...rows[0].sourceData,fullResearchState:"researched",fullResearchWaitReason:null};
  run.waitReason=undefined;run.error=null;
  run.status="running";run.nextRunAt=null;batch.status="running";
  await status("Researching"); // hourly polling must observe automatic continuation
  run.status="completed";run.enabled=false;batch.status="completed";
  run.processedIds=rows.slice(0,2).map(row=>row.id);
  run.startedRows=run.processedIds.map(id=>({id,at:new Date().toISOString()}));
  run.attempts=[{at:new Date().toISOString(),tool:"business_search",rowId:rows[0].id}];
  for(const row of rows.slice(0,2))row.status="enriched";
  rows[2].reviewStatus="approved"; // completed refers to eligible rows, not all uploaded rows
  await status("Search Complete");await until(dialog,"completion popup");
  assert.equal(await evaluate(`Boolean(${selector("full-research-animation")})`),false);
  assert.equal(await evaluate(`${dialog}.innerText.includes('TX research status fixture')`),true);
  assert.equal(await evaluate(`${dialog}.innerText.includes('2 / 3')`),true);
  assert.equal(await evaluate(`${dialog}.innerText.includes('1 / 200')`),true);
  assert.equal(await evaluate(`${dialog}.innerText.includes('all currently eligible businesses')`),true);
  assert.equal(await evaluate(`${dialog}.contains(document.activeElement)`),true,"dialog receives keyboard focus");
  await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  assert.equal(await evaluate(`getComputedStyle(${dialog}).animationName`),"none");
  await send("Emulation.setEmulatedMedia",{features:[]});
  for(let i=0;i<8;i++){
    await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
    await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
    assert.equal(await evaluate(`${dialog}.contains(document.activeElement)`),true,"focus stays in modal");
  }
  await screenshot("complete-desktop");
  await click("Review researched businesses");
  await until("location.search.includes('view=researched')","popup links to server-filtered results");
  await until(`!${dialog}`,"review dismisses popup");
  await until("document.activeElement.closest('#lead-candidates')","focus restored to reviewed results");
  assert.equal(await evaluate("Boolean(document.activeElement.closest('#lead-candidates'))"),true,"Review returns keyboard focus to results");
  await load();await status("Search Complete");
  assert.equal(await evaluate(`Boolean(${dialog})`),false,"acknowledged completion stays dismissed after reload");
  run.status="running";run.enabled=true;run.notificationId=`${role}-run-2`;batch.status="running";
  await load();await status("Researching");
  run.status="budget_exhausted";run.enabled=false;batch.status="paused";
  run.attempts=Array.from({length:200},()=>({at:new Date().toISOString(),tool:"business_search",rowId:rows[0].id}));
  await status("Search stopped—request limit reached");await until(dialog,"distinct request cap popup");
  assert.equal(await evaluate(`${dialog}.innerText.includes('partial work')`),true);
  assert.equal(await evaluate(`${dialog}.innerText.includes('200 / 200')`),true);
  assert.equal(await evaluate(`${dialog}.innerText.includes('Search Complete')`),false);
  await send("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate(`${dialog}.getBoundingClientRect().width<=window.innerWidth`),true);
  await screenshot("cap-mobile");
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await until(`!${dialog}`,"Escape dismisses popup");
  await until("document.activeElement.getAttribute('aria-label')==='Full Research status'","focus restored to status banner");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),"Full Research status","dismiss restores focus to status");
  await load();await status("Search stopped—request limit reached");
  assert.equal(await evaluate(`Boolean(${dialog})`),false,"cap notification remains dismissed");
  for(const state of ["paused","interrupted"]){
    run.status=state;run.currentRowId=state==="interrupted"?rows[0].id:null;
    await load();await status(state==="paused"?"Research paused":"Research interrupted");
    assert.equal(await evaluate(`Boolean(${dialog})||Boolean(${selector("full-research-animation")})`),false);
  }
  run.status="waiting_hourly";run.enabled=false;
  await load();await status("Research paused");
  run.status="running";run.enabled=true;run.notificationId=`${role}-run-3`;run.currentRowId=null;
  batch.status="running";await load();await status("Researching");
  assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
  await screenshot("running-mobile");
  run.status="completed";run.enabled=false;batch.status="completed";
  await status("Search Complete");await until(dialog,"later new run notifies again");
  await screenshot("complete-mobile");
  assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
  assert.equal(await evaluate(`${dialog}.getBoundingClientRect().width<=window.innerWidth`),true);
  await click("Dismiss");await until(`!${dialog}`,"dismiss new completion");
  const other={...batch,id:`fixture-status-other-${role}`,name:"Other paused list",
    researchProgress:{fullResearch:{...run,status:"paused",notificationId:`${role}-other`}}};
  batches.push(other);
  await evaluate(`history.pushState(null,'',${JSON.stringify("/leads/"+other.id)});window.dispatchEvent(new PopStateEvent('popstate'))`);
  await status("Research paused");
  assert.equal(await evaluate(`Boolean(${dialog})`),false,"list switching cannot show prior completion");
  await evaluate(`history.pushState(null,'',${JSON.stringify("/leads/"+batch.id)});window.dispatchEvent(new PopStateEvent('popstate'))`);
  await status("Search Complete");
  assert.equal(await evaluate(`Boolean(${dialog})`),false,"component remount respects acknowledgement");
  fullResearchReadOnlyReason="Research unavailable for this read-only directory.";
  run.status="running";run.enabled=true;batch.status="running";
  await load();await status("Research unavailable");
  assert.equal(await evaluate(`Boolean(${dialog})||Boolean(${selector("full-research-animation")})`),false);
  fullResearchReadOnlyReason=null;
  delete batch.researchProgress.fullResearch;batch.status="completed";
  await load();await status("Not started");
  assert.equal(await evaluate(`Boolean(${dialog})||Boolean(${selector("full-research-animation")})`),false);
  assert.deepEqual(writes,[],"status changes and review navigation cannot write, research, import or send");
}
async function providerCreditsUiCase(origin) {
  writes.length=0;
  const batch={id:`fixture-credits-${role}`,name:"Provider credits fixture",status:"paused",totalRows:1,
    createdAt:new Date().toISOString(),researchProgress:{workflow:"unified_leads",fullResearch:{
      status:"paused",enabled:false,notificationId:`credits-${role}`,startedAt:new Date().toISOString(),
      limits:{businessesPerHour:20,paidCallsPerHour:40,paidCallsPerList:200},
      processedIds:[],startedRows:[],attempts:[{at:new Date().toISOString(),tool:"business_search",rowId:"fixture-credits-row"}],
      currentRowId:null,nextRunAt:null,error:null}}};
  batches=[batch];
  rows=[{...unifiedUploadRow({Business:"Credits fixture Grooming",Address:"Austin TX",State:"TX"},0,"fixture-owner"),
    id:"fixture-credits-row",batchId:batch.id,serpCallsUsed:1}];
  providerCreditsRemaining=35;providerCreditsStatus="available";
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:origin+"/leads/"+batch.id});
  const card="document.querySelector('[data-testid=\"provider-credits\"]')";
  await until(`${card}?.innerText.includes('35')`,"available provider credits");
  assert.equal(await evaluate(`${card}.previousElementSibling.innerText.includes('1 / 200')`),true);
  assert.equal(await evaluate("document.querySelector('[data-testid=\"full-research-resume\"]').disabled"),true);
  providerCreditsRemaining=0;
  await click("Check provider balance");
  await until("document.querySelector('[data-testid=\"provider-credits-empty\"]')","zero-credit warning");
  await until(`${card}?.querySelector('b').innerText==='0'`,"true zero balance");
  await evaluate(`${card}.scrollIntoView({block:'center'})`);
  await pause(300);
  await send("Page.captureScreenshot",{format:"jpeg",quality:70}).then(r=>writeFile(`reports/workflow-fixtures/${role}-provider-credits-desktop.jpg`,Buffer.from(r.data,"base64")));
  await send("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click()`);
  await until(`document.querySelector('button[aria-label="Expand sidebar"]')`,"collapsed credit-display navigation");
  await evaluate(`${card}.scrollIntoView({block:'center'})`);
  await pause(300);
  assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
  await send("Page.captureScreenshot",{format:"jpeg",quality:70}).then(r=>writeFile(`reports/workflow-fixtures/${role}-provider-credits-mobile.jpg`,Buffer.from(r.data,"base64")));
  providerCreditsStatus="unavailable";
  await click("Check provider balance");
  await until(`${card}?.querySelector('b').innerText==='Unavailable'`,"unknown balance is not zero");
  assert.equal(await evaluate("Boolean(document.querySelector('[data-testid=\"provider-credits-empty\"]'))"),false);
  assert.equal(await evaluate("document.body.innerText.includes('It is unknown—not zero')"),true);
  providerCreditsStatus="available";providerCreditsRemaining=30;
  await click("Check provider balance");
  await until(`${card}?.querySelector('b').innerText==='30'`,"replenished balance");
  assert.deepEqual(writes,[]);
  assert.equal(batch.researchProgress.fullResearch.status,"paused");
  assert.equal(batch.researchProgress.fullResearch.attempts.length,1);
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('button[aria-label="Expand sidebar"]')?.click()`);
  providerCreditsRemaining=35;
}
async function sharedProviderBudgetUiCase(origin) {
  writes.length=0;
  providerCreditsRemaining=979;providerCreditsMonthlyLimit=1000;providerCreditsStatus="available";
  sharedProviderBudget={monthYear:"2026-10",monthlyQuota:250,hardStopAt:200,used:200,remaining:0};
  batches=["NY","CA","TX"].map((state,index)=>({id:`fixture-budget-${role}-${state}`,name:`${state} budget fixture`,
    status:"paused",totalRows:1,createdAt:new Date().toISOString(),researchProgress:{workflow:"unified_leads",
      fullResearch:{status:"paused",enabled:false,notificationId:`budget-${role}-${state}`,startedAt:new Date().toISOString(),
        limits:{businessesPerHour:20,paidCallsPerHour:40,paidCallsPerList:200},processedIds:[],startedRows:[],
        attempts:Array.from({length:[6,15,171][index]},()=>({at:new Date().toISOString(),tool:"business_search",rowId:`row-${state}`})),
        currentRowId:null,nextRunAt:null,error:null}}}));
  const batch=batches[2],before=JSON.stringify(batches);
  rows=[{...unifiedUploadRow({Business:"Budget fixture Grooming",Address:"Austin TX",State:"TX"},0,"fixture-owner"),
    id:"fixture-budget-row",batchId:batch.id,serpCallsUsed:171}];
  const selector=id=>`document.querySelector('[data-testid="${id}"]')`;
  const panel=selector("shared-provider-budget");
  const load=async()=>{await send("Page.navigate",{url:origin+"/leads/"+batch.id});await until(`${panel}?.innerText.includes('200 / 200')`,"shared safety cap");};
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await load();
  assert.equal(await evaluate(`Boolean(${selector("shared-provider-budget-blocked")})`),true);
  if(role==="admin"){
    assert.equal(await evaluate(`${selector("shared-provider-budget-update")}.disabled`),true);
    providerCreditsStatus="unavailable";
    await click("Check provider balance");
    await until(`${selector("shared-provider-budget-consent")}.getAttribute('data-disabled')!==null`,"unverified account blocks budget approval");
    assert.equal(await evaluate(`${selector("shared-provider-budget-update")}.disabled`),true);
    providerCreditsStatus="available";
    await click("Check provider balance");
    await until(`${selector("shared-provider-budget-consent")}.getAttribute('data-disabled')===null`,"verified upgraded account");
    await evaluate(`${selector("shared-provider-budget-consent")}.click()`);
    await click("Confirm shared budget update");
    await until(`${selector("shared-provider-budget-count")}?.innerText==='200 / 800'`,"confirmed shared 800 safety cap");
    assert.equal(await evaluate(`${panel}.innerText.includes('600')`),true);
    assert.equal(await evaluate(`Boolean(${selector("shared-provider-budget-blocked")})`),false);
    assert.equal(await evaluate(`${panel}.innerText.includes('Prior spending is retained')`),true);
    assert.deepEqual(writes,["shared-budget"]);
    assert.equal(JSON.stringify(batches),before,"NY/CA/TX states and complete ledgers are untouched");
    await send("Page.reload",{ignoreCache:true});
    await until(`${selector("shared-provider-budget-count")}?.innerText==='200 / 800'`,"saved budget after reload");
  }else{
    assert.equal(await evaluate(`Boolean(${selector("shared-provider-budget-update")})`),false);
    assert.equal(await evaluate(`Boolean(${selector("shared-provider-budget-consent")})`),false);
    assert.equal(await evaluate(`${panel}.innerText.includes('An administrator can confirm')`),true);
    assert.deepEqual(writes,[]);
  }
  await evaluate(`${panel}.scrollIntoView({block:'center'})`);await pause(300);
  await send("Page.captureScreenshot",{format:"jpeg",quality:70}).then(r=>writeFile(`reports/workflow-fixtures/${role}-shared-provider-budget-desktop.jpg`,Buffer.from(r.data,"base64")));
  await send("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click()`);
  await until(`document.querySelector('button[aria-label="Expand sidebar"]')`,"collapsed shared-budget navigation");
  await evaluate(`${panel}.scrollIntoView({block:'center'})`);await pause(300);
  assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
  await send("Page.captureScreenshot",{format:"jpeg",quality:70}).then(r=>writeFile(`reports/workflow-fixtures/${role}-shared-provider-budget-mobile.jpg`,Buffer.from(r.data,"base64")));
  assert.equal(JSON.stringify(batches),before);
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('button[aria-label="Expand sidebar"]')?.click()`);
  providerCreditsRemaining=35;providerCreditsMonthlyLimit=250;
  sharedProviderBudget={monthYear:"2026-10",monthlyQuota:250,hardStopAt:200,used:200,remaining:0};
}
async function researchedRowsUiCase(origin) {
  const batch={id:"fixture-researched-list",name:"Uploaded research visibility fixture",status:"paused",totalRows:756,
    researchProgress:{workflow:"unified_leads",fullResearch:{status:"paused",enabled:false,
      limits:{businessesPerHour:20,paidCallsPerHour:40,paidCallsPerList:200},attempts:[],startedRows:[],processedIds:[],
      error:"SERP quota or hourly limit reached (20/hour). Please wait.",currentRowId:null,nextRunAt:null}}};
  batches=[batch];writes.length=0;
  rows=Array.from({length:756},(_,index)=>({
    ...unifiedUploadRow({Business:index<750?`Untouched business ${index}`:`Researched grooming ${index-749}`,
      Address:"1 Main Street Austin TX",State:"TX"},index,"fixture-owner"),
    id:`fixture-visible-${index}`,batchId:batch.id,serpCallsUsed:0,
  }));
  const attempted=rows.slice(750);
  batch.researchProgress.fullResearch.startedRows=attempted.map(row=>({id:row.id,at:new Date().toISOString()}));
  batch.researchProgress.fullResearch.processedIds=attempted.map(row=>row.id);
  for(const row of attempted.slice(0,5)){row.status="enriched";row.identityMatchStatus="strong";}
  attempted[5].status="failed";attempted[5].lastError=batch.researchProgress.fullResearch.error;
  await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:origin+"/leads/"+batch.id});
  await until(button("Show researched businesses"),"researched view action");
  await until("document.querySelectorAll('article').length===100","all-view paginated rows");
  assert.equal(await evaluate("document.querySelector('article').innerText.includes('Not researched')"),true);
  await click("Show researched businesses");
  await until("document.querySelectorAll('article').length===6","six attempted businesses found beyond the first page");
  assert.equal(await evaluate("location.search.includes('view=researched')"),true);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('article')).filter(e=>e.innerText.includes('Research complete')).length"),5);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('article')).filter(e=>e.innerText.includes('Stopped at hourly limit')).length"),1);
  assert.equal(await evaluate("document.body.innerText.includes('Untouched business')"),false);
  assert.equal(await evaluate(`Boolean(${button("Load more candidates")})`),false);
  await send("Page.navigate",{url:origin+"/leads/"+batch.id+"?view=researched"});
  await until("document.querySelectorAll('article').length===6","direct researched-view URL");
  await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Search this list…"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Researched grooming 6');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until("document.querySelectorAll('article').length===1","search scoped to researched results");
  assert.equal(await evaluate("document.querySelector('article').innerText.includes('Stopped at hourly limit')"),true);
  await send("Page.navigate",{url:origin+"/leads/"+batch.id+"?view=needs_review"});
  await until("document.querySelectorAll('article').length===5","completed researched businesses awaiting review");
  assert.equal(await evaluate("document.body.innerText.includes('Researched grooming 6')"),false);
  await send("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
  await send("Page.navigate",{url:origin+"/leads/"+batch.id+"?view=researched"});
  await until("document.querySelectorAll('article').length===6","mobile researched results");
  assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
  await evaluate(`document.querySelector('[aria-label="Choose businesses to show"]').scrollIntoView()`);
  await send("Page.captureScreenshot",{format:"jpeg",quality:65})
    .then(r=>writeFile(`reports/workflow-fixtures/${role}-researched-results-mobile.jpg`,Buffer.from(r.data,"base64")));
  assert.deepEqual(writes,[],"finding/review-filtering results never initiates research or outreach");
}
async function api(url,method,body) {
  if(method==="POST"&&/^\/api\/leads\/[^/]+\/shared-provider-budget$/.test(url.pathname)){
    assert.equal(role,"admin");
    assert.deepEqual(body,{confirmed:true,monthlyQuota:1000,hardStopAt:800});
    assert.equal(providerCreditsStatus,"available");assert.ok(providerCreditsMonthlyLimit>=1000);
    sharedProviderBudget={...sharedProviderBudget,monthlyQuota:1000,hardStopAt:800,
      remaining:Math.max(0,800-sharedProviderBudget.used)};
    writes.push("shared-budget");return sharedProviderBudget;
  }
  if(method==="POST"&&/^\/api\/leads\/[^/]+\/full-research(?:\/(?:pause|resume|recover))?$/.test(url.pathname)){
    assert.equal(body.confirmed,true);
    const batch=batches.find(item=>url.pathname.startsWith(`/api/leads/${item.id}/full-research`));assert.ok(batch);
    let run=batch.researchProgress?.fullResearch;
    const action=url.pathname.split("/").at(-1);
    if(action==="full-research"){
      assert.equal(body.businessesPerHour,20);assert.equal(body.paidCallsPerHour,80);
      assert.ok(body.paidCallsPerList===200||body.paidCallsPerList===300);
      run={...run,status:"waiting_hourly",enabled:true,
         notificationId:`fixture-confirmed-${role}-${writes.length}`,startedAt:run?.startedAt??new Date().toISOString(),
        limits:{businessesPerHour:body.businessesPerHour,paidCallsPerHour:body.paidCallsPerHour,paidCallsPerList:body.paidCallsPerList},
        processedIds:run?.processedIds??[],startedRows:run?.startedRows??[],
        attempts:run?.attempts??[],currentRowId:null,nextRunAt:new Date(Date.now()+3600000).toISOString(),error:null};
      writes.push("full-start");
    }else{
      assert.ok(run);
      run={...run,enabled:action==="resume",status:action==="resume"?"waiting_hourly":"paused",
        currentRowId:action==="recover"?null:run.currentRowId};
      writes.push(`full-${action}`);
    }
    batch.researchProgress={...batch.researchProgress,fullResearch:run};batch.status="paused";return batch;
  }
  if(url.pathname==="/api/auth/user")return {id:"fixture-owner",role,firstName:"Fixture",lastName:"Salesperson",email:"fixture@example.invalid"};
  if(method==="GET"&&url.pathname==="/api/leads")return batches;
  if(method==="GET"&&/^\/api\/leads\/[^/]+\/provider-credits$/.test(url.pathname))return {
    status:providerCreditsStatus,remaining:providerCreditsStatus==="available"?providerCreditsRemaining:null,
    monthlyLimit:providerCreditsStatus==="available"?providerCreditsMonthlyLimit:null,
    usedThisMonth:providerCreditsStatus==="available"?providerCreditsMonthlyLimit-providerCreditsRemaining:null,
    checkedAt:new Date().toISOString(),sharedBudget:sharedProviderBudget
  };
  if(method==="POST"&&url.pathname==="/api/leads/upload-preview"){
    assert.ok(body.rows.length===3);return {inputCount:3,invalidCount:0,duplicateCount:0,rows:body.rows.map((raw,i)=>({rowNumber:i+1,businessName:raw["Business Name"],email:raw.Email,action:"Stage for review; no research or contacts."}))};
  }
  if(method==="POST"&&url.pathname==="/api/leads/upload"){
    assert.equal(body.confirmed,true);
    rows=body.rows.map((raw,i)=>({...unifiedUploadRow(raw,i,"fixture-owner",body.columnMapping),id:`fixture-row-${i}`,batchId:"fixture-batch",processedAt:null,serpCallsUsed:0}));
    batches=[{id:"fixture-batch",name:"Fixture list",status:"completed",totalRows:3,createdAt:"2026-10-04T12:00:00Z"}];
    writes.push("upload");return {batch:batches[0],stagedCount:3};
  }
  if(method==="GET"&&batches.some(batch=>url.pathname===`/api/leads/${batch.id}`)){
    const batch=batches.find(batch=>url.pathname===`/api/leads/${batch.id}`);
    const research=leadResearchResults(rows,batch.researchProgress);
    const selected=filterLeadResearchRows(rows,research.states,url.searchParams.get("view")||"all",url.searchParams.get("search")||"");
    const offset=Number(url.searchParams.get("offset")||0),limit=Math.min(100,Number(url.searchParams.get("limit")||50));
    return {batch,researchSummary:research.summary,
      rows:selected.slice(offset,offset+limit).map(r=>({...leadView(r),researchState:research.states.get(r.id),ownerName:r.evidence?.ownerName,dealId:r.dealId||null})),
      total:selected.length,nextOffset:offset+limit<selected.length?offset+limit:null,linkedRows:[]};
  }
  if(method==="GET"&&url.pathname==="/api/lead-discovery/jobs")return [
    {id:"fixture-search-job",state:"TX",zipCodes:"78701",status:"completed",totalBusinessesFound:1,createdAt:"2026-10-04T12:00:00Z"},
    {id:"fixture-empty-job",state:"PA",zipCodes:"19102",status:"completed",totalBusinessesFound:0,createdAt:"2026-10-03T12:00:00Z"},
  ];
  if(method==="POST"&&url.pathname==="/api/leads/discovery/fixture-search-job/preview")return failSearchSave
    ? {__httpStatus:400,message:"Fixture database error: search could not be saved"}
    : {count:1,duplicateCount:0,duplicates:[]};
  if(method==="POST"&&url.pathname==="/api/leads/discovery/fixture-search-job"){
    assert.equal(body.confirmed,true);assert.equal(body.duplicateAction,"link");scheduled=false;
    const raw={"Business Name":"Fixture Search Grooming",Address:"1 Main Street Austin TX",State:"TX",Email:"team@fixture-search.example","Email Source URL":"https://fixture-search.example/contact","Email Review Status":"review_only","Provider category":"Pet groomer",Notes:"Saved matched business search. General contact email needs review."};
    rows=[{...unifiedUploadRow(raw,0,"fixture-owner"),id:"fixture-search-row",batchId:"fixture-search-batch",serpCallsUsed:0}];
    const batch={id:"fixture-search-batch",name:"Saved search fixture",status:"completed",totalRows:1,createdAt:"2026-10-04T12:00:00Z"};
    batches.push(batch);writes.push("search-stage");return {batch,stagedCount:1,linkedCount:0};
  }
  if(method==="POST"&&url.pathname==="/api/salon-owner-names/estimate"){
    assert.equal(body.searchesPerRow,1);assert.equal(body.rowIds.length,1);
    return {maxProviderCalls:1,maxPages:4,remainingCredits:100,allowed:true,searchesPerRow:1};
  }
  if(method==="POST"&&url.pathname==="/api/salon-owner-names/search"){
    assert.equal(body.confirmed,true);assert.equal(body.maxProviderCalls,1);assert.equal(body.searchesPerRow,1);
    const target=rows.find(item=>item.id===body.rowIds[0]);assert.ok(target);
    target.evidence={...target.evidence,ownerName:fixtureOwnerName(target.businessName,true)};
    return {callsUsed:1,results:[{rowId:target.id,ownerName:target.evidence.ownerName}]};
  }
   if(method==="GET"&&url.pathname.endsWith("/estimate"))return {eligibleRows:1,maxProviderCalls:2,active:researchActive,reason:fullResearchReadOnlyReason};
  if(method==="POST"&&url.pathname==="/api/leads/fixture-batch/research"){
    assert.equal(body.confirmed,true);researchActive=true;
    batches[0].status="running";batches[0].researchProgress={leadResearch:{rowIds:["fixture-row-2"],processedIds:[],attemptedCalls:0,providerCalls:0,cacheHits:0,maxProviderCalls:body.maxProviderCalls}};
    rows[2].status="processing";
    setTimeout(()=>{
      researchActive=false;batches[0].status="completed";batches[0].researchProgress.leadResearch.processedIds=["fixture-row-2"];
      rows[2].status="enriched";rows[2].sourceData.uploadedEmailCandidate="new@fixture-unresolved.example";
      rows[2].sourceData.historicalSourceUrl="https://fixture-unresolved.example/contact";
    },2500);
    return {batch:batches[0],started:true};
  }
  const row=rows.find(r=>url.pathname.includes(`/rows/${r.id}/`));
  if(row&&url.pathname.endsWith("/history"))return {label:scheduled?"Already scheduled":null,history:scheduled?[{status:"scheduled",date:"2026-10-05T12:00:00Z"}]:[],crossOwner:false};
  if(row&&url.pathname.endsWith("/sequences")){
    const contact=linkedContact(row);if(contact)linkedPreviewReads++;
    return {sequences:[{...fixtureSequence,...(contact?renderLeadSequencePreview(fixtureSequence,contact,fixtureSender):{renderedSubject:null,renderedBody:null,greetingPreview:null,previewFingerprint:null})}],history:{label:scheduled?"Already scheduled":null,history:[],crossOwner:false},contact};
  }
  if(row&&method==="POST"){
    assert.equal(body.confirmed,true);
    if(url.pathname.endsWith("/review")){
      const evidence=historicalApprovalEvidence(row,body);row.email=evidence.value;row.identityMatchStatus="strong";row.reviewStatus="approved";row.status="enriched";row.evidence={...row.evidence,email:evidence,ownerName:fixtureOwnerName(row.businessName)};
      writes.push("review");return row;
    }
    if(url.pathname.endsWith("/crm")){
      assert.equal(row.reviewStatus,"approved");
      if(row.batchId==="fixture-batch"&&!body.linkContactId)return {needsDuplicateReview:true,duplicates:[{id:"fixture-email-contact",company:"Existing email match",email:row.email,matchReasons:["Email address"]},{id:"fixture-phone-contact",company:"Existing phone-linked business",email:"existing@fixture-contact.example",phone:"5125550100",address:row.address,matchReasons:["Phone number"]}]};
      if(row.batchId==="fixture-batch")assert.equal(body.linkContactId,"fixture-phone-contact");
      row.importedContactId=body.linkContactId||"fixture-contact";writes.push("crm");return {contactId:row.importedContactId,linked:!!body.linkContactId};
    }
    if(url.pathname.endsWith("/pipeline")){assert.ok(row.importedContactId);row.dealId="fixture-deal";writes.push("pipeline");return {dealId:row.dealId};}
    if(url.pathname.endsWith("/schedule")){assert.ok(row.dealId);assert.ok(new Date(body.scheduledSendAt)>new Date());assert.equal(scheduled,false);
      const contact=linkedContact(row);assert.equal(body.previewRecipient,contact.email);assert.equal(body.previewFingerprint,renderLeadSequencePreview(fixtureSequence,contact,fixtureSender).previewFingerprint);
      scheduled=true;writes.push("schedule");return {successful:true};}
  }
  if(method==="GET")return [];
  throw new Error(`Unexpected fixture mutation ${method} ${url.pathname}`);
}
try {
  let port;
  for(let attempt=0;attempt<100;attempt++){try{port=Number((await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);break;}catch{await pause(100);}}
  assert.ok(port);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(pages.find(p=>p.type==="page").webSocketDebuggerUrl);
  await new Promise(r=>ws.once("open",r));
  ws.on("message",async raw=>{
    const message=JSON.parse(raw);
    if(message.id){const p=pending.get(message.id);if(!p)return;clearTimeout(p.timer);pending.delete(message.id);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);return;}
    if(message.method==="Fetch.requestPaused"){
      try{const request=message.params.request,body=request.postData?JSON.parse(request.postData):{};
        const payload=await api(new URL(request.url),request.method,body);
        await send("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:payload?.__httpStatus||200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(payload)).toString("base64")});
      }catch(error){errors.push(error.message);await send("Fetch.failRequest",{requestId:message.params.requestId,errorReason:"BlockedByClient"});}
    }else if(message.method==="Page.javascriptDialogOpening"){
      await send("Page.handleJavaScriptDialog",{accept:true,promptText:"link"});
    }else if(message.method==="Runtime.exceptionThrown")errors.push(message.params.exceptionDetails.exception?.description);
  });
  await send("Page.enable");await send("Runtime.enable");await send("DOM.enable");
  await send("Fetch.enable",{patterns:[{urlPattern:"*://*/api/*"}]});
  const origin="http://127.0.0.1:5000";
  await mkdir("reports/workflow-fixtures",{recursive:true});
  for(const currentRole of ["salesperson","admin"]){
    role=currentRole;rows=[];batches=[];scheduled=false;researchActive=false;linkedPreviewReads=0;writes.length=0;
    if(process.argv.includes("--shared-budget-only")){
      await sharedProviderBudgetUiCase(origin);
      continue;
    }
    if(process.argv.includes("--provider-credits-only")){
      await providerCreditsUiCase(origin);
      continue;
    }
    if(process.argv.includes("--future-hourly-only")){
      await futureResearchDefaultsUiCase(origin);
      await fullResearchUiCase(origin);
      continue;
    }
    if(process.argv.includes("--grooming-only")){
      await groomingUiCase(origin);
      continue;
    }
    await send("Emulation.setDeviceMetricsOverride",{width:1365,height:900,deviceScaleFactor:1,mobile:false});
    await send("Page.navigate",{url:origin+"/leads?upload=1"});
    await until("document.body.innerText.includes('Search for Businesses')","Leads home");
    const doc=await send("DOM.getDocument"), input=await send("DOM.querySelector",{nodeId:doc.root.nodeId,selector:"input[type=file]"});
    await send("DOM.setFileInputFiles",{nodeId:input.nodeId,files:[resolve("scripts/fixtures/leads-workflow.csv")]});
    await until("document.body.innerText.includes('Preview')","upload columns");
    await click("Preview list");
    await until(button("Confirm and add to Leads"),"completed upload preview");
    assert.equal(writes.length,0);
    await evaluate("Array.from(document.querySelectorAll('label')).find(e=>e.textContent.includes('I understand uploaded emails')).querySelector('[role=checkbox]').click()");
    await click("Confirm and add to Leads");
    await until("document.querySelector('article')?.innerText.includes('Fixture Grooming')","staged list");
    assert.deepEqual(writes,["upload"]);assert.ok(rows.every(row=>row.email===null&&row.reviewStatus!=="approved"));
    await click("Review estimate & research");await click("Confirm research");
    await until("document.body.innerText.includes('Shared research progress')","nested research progress contract");
    await until("document.body.innerText.includes('new@fixture-unresolved.example')","asynchronous research completion updates candidates without navigation");
    assert.equal(researchActive,false);
    await reviewThroughScheduling("upload");
    await send("Page.captureScreenshot",{format:"jpeg",quality:65}).then(r=>writeFile(`reports/workflow-fixtures/${role}-desktop.jpg`,Buffer.from(r.data,"base64")));
    await send("Emulation.setDeviceMetricsOverride",{width:402,height:874,deviceScaleFactor:1,mobile:true});
    await send("Page.navigate",{url:origin+"/leads/fixture-batch"});
    await until("document.querySelector('article')","mobile list");
    assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"),false);
    await send("Page.captureScreenshot",{format:"jpeg",quality:65}).then(r=>writeFile(`reports/workflow-fixtures/${role}-mobile.jpg`,Buffer.from(r.data,"base64")));
    for(const path of ["/salon-enrichment/fixture-batch","/salon-search-report?batchId=fixture-batch","/lead-discovery"]){
      await send("Page.navigate",{url:origin+path});await until("location.pathname.startsWith('/leads')","legacy route");
    }
    writes.length=0;
    await send("Page.navigate",{url:origin+"/leads"});
    await until("document.body.innerText.includes('TX · ZIP 78701') && document.body.innerText.includes('1 saved business')","legacy search labels and real result count");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).filter(e=>e.textContent.trim()==='Save in Leads'&&e.disabled).length"),1);
    failSearchSave=true;
    await click("Save in Leads");
    await until("document.body.innerText.includes('Search could not be saved') && document.body.innerText.includes('Fixture database error')","visible search save failure");
    assert.equal(writes.length,0);
    failSearchSave=false;
    await click("Save in Leads");
    await until("document.body.innerText.includes('Saved search fixture')","saved search staged in common workspace");
    await until("location.pathname==='/leads/fixture-search-batch'","successful save opens its list");
    assert.deepEqual(writes,["search-stage"]);assert.ok(rows.every(row=>!row.email&&!row.importedContactId&&row.reviewStatus!=="approved"));
    await send("Page.navigate",{url:origin+"/leads/fixture-search-batch"});
    await until("document.querySelector('article')?.innerText.includes('Fixture Search Grooming')","search-source review");
    await reviewThroughScheduling("search-stage");
    await fullResearchUiCase(origin);
    await groomingUiCase(origin);
    await futureResearchDefaultsUiCase(origin);
    await researchStatusUiCase(origin);
    await providerCreditsUiCase(origin);
    await sharedProviderBudgetUiCase(origin);
    await researchedRowsUiCase(origin);
  }
  assert.deepEqual(errors,[]);
   console.log(process.argv.includes("--grooming-only") ?
    "PASS: exact-business grooming Yes/No/Unknown, inspectable sources, separate unverified Google AI answers, prominent contact and email, darker/thicker borders, approved/unverified states and corrected-address protection. Administrator/salesperson desktop/mobile; all APIs intercepted and zero writes." :
    process.argv.includes("--future-hourly-only") ?
    "PASS: new confirmed searches use 20/80/200 defaults; saved 40/hour runs retain caps/history across viewing and resume; completion offers a new default without mutation; form edits survive polling; desktop/mobile administrator/salesperson checks. All APIs intercepted; no live records or providers used." :
    process.argv.includes("--shared-budget-only") ?
    "PASS: admin-confirmed shared 1,000/800 budget, salesperson read-only view, unavailable-account protection, preserved NY/CA/TX ledgers and paused states, reload, desktop/mobile. All API traffic intercepted." :
    process.argv.includes("--provider-credits-only") ?
    "PASS: administrator/salesperson provider credits beside list cap; available, zero, unknown and refreshed balances, paused-state preservation and readable desktop/mobile layouts. All API traffic intercepted." :
    "PASS: administrator/salesperson upload/search → review → CRM → Pipeline → separate scheduling; research status lifecycle, once-per-run popups, new runs, list switching, reduced motion, keyboard focus, desktop/mobile, controls and researched filtering. All API traffic intercepted; no real records or providers used.");
} finally {
  ws?.close();
  if(chrome.exitCode===null && chrome.signalCode===null){
    const exited=new Promise(done=>chrome.once("exit",done));
    chrome.kill("SIGTERM");
    await Promise.race([exited,pause(2000)]);
    if(chrome.exitCode===null && chrome.signalCode===null){
      chrome.kill("SIGKILL");await exited;
    }
  }
  // Chromium's children can briefly keep writing the temporary profile after
  // shutdown. Retrying cleanup must not turn successful assertions into a fail.
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
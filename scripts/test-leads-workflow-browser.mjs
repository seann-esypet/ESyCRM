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
const profile = await mkdtemp(join(tmpdir(),"leads-browser-"));
const chrome = spawn("chromium",["--headless","--no-sandbox","--disable-dev-shm-usage","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
const pending=new Map(),errors=[],writes=[];
let ws,id=0,role="salesperson",rows=[],batches=[],scheduled=false,researchActive=false,linkedPreviewReads=0,failSearchSave=false;
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
  for(let attempt=0;attempt<120;attempt++){try{if(await evaluate(`Boolean(${expression})`))return;}catch{}await pause(100);}
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
  assert.equal(await evaluate(`${selector("full-research-paid-hour")}.value`),"40");
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
async function api(url,method,body) {
  if(method==="POST"&&/^\/api\/leads\/[^/]+\/full-research(?:\/(?:pause|resume|recover))?$/.test(url.pathname)){
    assert.equal(body.confirmed,true);
    const batch=batches.find(item=>url.pathname.startsWith(`/api/leads/${item.id}/full-research`));assert.ok(batch);
    let run=batch.researchProgress?.fullResearch;
    const action=url.pathname.split("/").at(-1);
    if(action==="full-research"){
      assert.equal(body.businessesPerHour,20);assert.equal(body.paidCallsPerHour,40);
      assert.ok(body.paidCallsPerList===200||body.paidCallsPerList===300);
      run={...run,status:"waiting_hourly",enabled:true,
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
    return {batch:batches.find(batch=>url.pathname===`/api/leads/${batch.id}`),rows:rows.map(r=>({...leadView(r),ownerName:r.evidence?.ownerName,dealId:r.dealId||null})),total:rows.length,nextOffset:null,linkedRows:[]};
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
  if(method==="GET"&&url.pathname.endsWith("/estimate"))return {eligibleRows:1,maxProviderCalls:2,active:researchActive};
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
  }
  assert.deepEqual(errors,[]);
   console.log("PASS: administrator/salesperson fixture upload AND saved search → review → CRM → Pipeline → separately confirmed scheduling, mobile layouts, legacy routes. All API traffic intercepted; no real records or providers used.");
} finally {
  ws?.close();chrome.kill("SIGTERM");await pause(200);await rm(profile,{recursive:true,force:true});
}
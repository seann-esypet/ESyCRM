import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGroomingPages, researchGroomingChecks } from "./groomingChecks";
import { readGroomingChecks } from "@shared/groomingChecks";
import { parseOwnerSearchResponse } from "./salonOwnerSearchResults";

const row: any = { businessName:"Paws and Co",address:"123 Main Street, Austin TX 78701",
  address1:"123 Main Street",city:"Austin",state:"TX",zipCode:"78701",category:"pet groomer" };
const page = (statement:string,address="123 Main Street Austin TX 78701") =>
  ({url:"https://fixture.example/services",html:`<h1>Paws and Co</h1><p>${statement}</p><footer>${address}</footer>`});
test("services and dedicated-shop checks stay separate with attributable live evidence",()=>{
  const salon=evaluateGroomingPages(row,[page("We are a dedicated dog grooming salon. We offer pet grooming services.")]);
  assert.equal(salon.offersGrooming.answer,"Yes");assert.equal(salon.groomingShop.answer,"Yes");
  assert.match(salon.offersGrooming.sources[0].excerpt,/123 Main Street/);
  const store=evaluateGroomingPages(row,[page("We are a pet store. We offer dog grooming services.")]);
  assert.equal(store.offersGrooming.answer,"Yes");assert.equal(store.groomingShop.answer,"No");
  const vet=evaluateGroomingPages(row,[page("We are an animal hospital. We offer grooming for dogs.")]);
  assert.equal(vet.offersGrooming.answer,"Yes");assert.equal(vet.groomingShop.answer,"No");
  const mobile=evaluateGroomingPages(row,[page("We offer dog grooming services. We are exclusively mobile.")]);
  assert.equal(mobile.offersGrooming.answer,"Yes");assert.equal(mobile.groomingShop.answer,"No");
});
test("only explicit negatives establish No; missing, historical and mismatched evidence stays Unknown",()=>{
  assert.equal(evaluateGroomingPages(row,[page("We do not offer dog grooming services.")]).offersGrooming.answer,"No");
  assert.equal(evaluateGroomingPages(row,[page("Our dog grooming appointments are not available.")]).offersGrooming.answer,"No");
  assert.equal(evaluateGroomingPages(row,[page("Welcome to Paws and Co.")]).offersGrooming.answer,"Unknown");
  assert.equal(evaluateGroomingPages(row,[page("We formerly offered dog grooming services.")]).offersGrooming.answer,"Unknown");
  assert.equal(evaluateGroomingPages(row,[page("Does Paws and Co offer dog grooming services?")]).offersGrooming.answer,"Unknown");
  assert.equal(evaluateGroomingPages(row,[page("We offer pet grooming services.","999 Other Street Dallas TX 75001")]).offersGrooming.answer,"Unknown");
  assert.equal(evaluateGroomingPages(row,[page("<blockquote>We offer pet grooming services.</blockquote>")]).offersGrooming.answer,"Unknown");
  assert.equal(evaluateGroomingPages({...row,businessName:"Dog Grooming Services"},[
    {url:"https://fixture.example",html:"Dog Grooming Services 123 Main Street Austin TX 78701"}]).offersGrooming.answer,"Unknown");
});
test("contradictory sources are review-only and corrected business/address invalidates findings",()=>{
  const second={...page("We do not offer pet grooming services."),url:"https://fixture.example/location"};
  const result=evaluateGroomingPages(row,[page("We offer pet grooming services."),second]);
  assert.equal(result.offersGrooming.answer,"Unknown");assert.equal(result.offersGrooming.sources.length,2);
  assert.match(result.offersGrooming.reason,/conflict/);
  assert.ok(readGroomingChecks(result,row));
  assert.equal(readGroomingChecks(result,{...row,address:"999 Other Street"}),null);
  assert.equal(readGroomingChecks(result,{...row,businessName:"Other Business"}),null);
  assert.equal(readGroomingChecks({garbage:true},row),null);
});
test("reused pages settle both questions without new searches",async()=>{
  const result=await researchGroomingChecks(row,[page("We are a dog grooming salon.")],[],async()=>{throw Error("Unexpected paid attempt");},
    undefined,()=>{},{searchSalonGroomingPages:async()=>{throw Error("Unexpected search");},fetchPublicResearchPage:async()=>{throw Error("Unexpected fetch");}});
  assert.equal(result.offersGrooming.answer,"Yes");assert.equal(result.groomingShop.answer,"Yes");assert.equal(result.providerCalls,0);
});
test("Google AI answers are retained as hints, cited pages are verified, and search summaries alone never establish Yes",async()=>{
  const ledger:string[]=[];
  const policy:any={hourlyLimit:80,onReservationBlocked:async()=>{}};
  const ai={summaryKind:"google_ai_overview" as const,title:"Google AI Overview",snippet:"Paws and Co offers pet grooming services.",
    link:"https://www.google.com/search?q=fixture",citations:[{link:"https://fixture.example/services",title:"Paws and Co"}]};
  const tools:any={
    searchSalonGroomingPages:async(_row:any,_question:any,before:any,received:any)=>{
      assert.equal(received,policy);await before();return{results:[ai],calls:1};
    },
    fetchPublicResearchPage:async()=>page("Welcome. We have not stated any grooming services here."),
  };
  const unverified=await researchGroomingChecks(row,[],[],async tool=>{ledger.push(tool);},policy,()=>{},tools);
  assert.equal(unverified.offersGrooming.answer,"Unknown");
  assert.equal(unverified.aiAnswers.length,2);assert.equal(unverified.providerCalls,2);
  assert.deepEqual(ledger,["grooming_services_search","grooming_shop_search"]);
  tools.fetchPublicResearchPage=async()=>page("We are a dog grooming salon.");
  const verified=await researchGroomingChecks(row,[],[],async()=>{},policy,()=>{},tools);
  assert.equal(verified.offersGrooming.answer,"Yes");assert.equal(verified.groomingShop.answer,"Yes");
  assert.equal(verified.providerCalls,1);
  assert.equal(verified.offersGrooming.sources[0].url,"https://fixture.example/services");
});
test("provider interruption preserves partial findings and never bypasses paid authorization",async()=>{
  let attempts=0,latest:any;
  const tools:any={
    searchSalonGroomingPages:async(_row:any,question:any,before:any)=>{
      await before();if(question==="shop")throw Error("Provider temporarily rate limited");
      return{results:[{link:"https://fixture.example/services"}],calls:1};
    },
    fetchPublicResearchPage:async()=>page("We offer pet grooming services."),
  };
  await assert.rejects(researchGroomingChecks(row,[],[],async()=>{attempts++;},undefined,result=>{latest=result;},tools),/rate limited/);
  assert.equal(attempts,2);assert.equal(latest.providerCalls,2);assert.equal(latest.offersGrooming.answer,"Yes");
  attempts=0;
  await assert.rejects(researchGroomingChecks(row,[],[],async()=>{throw Error("List budget stop");},undefined,()=>{},tools),/List budget stop/);
  assert.equal(attempts,0);
});
test("cached searches and absent addresses do not initiate paid requests",async()=>{
  const tools:any={searchSalonGroomingPages:async()=>({results:[],calls:0}),
    fetchPublicResearchPage:async()=>{throw Error("Unexpected fetch");}};
  const result=await researchGroomingChecks(row,[],[],async()=>{throw Error("Unexpected paid call");},undefined,()=>{},tools);
  assert.equal(result.providerCalls,0);assert.equal(result.offersGrooming.answer,"Unknown");
  tools.searchSalonGroomingPages=async()=>{throw Error("Unexpected search without street");};
  assert.equal((await researchGroomingChecks({...row,address:"",address1:null},[],[],async()=>{},undefined,()=>{},tools)).providerCalls,0);
});
test("grooming-only inline AI Overview parsing does not change owner-query behavior or invent missing token text",()=>{
  const payload={ai_overview:{text_blocks:[{type:"paragraph",snippet:"Paws and Co offers pet grooming services at 123 Main Street."}]}};
  assert.equal(parseOwnerSearchResponse(payload,row.businessName,"fixture").results.length,0);
  assert.equal(parseOwnerSearchResponse(payload,row.businessName,"fixture","grooming").results[0].summaryKind,"google_ai_overview");
  const token=parseOwnerSearchResponse({ai_overview:{page_token:"unread-token"}},row.businessName,"fixture","grooming");
  assert.equal(token.results.length,0);assert.match(token.notice!,/did not make that extra paid request/);
});
test("both AI questions remain available after the bounded page-fetch allowance is used",async()=>{
  const asked:string[]=[];
  let pagesFetched=0;
  const tools:any={
    searchSalonGroomingPages:async(_row:any,question:any,before:any)=>{
      asked.push(question);await before();return{results:[{summaryKind:"google_ai_overview",snippet:"Paws and Co may offer grooming.",
        link:"https://www.google.com/search?q=fixture",citations:[]}],calls:1};
    },
    fetchPublicResearchPage:async(url:string)=>{pagesFetched++;return{url,html:"An unrelated business page"};},
  };
  const result=await researchGroomingChecks(row,[],[1,2,3,4].map(i=>`https://fixture.example/page-${i}`),async()=>{},undefined,()=>{},tools);
  assert.deepEqual(asked,["services","shop"]);assert.equal(pagesFetched,4);
  assert.equal(result.providerCalls,2);assert.equal(result.aiAnswers.length,2);
  assert.equal(result.offersGrooming.answer,"Unknown");
  assert.match(result.notes.at(-1)!,/four-page verification limit/);
});

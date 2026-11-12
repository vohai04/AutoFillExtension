import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditInPage} from '../rescom-security-check/audit.mjs';

const ATTEMPT='00000000-0000-4000-8000-000000000001';
const RESPONSE='00000000-0000-4000-8000-000000000002';
const FORM='2685da5c-0e06-45ec-be24-41907c7a67ab';
const SECRET='dummy-csrf-never-export';
function fixture(options={}) {
  const now=Date.now();
  const earliest=now+(options.remainingMs??60000);
  let submitted=false;
  const requests=[];
  const attempt={attemptId:ATTEMPT,responseId:RESPONSE,formId:FORM,type:'INTERNAL',
    status:'IN_PROGRESS',submittedAt:null,survey:{title:'Test'},
    form:{title:'Test',blocks:[{id:'test-question',type:'text'}]},
    timeBarrier:{requiredSeconds:60,earliestSubmitAt:new Date(earliest).toISOString()},
    ...options.attempt};
  globalThis.location={origin:options.origin??'https://www.rescom.io.vn',pathname:`/attempts/${ATTEMPT}`};
  globalThis.fetch=async(path,init={})=>{
    requests.push({path,init});
    assert.equal(init.credentials,'same-origin');
    assert.equal(init.redirect,'error');
    const headers={'Content-Type':'application/json'};
    if(!options.noDate)headers.Date=new Date(now).toUTCString();
    const result=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(path===`/api/attempts/${ATTEMPT}`)return result({data:{...attempt,...submitted?{status:'COMPLETED'}:{}}});
    if(path==='/api/auth/csrf')return result(options.csrfFailure?{error:{code:'AUTH_CSRF_UNAVAILABLE'}}:{data:{csrfToken:SECRET}},options.csrfFailure?403:200);
    assert.equal(path,`/api/responses/${RESPONSE}/submit`);
    assert.equal(init.method,'POST');
    assert.equal(init.headers['X-CSRF-Token'],SECRET);
    assert.match(JSON.parse(init.body).answers['test-question'],/^SECURITY_TEST_APPROVED/);
    if(options.networkFailure)throw Error('lost connection');
    if(options.accept || options.acceptLate){
      submitted=true;
      return result({data:{attemptId:ATTEMPT,responseId:RESPONSE,status:'VALIDATED',
        submittedAt:new Date(options.acceptLate?earliest+1000:now+1000).toISOString()}});
    }
    if(options.malformedSuccess)return result({data:{ok:true}});
    if(options.rateLimit)return result({error:{code:'PARTICIPATION_RATE_LIMITED'}},429);
    if(options.otherError)return result({error:{code:'VALIDATION_ERROR'}},400);
    return result({error:{code:'SUBMISSION_TOO_FAST',details:{remainingSeconds:59,retryAfterSeconds:59}}},422);
  };
  return {requests,posts:()=>requests.filter(r=>r.init.method==='POST')};
}

test('inspection reads one attempt without CSRF or submissions',async()=>{
  const f=fixture();const r=await auditInPage({mode:'inspect'});
  assert.equal(r.outcome,'READY');assert.equal(f.requests.length,1);assert.equal(f.posts().length,0);
});
test('server rejects all three direct early submissions',async()=>{
  const f=fixture();const r=await auditInPage({mode:'probe',maxPosts:100});
  assert.equal(r.outcome,'EARLY_SUBMIT_REJECTED');assert.equal(f.posts().length,3);
  assert.equal(JSON.stringify(r).includes(SECRET),false);
});
test('a vulnerable fixture is a candidate only after confirmed validation',async()=>{
  const f=fixture({accept:true});const r=await auditInPage({mode:'probe',maxPosts:3});
  assert.equal(r.outcome,'EARLY_ACCEPTANCE_CANDIDATE');assert.equal(r.confirmedCompleted,true);assert.equal(f.posts().length,1);
});
test('acceptance after the deadline is not reported as bypass',async()=>{
  const f=fixture({acceptLate:true});const r=await auditInPage({mode:'probe',maxPosts:3});
  assert.equal(r.outcome,'ACCEPTED_AFTER_DEADLINE');assert.equal(f.posts().length,1);
});
test('HTTP success without VALIDATED data is inconclusive',async()=>{
  const f=fixture({malformedSuccess:true});const r=await auditInPage({mode:'probe',maxPosts:3});
  assert.equal(r.outcome,'INCONCLUSIVE');assert.equal(f.posts().length,1);
});
test('429 stops immediately without quota evasion',async()=>{
  const f=fixture({rateLimit:true});const r=await auditInPage({mode:'probe',maxPosts:3});
  assert.equal(r.outcome,'RATE_LIMIT_ENFORCED');assert.equal(f.posts().length,1);
});
test('ambiguous network outcome is never automatically replayed',async()=>{
  const f=fixture({networkFailure:true});const r=await auditInPage({mode:'probe',maxPosts:3});
  assert.equal(r.outcome,'INCONCLUSIVE');assert.equal(f.posts().length,1);
});
test('different host is rejected before any request',async()=>{
  const f=fixture({origin:'https://example.com'});const r=await auditInPage({mode:'probe',maxPosts:3});
  assert.equal(r.outcome,'OUT_OF_SCOPE');assert.equal(f.requests.length,0);
});
test('different survey and completed attempt produce no POST',async()=>{
  let f=fixture({attempt:{formId:'00000000-0000-4000-8000-000000000099'}});
  assert.equal((await auditInPage({mode:'probe',maxPosts:3})).outcome,'OUT_OF_SCOPE');assert.equal(f.posts().length,0);
  f=fixture({attempt:{status:'COMPLETED'}});
  assert.equal((await auditInPage({mode:'probe',maxPosts:3})).outcome,'ATTEMPT_CLOSED');assert.equal(f.posts().length,0);
});
test('expired window, missing server time and failed CSRF cause no submissions',async()=>{
  for(const [options,outcome] of [[{remainingMs:0},'WINDOW_TOO_SHORT'],[{noDate:true},'TIMING_UNKNOWN'],[{csrfFailure:true},'CSRF_UNAVAILABLE']]){
    const f=fixture(options);const r=await auditInPage({mode:'probe',maxPosts:3});
    assert.equal(r.outcome,outcome);assert.equal(f.posts().length,0);
  }
});
test('no explicit budget means no submissions',async()=>{
  const f=fixture();const r=await auditInPage({mode:'probe'});
  assert.equal(r.outcome,'BUDGET_EXHAUSTED');assert.equal(f.posts().length,0);
});
test('unsupported question types never get fabricated answers',async()=>{
  const f=fixture({attempt:{form:{title:'Test',blocks:[{id:'x',type:'file_upload'}]}}});
  assert.equal((await auditInPage({mode:'probe',maxPosts:3})).outcome,'UNSUPPORTED_FIXTURE');assert.equal(f.posts().length,0);
});

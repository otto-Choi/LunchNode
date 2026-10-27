const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../lib/group-node/service.ts');
const input={title:'동기 산책',description:'같이 걸어요',category:'hiking',minPeople:2,visibility:'all',dates:[{date:'2027-01-10',time:'10:00'}]};
const id='10000000-0000-4000-8000-000000000005';
test('meetup input validates real dates, duplicate candidates, categories and 10-minute times',async()=>{
 const {meetupInput}=await ready;assert.deepEqual(meetupInput(input),input);
 for(const patch of [{title:''},{category:'constructor'},{category:'bad'},{minPeople:1},{minPeople:41},{visibility:'public'},{dates:[]},{dates:[{date:'2027-02-30'}]},{dates:[{date:'2027-01-10',time:'24:00'}]},{dates:[{date:'2027-01-10',time:'12:35'}]},{dates:[input.dates[0],input.dates[0]]}])assert.throws(()=>meetupInput({...input,...patch}));
 assert.equal(meetupInput({...input,dates:[{date:'2027-01-10',time:''}]}).dates[0].time,null);
});
test('group API derives the actor from a tenant-bound cookie and ignores forged ownership',async()=>{
 const {groupNodeRequest}=await ready;const calls=[];const rpc=async(name,args)=>{calls.push({name,args});return {ok:true};};
 const req=new Request('https://test/api/group-node',{method:'POST',headers:{origin:'https://test','content-type':'application/json',cookie:'global_lunch_session='+'a'.repeat(64)},body:JSON.stringify({action:'create',...input,createdBy:'forged',tenant:'ax'})});
 const result=await groupNodeRequest(req,{rpc,tenant:'global',cookieName:'global_lunch_session',origin:'https://test',limit:async()=>true});assert.equal(result.status,200);
 const call=calls[0];assert.equal(call.name,'group_node_api');assert.equal(call.args.p_tenant,'global');assert.equal(call.args.p_action,'create');assert.deepEqual(call.args.p_payload,input);assert.notEqual(call.args.p_token_hash,'a'.repeat(64));
});
test('group API blocks missing sessions, cross-origin writes and malformed actions before writes',async()=>{
 const {groupNodeRequest}=await ready;let writes=0;const opts={rpc:async()=>{writes++;return {};},limit:async()=>true,tenant:'ax',cookieName:'ax_lunch_session',origin:'https://test'};
 await assert.rejects(groupNodeRequest(new Request('https://test/api/group-node'),opts),e=>e.status===401);
 const req=body=>new Request('https://test/api/group-node',{method:'POST',headers:{origin:'https://evil','content-type':'application/json',cookie:'ax_lunch_session='+'a'.repeat(64)},body:JSON.stringify(body)});
 await assert.rejects(groupNodeRequest(req({action:'create',...input}),opts),e=>e.status===403);assert.equal(writes,0);
 const valid=req({action:'delete',id});valid.headers.set('origin','https://test');await assert.rejects(groupNodeRequest(valid,opts),e=>e.status===400);assert.equal(writes,0);
});

test('clubs accept optional dates while one-off meetups still require dates',async()=>{
 const {meetupInput}=await ready;assert.deepEqual(meetupInput({...input,kind:'club',dates:[]}),{...input,kind:'club',dates:[]});
 for(const kind of ['other',null,['club'],{}])assert.throws(()=>meetupInput({...input,kind}));
 assert.throws(()=>meetupInput({...input,kind:'one_off',dates:[]}));
});
test('club filters and owner member actions carry validated targets and versions',async()=>{
 const {groupNodeRequest}=await ready;const calls=[];const opts={rpc:async(name,args)=>{calls.push(args);return {};},limit:async()=>true,tenant:'ax',cookieName:'ax_lunch_session',origin:'https://test'};
 const headers={origin:'https://test','content-type':'application/json',cookie:'ax_lunch_session='+'a'.repeat(64)};
 await groupNodeRequest(new Request('https://test/api/group-node?view=clubs',{headers}),opts);assert.equal(calls.at(-1).p_payload.view,'clubs');
 await groupNodeRequest(new Request('https://test/api/group-node?participantsFor='+id,{headers}),opts);assert.equal(calls.at(-1).p_action,'participant_roster');
 const req=body=>new Request('https://test/api/group-node',{method:'POST',headers,body:JSON.stringify(body)});
 await assert.rejects(groupNodeRequest(req({action:'convert_to_club',id}),opts),e=>e.status===400);
 await assert.rejects(groupNodeRequest(req({action:'add_participant',id,version:0,tenant:'wrong',userId:id}),opts),e=>e.status===400);
 await groupNodeRequest(req({action:'add_participant',id,version:2,tenant:'tmt',userId:id}),opts);assert.deepEqual(calls.at(-1).p_payload,{id,version:2,tenant:'tmt',userId:id});
});

test('comment edits validate both the new body and the expected previous content',async()=>{
 const {groupNodeRequest}=await ready;const calls=[];const options={rpc:async(name,args)=>{calls.push(args);return {};},limit:async()=>true,tenant:'ax',cookieName:'ax_lunch_session',origin:'https://test'};
 const req=body=>new Request('https://test/api/group-node',{method:'POST',headers:{origin:'https://test','content-type':'application/json',cookie:'ax_lunch_session='+'a'.repeat(64)},body:JSON.stringify(body)});
 await assert.rejects(groupNodeRequest(req({action:'edit_comment',id,commentId:id,body:'new'}),options),e=>e.status===400);
 await groupNodeRequest(req({action:'edit_comment',id,commentId:id,body:'new',expectedBody:'old'}),options);assert.equal(calls.at(-1).p_payload.expectedBody,'old');assert.equal(calls.at(-1).p_payload.body,'new');
});

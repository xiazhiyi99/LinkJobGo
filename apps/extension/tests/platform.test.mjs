import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildConfiguration, buildExtension } from '../scripts/build.mjs';
const bundled = await build({ stdin: { contents: "export * from './src/platform/auth.ts'; export * from './src/platform/api-client.ts'; export * from './src/shell/background.ts'; export * from './src/shell/debug-access.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node', define: { __PLATFORM_API_ORIGIN__: '"http://127.0.0.1:3001"', __PLATFORM_API_PATH_PREFIX__: '""', __PLATFORM_LOGIN_URL__: '"http://127.0.0.1:3000/login"', __PLATFORM_DEVELOPMENT__: 'true' } });
const { createAuthService, createApiClient, createBackground, PlatformError, publicPopupState, adminOnly } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const user = { id:'synthetic-user', email:'synthetic@example.test', role:'user', emailVerified:true, capabilities:{extensionDebug:false} };
const metadata = () => ({protocolVersion:'autofill.next.v2',requestId:crypto.randomUUID(),runId:crypto.randomUUID(),deadlineAt:Date.now()+2000});
test('production builds cannot enable local timing traces', async () => {
  await assert.rejects(buildExtension({ config: { development: false }, traceTiming: true }), /Timing traces require a development build/);
});
async function upstream(run) {
  const received=[];
  let respond=(req,input)=>({status:200,body:req.url.endsWith('/auth/me')?{user}:{ok:true,requestId:input.requestId,data:{}}});
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const input=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
    received.push({path:req.url,method:req.method,headers:req.headers,input});
    const result=await respond(req,input,res);
    if(result){res.writeHead(result.status,{'content-type':'application/json'});res.end(typeof result.body==='string'?result.body:JSON.stringify(result.body));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{await run({origin,received,respond:fn=>{respond=fn;}});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('build-time HTTPS origin, prefix and website login cannot be overridden by a page',()=>{
  const config=buildConfiguration({EXTENSION_MODE:'production',EXTENSION_API_ORIGIN:'https://platform.example.test',EXTENSION_API_PATH_PREFIX:'/api/'});
  assert.equal(config.apiPathPrefix,'/api');assert.equal(config.loginUrl,'https://platform.example.test/login');
  for(const origin of ['http://platform.example.test','https://user:pass@platform.example.test','https://platform.example.test/api','https://platform.example.test/?token=x'])assert.throws(()=>buildConfiguration({EXTENSION_MODE:'production',EXTENSION_API_ORIGIN:origin}));
  for(const prefix of ['api','//evil.test','/api//','/api/../private','/api/%2e%2e','/api?x=1','/api#x']){
    assert.throws(()=>buildConfiguration({EXTENSION_API_PATH_PREFIX:prefix}));assert.throws(()=>createApiClient({apiOrigin:'https://platform.example.test',apiPathPrefix:prefix}));
  }
  assert.throws(()=>buildConfiguration({EXTENSION_MODE:'production',EXTENSION_API_ORIGIN:'https://platform.example.test',EXTENSION_LOGIN_URL:'https://evil.test/login'}));
});
test('cookie transport includes credentials, has no bearer, and binds all three routes to the account',async()=>{
  await upstream(async({origin,received})=>{
    const options=[];
    const api=createApiClient({apiOrigin:origin,apiPathPrefix:'/api',fetcher:(url,init)=>{options.push(init);return fetch(url,init);}});
    const auth=createAuthService({apiOrigin:origin,api,apiPathPrefix:'/api'});
    const status=await auth.status();assert.equal(status.authenticated,true);assert.equal(status.role,'user');assert.equal(status.backendUrl,undefined);assert.equal(status.email,undefined);
    for(const op of ['readiness','analyze','plan'])await auth.fill(op,metadata(),{deadlineAt:Date.now()+2000});
    assert.deepEqual(received.map(r=>r.path),['/api/auth/me','/api/autofill/v2/readiness','/api/autofill/v2/analyze','/api/autofill/v2/plan']);
    assert.equal(received[0].method,'GET');assert.ok(options.every(o=>o.credentials==='include'&&o.redirect==='error'));
    assert.ok(received.every(r=>!r.headers.authorization));assert.ok(received.slice(1).every(r=>r.headers['x-autofill-account-id']===user.id));
  });
});
test('server role changes, expiry and failures immediately remove admin capability',async()=>{
  await upstream(async({origin,respond})=>{
    const auth=createAuthService({apiOrigin:origin,api:createApiClient({apiOrigin:origin})});
    respond(()=>({status:200,body:{user:{...user,role:'admin',capabilities:{extensionDebug:true}}}}));
    assert.equal((await auth.status()).capabilities.extensionDebug,true);
    for(const role of ['user','operator','unknown']){respond(()=>({status:200,body:{user:{...user,role,capabilities:{extensionDebug:true}}}}));assert.equal((await auth.status()).capabilities.extensionDebug,false);}
    respond(()=>({status:401,body:{}}));assert.equal((await auth.status()).state,'signed-out');
    await assert.rejects(auth.fill('plan',metadata(),{deadlineAt:Date.now()+2000}),e=>e.code==='authentication-required');
    respond(()=>({status:503,body:{}}));await assert.rejects(auth.status(),e=>e.code==='backend-unavailable');
  });
});
test('first fill after website sign-in is not aborted by discovering the account',async()=>{
  await upstream(async({origin,respond})=>{
    let signedIn=false,abortCount=0;
    respond((req,input)=>req.url.endsWith('/auth/me')
      ? {status:signedIn?200:401,body:signedIn?{user}:{}}
      : {status:200,body:{ok:true,requestId:input.requestId,data:{}}});
    const auth=createAuthService({apiOrigin:origin,api:createApiClient({apiOrigin:origin}),onAccountChange:()=>{abortCount++;}});
    await auth.status();signedIn=true;
    await auth.fill('readiness',metadata(),{deadlineAt:Date.now()+2000});
    assert.equal(abortCount,0);
    signedIn=false;await auth.status();assert.equal(abortCount,1);
  });
});
test('website account switch rejects old in-flight results',async()=>{
  let release,started;
  const arrived=new Promise(r=>{started=r;});
  await upstream(async({origin,respond})=>{
    let current=user;
    respond(async(req,input)=>{
      if(req.url.endsWith('/auth/me'))return{status:200,body:{user:current}};
      started();await new Promise(r=>{release=r;});return{status:200,body:{ok:true,requestId:input.requestId,data:{}}};
    });
    const auth=createAuthService({apiOrigin:origin,api:createApiClient({apiOrigin:origin})});await auth.status();
    const pending=auth.fill('plan',metadata(),{deadlineAt:Date.now()+2000});
    const rejected=assert.rejects(pending,e=>e.code==='authentication-required');
    await arrived;current={...user,id:'other-user'};await auth.status();release();await rejected;
  });
});
test('background opens only configured login URL; content cannot request account management',async()=>{
  await upstream(async({origin,received})=>{
    const opened=[];
    const handler=createBackground({runtime:{id:'extension'},storage:{local:{async setAccessLevel(){}}},tabs:{async create(v){opened.push(v);}}},{apiOrigin:origin,loginUrl:origin+'/login'});
    const popup={id:'extension',url:'chrome-extension://extension/popup.html'};
    const content={id:'extension',url:'https://jobs.example.test/',tab:{id:1},frameId:0,documentId:'doc'};
    assert.equal((await handler({type:'autofill-open-login',url:'https://evil.test'},content)).ok,false);
    assert.equal((await handler({type:'autofill-open-login',url:'https://evil.test'},popup)).ok,true);
    assert.deepEqual(opened,[{url:origin+'/login'}]);
    for(const type of ['autofill-auth-login','autofill-auth-logout'])assert.equal((await handler({type},popup)).ok,false);
    assert.equal((await handler({type:'autofill-auth-status'},content)).ok,false);
    assert.deepEqual(await handler({type:'autofill-debug-permission'},content),{allowed:false});
    assert.equal(received.length,1);
  });
});
test('ordinary state excludes raw report identifiers, timings, parser versions and actions',()=>{
  const state={phase:'partial',runId:'secret-run',starting:false,readiness:{status:'ready'},commandDocumentId:'command-document',timing:{diagnostics:{}},commandTiming:{startedAt:1},report:{status:'partial',runId:'secret-run',documentId:'secret-doc',profileVersion:'private-version',actions:[{kind:'add-record'}],warnings:['site-parser:demo@1','请先打开「教育」的编辑界面，再开始填写。'],items:[{sectionId:'section-id',templateFieldId:'field-id',recordId:'database-id',sectionLabel:'教育',fieldLabel:'学校',status:'filled',verification:'readback'}]}};
  const result=publicPopupState(state);assert.equal(result.timing,undefined);assert.equal(result.commandTiming,undefined);assert.equal(result.commandDocumentId,'command-document');
  for(const secret of ['secret-run','secret-doc','private-version','database-id','field-id','site-parser','add-record'])assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.report.items[0].fieldLabel,'学校');assert.equal(state.report.items[0].recordId,'database-id');
});
test('debug gate checks fresh permission before work and before releasing results',async()=>{
  let calls=0;
  await assert.rejects(adminOnly(async()=>({allowed:false}),async()=>{calls++;}),/admin-required/);assert.equal(calls,0);
  let checks=0;
  await assert.rejects(adminOnly(async()=>({allowed:++checks===1}),async()=>{calls++;return 'raw-snapshot';}),/admin-required/);assert.equal(calls,1);
  assert.equal(await adminOnly(async()=>({allowed:true}),async()=>'raw-snapshot'),'raw-snapshot');
});
test('popup has no password/account form; debug tools start hidden',async()=>{
  const html=await readFile(new URL('../src/shell/popup.html',import.meta.url),'utf8');
  assert.ok(!/connection-settings|account-password|account-email|领客账号/.test(html));
  for(const id of ['rule-collection','run-diagnostics','admin-tools'])assert.ok(html.includes(`id="${id}" hidden`));
  assert.ok(html.includes('前往网页登录'));
});
test('cookie HTTP work remains cancellable, bounded and request-correlated',async()=>{
  await upstream(async({origin,respond})=>{
    const api=createApiClient({apiOrigin:origin});const input=metadata();
    respond(()=>({status:200,body:{ok:true,requestId:'wrong',data:{}}}));await assert.rejects(api.fill('plan',input,user.id,{deadlineAt:input.deadlineAt}),e=>e.code==='backend-invalid-response');
    respond(()=>({status:200,body:'x'.repeat(1024*1024+1)}));await assert.rejects(api.fill('plan',input,user.id,{deadlineAt:input.deadlineAt}),e=>e.code==='backend-response-too-large');
    respond(()=>undefined);const abort=new AbortController();const pending=api.fill('plan',input,user.id,{deadlineAt:Date.now()+2000,signal:abort.signal});abort.abort();await assert.rejects(pending,e=>e instanceof PlatformError&&e.code==='cancelled');
  });
});

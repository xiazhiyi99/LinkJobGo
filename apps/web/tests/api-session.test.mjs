import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../lib/api-client.ts';

test('actual website session expiry and logout clear UI state, mailbox credential failures do not',async()=>{
  const previousFetch=globalThis.fetch,previousWindow=globalThis.window;
  const events=[];globalThis.window={dispatchEvent:event=>events.push(event.type)};
  let status=401,payload={error:'未登录'};
  globalThis.fetch=async()=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
  try{
    await assert.rejects(apiRequest('/profiles/me'));assert.equal(events.length,1);
    payload={error:'邮箱地址或授权码错误，请核对后重试。',code:'IMAP_AUTH_FAILED'};
    await assert.rejects(apiRequest('/mail-accounts/imap'));assert.equal(events.length,1);
    status=400;await assert.rejects(apiRequest('/mail-accounts/imap'),/授权码错误/);assert.equal(events.length,1);
    status=200;payload={ok:true};await apiRequest('/auth/logout',{method:'POST'});assert.equal(events.length,2);
  }finally{globalThis.fetch=previousFetch;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});

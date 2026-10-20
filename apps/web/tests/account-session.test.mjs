import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSession } from '../features/auth/account-session.ts';

const account = { id: 'synthetic-a', email: 'account@example.test', role: 'user' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('overlapping page and layout checks share one request; recent navigation reuses it', async () => {
  let requests = 0, clock = 1000; const pending = deferred();
  const session = createAccountSession({ load: () => { requests++; return pending.promise; }, now: () => clock });
  const first = session.refresh(), second = session.refresh();
  assert.equal(requests, 1); assert.equal(first, second);
  pending.resolve(account); await first;
  for (let route = 0; route < 5; route++) { clock += 1000; await session.refresh(); }
  assert.equal(requests, 1); assert.equal(session.getState().account.id, account.id);
  clock += 31_000; await session.refresh(); assert.equal(requests, 2);
});
test('background checks retain the rendered account while waiting and after a transport failure', async () => {
  const pending = deferred(); const session = createAccountSession({ load: () => pending.promise });
  session.accept(account); const work = session.refresh(true);
  assert.equal(session.getState().status, 'ready'); assert.equal(session.getState().account, account);
  pending.reject(new Error('暂时无法连接服务')); await work;
  assert.equal(session.getState().status, 'error'); assert.equal(session.getState().account, account);
});
test('expiry removes the account and its scoped data while unverified sessions retain the redirect reason', async () => {
  const changes=[];
  let failure={ status: 401, message: '未登录' };
  const session=createAccountSession({ load: async()=>{throw failure;}, onAccountChange: value=>changes.push(value?.id??null) });
  session.accept(account); await session.refresh(true);
  assert.equal(session.getState().account,null); assert.equal(session.getState().status,'ready');
  assert.deepEqual(changes,[account.id,null]);
  failure={ status:403,payload:{code:'EMAIL_NOT_VERIFIED'},message:'请先验证邮箱' };
  await session.refresh(true); assert.equal(session.getState().error.code,'EMAIL_NOT_VERIFIED');
});
test('a login completed during an older check cannot be overwritten by its late anonymous result',async()=>{
  const pending=deferred(); const session=createAccountSession({load:()=>pending.promise});
  const check=session.refresh(); session.accept(account);
  pending.reject({status:401,message:'未登录'}); await check;
  assert.equal(session.getState().account.id,account.id);
});
test('switching identity clears its scoped data but refreshing only permissions does not clear profile',async()=>{
  const changes=[];let next=account;
  const session=createAccountSession({load:async()=>next,onAccountChange: value=>changes.push(value?.id??null)});
  await session.refresh(); next={...account,role:'admin'}; await session.refresh(true);
  assert.deepEqual(changes,[account.id]); assert.equal(session.getState().account.role,'admin');
  next={...account,id:'synthetic-b'}; await session.refresh(true);
  assert.deepEqual(changes,[account.id,'synthetic-b']);
});

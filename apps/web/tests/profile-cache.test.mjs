import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileCache } from '../features/profile/profile-cache.ts';

const profile={profile:{name:'合成用户',extra:{note:'保留字段'}},skills:[{id:'stable-skill'}],educations:[{id:'stable-education'}]};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('sidebar and profile pages coalesce reads and navigation reuses the current account data',async()=>{
  const pending=deferred();let reads=0;
  const cache=createProfileCache({load:()=>{reads++;return pending.promise;}});cache.setAccount('a');
  const sidebar=cache.read(),page=cache.read();assert.equal(reads,1);
  pending.resolve(profile);assert.equal(await sidebar,await page);assert.equal(await cache.read(),profile);assert.equal(reads,1);
});
test('fresh saves bypass cached data and expired reads fetch again',async()=>{
  let clock=0,reads=0;
  const cache=createProfileCache({load:async()=>{reads++;return profile;},now:()=>clock});cache.setAccount('a');
  await cache.read();await cache.read(true);assert.equal(reads,2);
  clock=31_000;await cache.read();assert.equal(reads,3);
});
test('identity changes propagate to subscribers while skills, records and IDs are untouched',async()=>{
  const cache=createProfileCache({load:async()=>profile});cache.setAccount('a');await cache.read();
  let notified=0;cache.subscribe(()=>notified++);
  cache.update(current=>({...current,profile:{...current.profile,name:'更新姓名'}}),cache.generation());
  assert.equal(cache.getSnapshot().profile.name,'更新姓名');assert.equal(notified,1);
  assert.equal(cache.getSnapshot().skills,profile.skills);assert.equal(cache.getSnapshot().educations,profile.educations);
  assert.equal(profile.profile.name,'合成用户');
});
test('a late pre-save GET cannot overwrite an already saved profile',async()=>{
  const pending=deferred();let delayed=false;
  const cache=createProfileCache({load:()=>delayed?pending.promise:Promise.resolve(profile)});cache.setAccount('a');await cache.read();
  delayed=true;const stale=cache.read(true);const rejected=assert.rejects(stale,/版本已变化/);
  cache.update(current=>({...current,profile:{name:'已保存的新姓名'}}),cache.generation());
  pending.resolve(profile);await rejected;assert.equal(cache.getSnapshot().profile.name,'已保存的新姓名');
});
test('logout and account switching erase old data and reject late responses from the previous account',async()=>{
  const pending=deferred();const cache=createProfileCache({load:()=>pending.promise});cache.setAccount('a');
  const old=cache.read();const rejected=assert.rejects(old,/账号或版本已变化/);const before=cache.generation();
  cache.setAccount('b');assert.equal(cache.getSnapshot(),null);
  cache.update(()=>profile,before);assert.equal(cache.getSnapshot(),null);
  pending.resolve(profile);await rejected;assert.equal(cache.getSnapshot(),null);
  cache.setAccount(null);await assert.rejects(cache.read(),/先登录/);
});

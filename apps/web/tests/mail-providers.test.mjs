import test from 'node:test';
import assert from 'node:assert/strict';
import { mailProviderLabel, providerName } from '../features/workspace/applications/mail-providers.ts';
test('NetEase providers stay distinct even when the API supplies identical names',()=>{
  assert.equal(mailProviderLabel({id:'126',name:'网易邮箱'}),'网易 126');
  assert.equal(mailProviderLabel({id:'163',name:'网易邮箱'}),'网易 163');
  assert.notEqual(providerName('126'),providerName('163'));
  assert.equal(mailProviderLabel({id:'custom',name:'名称',label:'自定义邮箱'}),'自定义邮箱');
});

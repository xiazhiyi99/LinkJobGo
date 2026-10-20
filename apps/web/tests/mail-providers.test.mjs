import test from 'node:test';
import assert from 'node:assert/strict';
import { mailCredential, mailProviderLabel, providerName } from '../features/workspace/applications/mail-providers.ts';
test('NetEase providers stay distinct even when the API supplies identical names',()=>{
  assert.equal(mailProviderLabel({id:'126',name:'网易邮箱'}),'网易 126');
  assert.equal(mailProviderLabel({id:'163',name:'网易邮箱'}),'网易 163');
  assert.notEqual(providerName('126'),providerName('163'));
  assert.equal(mailProviderLabel({id:'custom',name:'名称',label:'自定义邮箱'}),'自定义邮箱');
});

test('QQ and NetEase mailboxes ask only for an authorization code',()=>{
  for (const id of ['qq', '126', '163']) {
    const credential = mailCredential({id});
    assert.equal(credential.label, '授权码');
    assert.match(credential.placeholder, /授权码/);
    assert.doesNotMatch(credential.placeholder, /密码/);
  }
});

test('iCloud asks only for its app-specific password',()=>{
  const credential = mailCredential({id:'icloud'});
  assert.equal(credential.label, '应用专用密码');
  assert.match(credential.placeholder, /Apple.*应用专用密码/);
  assert.doesNotMatch(credential.placeholder, /授权码/);
});

test('other mailboxes follow their credential mode without combined labels',()=>{
  assert.equal(mailCredential({id:'custom',authModes:['authorization_code']}).label, '授权码');
  assert.equal(mailCredential({id:'custom',authModes:['app_password']}).label, '应用专用密码');
  assert.equal(mailCredential({id:'imap',authModes:['password_or_code']}).label, '密码');
});

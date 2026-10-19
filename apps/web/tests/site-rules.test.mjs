import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAccount, filterSiteRules, routeLabel } from '../features/admin/site-rules.ts';
const sites = [
  {id:'meituan',name:'美团招聘',version:'1.4.2',origins:['https://zhaopin.meituan.com'],registered:true,mode:'enabled',routes:[{kind:'exact',path:'/web/delivery-confirm'}]},
  {id:'moka',name:'Moka',version:'1.1.0',origins:['https://app.mokahr.com'],registered:false,mode:'off',routes:[{kind:'exact',path:'/campus_apply/zuoyebang/144908',hashRoute:'/job/example/apply',tenant:'zuoyebang'}]},
];
test('admin visibility requires an explicit admin role',()=>{
  assert.equal(isAdminAccount({role:'admin'}),true);
  for(const account of [null,undefined,{}, {role:'user'},{role:'operator'},{role:'ADMIN'}])assert.equal(isAdminAccount(account),false);
});
test('catalogue search finds names, domains, paths and hash routes without changing the source',()=>{
  for(const query of ['美团','MEITUAN.COM',' /web/delivery ','1.4.2'])assert.deepEqual(filterSiteRules(sites,query).map(site=>site.id),['meituan']);
  for(const query of ['mokahr','zuoyebang','example/apply'])assert.deepEqual(filterSiteRules(sites,query).map(site=>site.id),['moka']);
  assert.deepEqual(filterSiteRules(sites,'no-match'),[]);
  assert.equal(sites.length,2);
});
test('runtime registration is distinguished from code presence and route kinds remain explicit',()=>{
  assert.deepEqual(filterSiteRules(sites,'','registered').map(site=>site.id),['meituan']);
  assert.deepEqual(filterSiteRules(sites,'','off').map(site=>site.id),['moka']);
  assert.equal(routeLabel({kind:'regex',path:'^/resume/\\d+$',flags:'i'}),'/^/resume/\\d+$/i');
  assert.equal(routeLabel(sites[0].routes[0]),'/web/delivery-confirm');
});

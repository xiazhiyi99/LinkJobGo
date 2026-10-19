import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { createAutofillModule } = require('../src/modules/autofill');
const { createConfiguredSiteRegistry } = require('../src/modules/autofill/dist/engine.cjs');
const { ServiceError } = require('../src/modules/autofill/errors');

const snapshot = (origin, path, hashRoute) => ({ protocolVersion: 'autofill.next.v2', documentId: 'test', pageRevision: 1, page: { origin, path, ...(hashRoute ? { hashRoute } : {}), title: 'Synthetic' }, sections: [{ sectionId:'basic',label:'基本信息',mode:'inline',repeatable:false,records:[],actions:[] }] });
test('catalogue describes the same registered parsers, routes and runtime modes used for dispatch', () => {
  for (const mokaMode of ['off', 'candidate', 'enabled']) {
    const registry = createConfiguredSiteRegistry({ mokaMode }), sites = registry.list();
    assert.equal(sites.length, 5);
    assert.equal(sites.filter(site => site.registered).length, mokaMode === 'off' ? 4 : 5);
    for (const site of sites) {
      assert.ok(site.name && site.version && site.routes.length);
      for (const origin of site.origins) for (const route of site.routes) {
        const path = route.kind === 'regex' ? site.id === 'bytedance' ? '/campus/resume/123/apply' : '/personal/resume' : route.path;
        if (route.kind === 'regex') assert.ok(new RegExp(route.path, route.flags).test(path));
        const classified = registry.classify(snapshot(origin, path, route.hashRoute));
        assert.equal(classified.kind, site.registered ? 'known' : 'unknown');
        if (classified.kind === 'known') { assert.equal(classified.parser.id, site.id); assert.equal(classified.parser.version, site.version); }
      }
    }
    const moka = sites.find(site => site.id === 'moka');
    assert.equal(moka.mode, mokaMode); assert.ok(moka.routes.every(route => route.hashRoute && route.tenant));
    assert.equal(registry.classify(snapshot('https://app.mokahr.com','/campus_apply/unknown/123','/job/unknown/apply')).kind,'unknown');
    const other = registry.list(); other[0].origins.length = 0; other[0].routes[0].path = '/mutated';
    assert.ok(registry.list()[0].origins.length); assert.notEqual(registry.list()[0].routes[0].path, '/mutated');
  }
});

async function harness(run) {
  let role = 'admin', calls = 0;
  const module = createAutofillModule({
    profileService: { async getAutofillContext() { calls++; throw new Error('Profile must not be read'); } },
    aiGateway: { async execute() { calls++; throw new Error('AI must not be called'); } },
    authenticate: async req => { if (!req.headers.cookie) throw new ServiceError('authentication-required','Please sign in',401); return { id:'test-user', email:'synthetic@example.test', role, capabilities:{extensionDebug:true} }; },
    config: { mokaMode:'off', allowedOrigins:['https://platform.example.test'] },
  });
  const server = createServer((req,res) => req.url.split('?')[0] === '/admin/autofill/sites' ? module.handleAdminSites(req,res) : (res.writeHead(404),res.end()));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/admin/autofill/sites`;
  const get = options => fetch(endpoint, { headers:{ cookie:'synthetic-session', ...options?.headers }, ...options, ...(options?.headers ? { headers:{cookie:'synthetic-session',...options.headers} } : {}) });
  try { await run({ get, setRole:value=>{role=value;}, calls:()=>calls }); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
test('admin endpoint is read-only, uncached, source-derived and never reads profiles or calls AI', async () => {
  await harness(async ({ get, calls }) => {
    const response = await get(), body = await response.json();
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(body.source,'code'); assert.ok(Number.isFinite(Date.parse(body.generatedAt)));
    assert.equal(body.sites.length,5); assert.equal(body.sites.find(site=>site.id==='moka').registered,false);
    assert.equal(body.sites.find(site=>site.id==='bytedance').routes[0].kind,'regex');
    assert.ok(!JSON.stringify(body).includes('synthetic@example.test'));
    const write = await get({method:'POST'}); assert.equal(write.status,405); assert.equal(write.headers.get('allow'),'GET');
    assert.equal(calls(),0);
  });
});
test('anonymous, ordinary, unknown and demoted accounts cannot read the admin catalogue', async () => {
  await harness(async ({ get, setRole }) => {
    const anonymous = await get({headers:{cookie:''}}); assert.equal(anonymous.status,401);
    for (const role of ['user','operator','ADMIN',undefined]) { setRole(role); const response=await get(); assert.equal(response.status,403); assert.equal((await response.json()).sites,undefined); }
    setRole('admin'); assert.equal((await get()).status,200);
    setRole('user'); assert.equal((await get()).status,403, 'permission is checked on each refresh');
  });
});
test('admin CORS rejects untrusted origins and allows only GET preflight',async()=>{
  await harness(async({get})=>{
    assert.equal((await get({headers:{origin:'https://evil.example'}})).status,403);
    const allowed = await get({headers:{origin:'https://platform.example.test'}});
    assert.equal(allowed.status,200); assert.equal(allowed.headers.get('access-control-allow-origin'),'https://platform.example.test');
    const preflight = await get({method:'OPTIONS',headers:{origin:'https://platform.example.test'}});
    assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-methods'),'GET');
  });
});

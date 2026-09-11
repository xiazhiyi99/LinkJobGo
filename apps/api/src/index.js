const http = require('node:http');
const crypto = require('node:crypto');
const port = Number(process.env.API_PORT || 3001);
const users = new Map();
const sessions = new Map();
const tokens = new Map();
const json = (res,status,data,headers={}) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','access-control-allow-origin':process.env.WEB_ORIGIN||'http://localhost:3000','access-control-allow-credentials':'true',...headers}); res.end(JSON.stringify(data)); };
const body = req => new Promise((resolve,reject)=>{let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}})});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (password,salt=crypto.randomBytes(16).toString('hex')) => ({salt,hash:crypto.scryptSync(password,salt,64).toString('hex')});
const verify = (password,record) => crypto.timingSafeEqual(Buffer.from(record.hash,'hex'),Buffer.from(passwordHash(password,record.salt).hash,'hex'));
const sessionUser = req => { const value=(req.headers.cookie||'').match(/lingke_session=([^;]+)/)?.[1]; const id=value&&sessions.get(value); return id&&users.get(id) ? {id,email:users.get(id).email,role:users.get(id).role,emailVerified:!!users.get(id).emailVerifiedAt} : null; };
const readToken = req => { const raw=(req.headers.authorization||'').replace('Bearer ',''); const id=raw&&tokens.get(raw); return id&&users.get(id)?{id,email:users.get(id).email,role:users.get(id).role,emailVerified:!!users.get(id).emailVerifiedAt}:null; };
const userResponse = u => ({id:u.id,email:u.email,role:u.role,emailVerified:!!u.emailVerifiedAt});
const server=http.createServer(async(req,res)=>{ if(req.method==='OPTIONS') return json(res,204,{}); try { const url=new URL(req.url,`http://${req.headers.host}`); const data=await body(req);
 if(req.method==='POST'&&url.pathname==='/auth/register'){const email=String(data.email||'').trim().toLowerCase(); if(!email||!String(data.password||'').length) return json(res,400,{error:'邮箱和密码不能为空'}); if(users.has(email)) return json(res,409,{error:'邮箱或密码不正确'}); const id=crypto.randomUUID(); users.set(email,{id,email,role:'user',...passwordHash(String(data.password)),emailVerifiedAt:process.env.NODE_ENV==='production'?null:new Date().toISOString()}); return json(res,201,{user:userResponse(users.get(email))});}
 if(req.method==='POST'&&url.pathname==='/auth/login'){const email=String(data.email||'').toLowerCase(),u=users.get(email); if(!u||!verify(String(data.password||''),u)) return json(res,401,{error:'邮箱或密码不正确'}); const sid=crypto.randomUUID(); sessions.set(sid,u.id); return json(res,200,{user:userResponse(u)},{'set-cookie':`lingke_session=${sid}; HttpOnly; SameSite=Lax; Path=/`});}
 if(req.method==='POST'&&url.pathname==='/auth/logout'){const sid=(req.headers.cookie||'').match(/lingke_session=([^;]+)/)?.[1]; if(sid)sessions.delete(sid); return json(res,200,{ok:true},{'set-cookie':'lingke_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'});}
 if(req.method==='GET'&&url.pathname==='/auth/me'){const u=sessionUser(req)||readToken(req); return u?json(res,200,{user:u}):json(res,401,{error:'未登录'});}
 if(req.method==='POST'&&url.pathname==='/auth/forgot-password') return json(res,200,{message:'如果邮箱存在，重置链接将发送到邮箱。'});
 if(req.method==='POST'&&url.pathname==='/auth/extension/login'){const email=String(data.email||'').toLowerCase(),u=users.get(email); if(!u||!verify(String(data.password||''),u))return json(res,401,{error:'邮箱或密码不正确'});const access=crypto.randomBytes(32).toString('hex');tokens.set(access,u.id);return json(res,200,{accessToken:access,expiresIn:900,user:userResponse(u)});}
 if(url.pathname.startsWith('/workspace')&&!sessionUser(req)) return json(res,401,{error:'需要登录'});
 return json(res,404,{error:'Not found'});
 } catch(error){ return json(res,500,{error:'服务器错误'}); }});
server.listen(port,()=>console.log(`[api] auth server listening on http://localhost:${port}`));

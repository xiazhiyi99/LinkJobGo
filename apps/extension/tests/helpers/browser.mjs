import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { root } from '../../scripts/build.mjs';

class CDP {
  constructor(ws){this.ws=ws;this.serial=0;this.pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(event.data);const pending=this.pending.get(m.id);if(pending){this.pending.delete(m.id);clearTimeout(pending.timer);m.error?pending.reject(new Error(m.error.message)):pending.resolve(m.result);}});}
  static async connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});return new CDP(ws);}
  send(method,params={},timeoutMs=15000){if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new RangeError('CDP timeout must be between 1 and 120000 ms');const id=++this.serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser closed'));}this.pending.clear();this.ws.close();}
}
export const connectCDP = url => CDP.connect(url);
export async function withBrowserFixture(callback,{extensionPath,headless=true,chromeArgs=[]}={}){
 const server=createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/')pathname='/assets/fixtures/basic.html';const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const bytes=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'})[path.extname(file)]??'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}});
 let chrome,cdp,profile,browserSocket;
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  profile=await mkdtemp(path.join(tmpdir(),'platform-autofill-test-'));
  const executable=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';await access(executable);
  const args=[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-dev-shm-usage'];
  if(headless)args.push('--headless=new');if(extensionPath&&!chromeArgs.includes('--enable-unsafe-extension-debugging'))args.push(`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`);args.push(...chromeArgs,'about:blank');
  chrome=spawn(executable,args,{stdio:['ignore','ignore','pipe']});
  const wsUrl=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(`Chrome did not start: ${output.slice(-1500)}`)),15000);chrome.once('error',error=>{clearTimeout(timer);reject(error);});chrome.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chrome exited ${code}: ${output.slice(-1500)}`));});chrome.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
  browserSocket=await CDP.connect(wsUrl);
  const httpOrigin=String(wsUrl).replace('ws:','http:').split('/devtools')[0];const targets=await(await fetch(`${httpOrigin}/json/list`)).json();const target=targets.find(t=>t.type==='page');cdp=await CDP.connect(target.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  const page={
   async evaluate(fn,arg,{timeoutMs=15000}={}){const expression=typeof fn==='function'?`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`:fn;const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},timeoutMs);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;},
   async goto(url){await cdp.send('Page.navigate',{url:new URL(url,origin).href});await this.waitForFunction(()=>document.readyState==='complete');},
   async waitForFunction(fn,arg,timeout=5000){const deadline=Date.now()+timeout;let last;do{try{const result=await this.evaluate(fn,arg);if(result)return result;}catch(error){last=error;}await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);throw new Error(`Browser condition timed out${last?': '+last.message:''}`);},
   async click(selector){await this.evaluate(s=>{const el=document.querySelector(s);if(!el)throw new Error(`Missing ${s}`);el.click();},selector);},
   async fill(selector,value){await this.evaluate(({selector,value})=>{const el=document.querySelector(selector);if(!el)throw new Error(`Missing ${selector}`);Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},{selector,value});},
   cdp,
  };
  return await callback({page,origin,browserSocket,httpOrigin});
 }finally{
  cdp?.close();browserSocket?.close();if(chrome&&chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([once(chrome,'exit'),new Promise(r=>setTimeout(r,2000))]);if(chrome.exitCode===null)chrome.kill('SIGKILL');}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(profile)await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}

// Run against an unused test installation only. Resets its temporary records after checks.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { initialState } from '../lib/domain.mjs';
if(process.env.ALLOW_TEST_RESET!=='yes')throw new Error('Set ALLOW_TEST_RESET=yes for an unused test installation.');
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
let cookie='';
async function call(action,data,authenticated=true){const response=await fetch(`${base}/api/index?action=${action}`,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:base}),...(authenticated&&cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return{status:response.status,data:await response.json()};}
const command=data=>call('command',{key:randomUUID(),date:'2026-11-16',...data});
const status=await call('status');assert.equal(status.data.initialized,false,'Refuse to test an initialized installation.');
try{
  assert.equal((await call('state')).status,401);
  const pass=randomBytes(24).toString('base64url');
  const setup=await call('setup',{token:process.env.BOOTSTRAP_TOKEN,passwords:{Damian:pass,Fero:pass}});assert.equal(setup.status,200,JSON.stringify(setup.data));
  assert.equal(setup.data.actor,'Damian');
  assert.equal((await command({type:'opening',productId:'D5-001',qty:1})).status,200);
  const [a,b]=await Promise.all([command({type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'}),command({type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Fero'})]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  let state=(await call('state')).data;assert.equal(state.products[0].stock,0);assert.equal(state.accounts.Damian.received+state.accounts.Fero.received,3500);
  assert.equal((await call('catalog',undefined,false)).data.products[0].visible,false);
  const sale=state.entries.find(e=>e.type==='sale');assert.equal((await command({type:'reversal',entryId:sale.id,note:'QA storno'})).status,200);
  assert.equal((await call('catalog',undefined,false)).data.products[0].visible,true);
  const receipt={key:randomUUID(),date:'2026-11-16',type:'receipt',productId:'D5-001',qty:2,amountCents:2000,person:'Fero'};
  assert.equal((await call('command',receipt)).status,200);assert.equal((await call('command',receipt)).status,200);
  state=(await call('state')).data;assert.equal(state.products[0].stock,3);assert.equal(state.accounts.Fero.paid,2000);
  const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQz8AAAAASUVORK5CYII=';
  const upload=await call('upload',{base64:pixel});assert.equal(upload.status,200,JSON.stringify(upload.data));
  assert.equal((await command({type:'receipt',qty:2,amountCents:2500,person:'Damian',product:{name:'QA čiapka',description:'Testovacia fotografia, iba test.',category:'beanies',priceCents:3500,published:true,imageIds:[upload.data.id]}})).status,200);
  const catalog=(await call('catalog',undefined,false)).data;assert.equal(catalog.products.at(-1).name,'QA čiapka');assert.equal('unitCostCents' in catalog.products.at(-1),false);
  const image=await fetch(`${base}/api/index?action=image&id=${upload.data.id}`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal((await call('password',{currentPassword:pass,password:pass+'changed'})).status,200);
  await call('logout',{});cookie='';assert.equal((await call('state')).status,401);assert.equal((await call('login',{person:'Fero',password:pass})).status,200);
  console.log('PASS: activation, private access, concurrent last-item sale, public visibility, reversal, receipt retry, photo upload, new product, password, logout, partner login.');
}finally{
  await put('private/d5mfer-ledger-v1.json',JSON.stringify(initialState()),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'});
  console.log('Temporary QA records reset. Installation awaits the owners’ activation and real opening counts.');
}

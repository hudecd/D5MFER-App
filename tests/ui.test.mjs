import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { initialState, snapshot, applyCommand } from '../lib/domain.mjs';
const wait = async (predicate) => { for(let i=0;i<60;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('DOM state did not update'); };
test('mobile UI wires login, opening stock, actual-price sale, history and accounts to API',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://d5mfer-app.vercel.app',runScripts:'outside-only'}),w=dom.window;
  w.scrollTo=()=>{};w.crypto.randomUUID=randomUUID;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let signedIn=false;const data=initialState();
  w.fetch=async(path,options={})=>{const action=new URL(path,w.location.href).searchParams.get('action');let status=200,result;
    if(action==='status')result={initialized:true,mode:'test'};
    else if(action==='login'){signedIn=true;result=snapshot(data,'Damian');}
    else if(!signedIn){status=401;result={error:'Prihláste sa'};}
    else if(action==='command'){applyCommand(data,JSON.parse(options.body),'Damian');result=snapshot(data,'Damian');}
    else result=snapshot(data,'Damian');
    return {ok:status===200,status,json:async()=>structuredClone(result)};
  };
  w.eval(code);await wait(()=>w.document.querySelector('#login-form'));
  const submit=selector=>w.document.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  w.document.querySelector('#login-password').value='test-password-1234';submit('#login-form');await wait(()=>w.document.querySelector('[data-nav=stock]'));
  w.document.querySelector('[data-nav=stock]').click();assert.equal(w.document.querySelectorAll('.product-card').length,5);
  w.document.querySelector('[data-stock-action="D5-001"]').click();w.document.querySelector('#field-qty').value='1';submit('#opening-form');await wait(()=>!w.document.querySelector('#modal').open);
  w.document.querySelector('[data-stock-action="D5-001"]').click();w.document.querySelector('#field-amount').value='29.50';submit('#sale-form');await wait(()=>!w.document.querySelector('#modal').open);
  assert.equal(data.products[0].stock,0);assert.equal(snapshot(data,'Damian').accounts.Damian.received,2950);
  w.document.querySelector('[data-nav=history]').click();assert.match(w.document.querySelector('#page').textContent,/Predaj/);
  w.document.querySelector('[data-nav=accounts]').click();assert.match(w.document.querySelector('#page').textContent,/29,50/);
  w.document.querySelector('[data-nav=receipt]').click();assert.ok(w.document.querySelector('#photo-input'));w.document.querySelector('#receipt-existing').click();assert.ok(w.document.querySelector('#receipt-product'));
  dom.window.close();
});

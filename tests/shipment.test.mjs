import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allocateShipmentCosts } from '../public/shipment-costs.js';
import { initialState, applyCommand, summary } from '../lib/domain.mjs';
function ready(){const s=initialState();for(const id of ['D5-001','D5-002','D5-003'])applyCommand(s,{key:randomUUID(),type:'opening',productId:id,qty:0,date:'2026-11-16'},'Damian');return s;}
function shipment(){return {key:randomUUID(),type:'shipment',date:'2026-11-16',person:'Fero',shippingCents:800,feesCents:400,items:[
  {productId:'D5-001',qty:2,listedQty:1,goodsCents:2000},
  {productId:'D5-002',qty:1,listedQty:1,goodsCents:1000},
  {productId:'D5-003',qty:1,listedQty:1,goodsCents:3000}
]};}
test('entire parcel saves all kinds and charges shared costs once, weighted by received pieces',()=>{
  const s=ready(),c=shipment(),result=applyCommand(s,c,'Damian');
  assert.deepEqual(s.products.slice(0,3).map(p=>p.stock),[2,1,1]);assert.deepEqual(s.products.slice(0,3).map(p=>p.listedStock),[1,1,1]);
  assert.equal(summary(s).Fero.paid,7200);assert.equal(summary(s).Damian.paid,0);
  const entries=s.entries.filter(e=>e.shipmentId===c.key);assert.equal(entries.length,3);assert.deepEqual(entries.map(e=>e.costs.shippingCents),[400,200,200]);assert.deepEqual(entries.map(e=>e.costs.feesCents),[200,100,100]);
  assert.deepEqual(entries.map(e=>e.amountCents),[2600,1300,3300]);assert.equal(s.products[0].unitCostCents,1300);assert.equal(s.shipments[0].amountCents,7200);assert.equal(result.entryIds.length,3);
});
test('retry of entire shipment never duplicates stock, fees or ledger entries',()=>{const s=ready(),c=shipment();applyCommand(s,c,'Damian');const once=structuredClone(s);assert.deepEqual(applyCommand(s,c,'Fero'),{duplicate:true});assert.deepEqual(s,once);assert.throws(()=>applyCommand(s,{...c,shippingCents:900},'Damian'),/už bol použitý/);});
test('invalid last item rolls back the whole parcel',()=>{const s=ready(),c=shipment(),before=structuredClone(s);c.items[2].productId='missing-product';assert.throws(()=>applyCommand(s,c,'Damian'),/nenašiel/);assert.deepEqual(s,before);});
test('allocation preserves every cent for shipping and fees independently',()=>{
  for(let n=1;n<=25;n++)for(const amount of [0,1,2,7,100,1999,100000]){
    const rows=Array.from({length:n},(_,i)=>({qty:i+1,goodsCents:0})),parts=allocateShipmentCosts(rows,amount,amount+1);
    assert.equal(parts.reduce((n,c)=>n+c.shippingCents,0),amount);assert.equal(parts.reduce((n,c)=>n+c.feesCents,0),amount+1);assert.ok(parts.every(c=>Number.isInteger(c.amountCents)));
  }
  assert.deepEqual(allocateShipmentCosts([{qty:1,goodsCents:0},{qty:1,goodsCents:0},{qty:1,goodsCents:0}],1,2).map(c=>[c.shippingCents,c.feesCents]),[[1,1],[0,1],[0,0]]);
});
test('same existing product can appear twice in one parcel without losing either line',()=>{const s=ready(),c=shipment();c.items[1].productId='D5-001';applyCommand(s,c,'Damian');assert.equal(s.products[0].stock,3);assert.equal(summary(s).Fero.paid,7200);});
test('empty parcels, invalid quantities and negative fees are rejected before changes',()=>{for(const change of [{items:[]},{shippingCents:-1},{feesCents:1.5},{items:[{qty:0,goodsCents:100}]}]){const s=ready(),before=structuredClone(s);assert.throws(()=>applyCommand(s,{...shipment(),...change},'Damian'));assert.deepEqual(s,before);}});

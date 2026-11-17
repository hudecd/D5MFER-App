import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialState, applyCommand, summary } from '../lib/domain.mjs';

const run = (state, command) => applyCommand(state, { key: randomUUID(), date: '2026-11-17', ...command }, 'Damian');

test('first delivery accepts catalog items with unconfirmed stock and updates their prices', () => {
  const state = initialState();
  run(state, {type:'shipment', person:'Damian', shippingCents:300, feesCents:0, items:[
    {productId:'D5-001', qty:1, goodsCents:1000, salePriceCents:2500},
    {productId:'D5-002', qty:2, goodsCents:2000, salePriceCents:2700}
  ]});
  assert.deepEqual(state.products.slice(0,2).map(p=>[p.stock,p.price]), [[1,25],[2,27]]);
  assert.equal(summary(state).Damian.paid,3300);
  const shipmentId = state.shipments[0].id;
  run(state, {type:'extra_cost', shipmentId, person:'Fero', shippingCents:300, feesCents:3,note:'Doplatok'});
  const cost = state.entries.at(-1);
  assert.deepEqual(cost.allocations.map(a=>a.amountCents), [101,202]);
  assert.equal(summary(state).Fero.paid,303);
  assert.deepEqual(state.products.slice(0,2).map(p=>p.stock), [1,2]);
  run(state, {type:'reversal', entryId:cost.id, note:'Oprava'});
  assert.equal(summary(state).Fero.paid,0);
});

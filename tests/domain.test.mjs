import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialState, applyCommand, publicCatalog, snapshot, summary } from '../lib/domain.mjs';
const cmd=(s,c)=>applyCommand(s,{key:randomUUID(),date:'2026-11-16',...c},'Damian');
function ready(qty=2){const s=initialState();cmd(s,{type:'opening',productId:'D5-001',qty,unitCostCents:1000});return s;}

test('removing a card with opening stock removes it from the catalog and keeps an audit entry', () => {
  const s = ready(1), product = s.products[0];
  const command = { key: randomUUID(), date: '2026-11-16', type: 'product_remove', productId: product.id,
    expectedStock: 1, expectedName: product.name, expectedPublished: product.published };
  assert.equal(snapshot(s, 'Damian').products[0].canRemove, true);
  assert.throws(() => applyCommand(s, { ...command, expectedStock: 2 }, 'Damian'), /Položka sa zmenila/);
  applyCommand(s, command, 'Damian');
  assert.equal(s.products.some(p => p.id === product.id), false);
  assert.equal(publicCatalog(s).products.some(p => p.id === product.id), false);
  assert.equal(s.entries[0].type, 'opening');
  assert.equal(s.entries.at(-1).productName, product.name);
  assert.equal(s.entries.at(-1).qty, -1);
  assert.equal(summary(s).Damian.balance, 0);
  assert.deepEqual(applyCommand(s, command, 'Damian'), { duplicate: true });
});

test('active purchases or sales block deletion and reversed transactions remain in history', () => {
  for (const [type, amountCents] of [['receipt', 0], ['sale', 2500]]) {
    const s = ready(), product = s.products[0];
    const { entryId } = cmd(s, { type, productId: product.id, qty: 1, amountCents, person: 'Fero' });
    const remove = () => cmd(s, { type: 'product_remove', productId: product.id,
      expectedStock: product.stock, expectedName: product.name, expectedPublished: product.published });
    assert.equal(snapshot(s, 'Damian').products[0].canRemove, false);
    assert.throws(remove, /zaevidovaný príjem alebo predaj/);
    cmd(s, { type: 'reversal', entryId, note: 'Omyl' });
    assert.equal(snapshot(s, 'Damian').products[0].canRemove, true);
    remove();
    assert.ok(s.entries.some(entry => entry.id === entryId));
    assert.equal(summary(s).Fero.balance, 0);
  }
});

test('import does not invent stock counts or historical payments',()=>{const s=initialState();assert.equal(s.products.length,5);assert.ok(s.products.every(p=>p.stock===null));assert.equal(summary(s).Damian.balance,0);assert.equal(publicCatalog(s).products.filter(p=>p.visible).length,5);assert.throws(()=>cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'}),/počiatočný/);});
test('sale uses actual received amount and hides only the last item',()=>{const s=ready();cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3000,person:'Fero'});assert.equal(s.products[0].stock,1);assert.equal(summary(s).Fero.received,3000);assert.equal(publicCatalog(s).products[0].visible,true);cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'});assert.equal(publicCatalog(s).products[0].visible,false);assert.equal(publicCatalog(s).products[1].visible,true);});
test('same request can be retried without double counting',()=>{const s=ready();const c={key:randomUUID(),date:'2026-11-16',type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'};applyCommand(s,c,'Damian');applyCommand(s,c,'Damian');assert.equal(s.products[0].stock,1);assert.equal(summary(s).Damian.received,3500);assert.throws(()=>applyCommand(s,{...c,amountCents:3000},'Damian'),/už bol použitý/);});
test('cannot oversell, even with two sequential competing buyers',()=>{const s=ready(1);cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'});assert.throws(()=>cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Fero'}),/dostatok/);assert.equal(s.products[0].stock,0);});
test('receipt increases stock and charges correct payer, weighted cost',()=>{const s=ready(2);cmd(s,{type:'receipt',productId:'D5-001',qty:2,amountCents:4000,person:'Fero'});assert.equal(s.products[0].stock,4);assert.equal(s.products[0].unitCostCents,1500);assert.equal(summary(s).Fero.paid,4000);assert.equal(summary(s).Fero.balance,-4000);});
test('reversing sale restores stock and money, twice is rejected',()=>{const s=ready(1);cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Fero'});const id=s.entries.at(-1).id;cmd(s,{type:'reversal',entryId:id,note:'Omyl'});assert.equal(s.products[0].stock,1);assert.equal(summary(s).Fero.received,0);assert.equal(publicCatalog(s).products[0].visible,true);assert.throws(()=>cmd(s,{type:'reversal',entryId:id,note:'Znova'}),/už bol stornovaný/);});
test('receipt reversal restores previous cost and charge',()=>{const s=ready();cmd(s,{type:'receipt',productId:'D5-001',qty:2,amountCents:4000,person:'Fero'});cmd(s,{type:'reversal',entryId:s.entries.at(-1).id,note:'Nesprávny balík'});assert.equal(s.products[0].stock,2);assert.equal(s.products[0].unitCostCents,1000);assert.equal(summary(s).Fero.paid,0);});
test('receipt reversal refuses to erase later stock movements',()=>{const s=ready();cmd(s,{type:'receipt',productId:'D5-001',qty:2,amountCents:4000,person:'Fero'});const id=s.entries.at(-1).id;cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'});assert.throws(()=>cmd(s,{type:'reversal',entryId:id,note:'Omyl'}),/ďalšie pohyby/);});
test('transfers change both cash balances, not revenue or expenses',()=>{const s=ready();cmd(s,{type:'transfer',person:'Damian',to:'Fero',amountCents:2000});assert.equal(summary(s).Damian.balance,-2000);assert.equal(summary(s).Fero.balance,2000);assert.equal(summary(s).Fero.received,0);cmd(s,{type:'reversal',entryId:s.entries.at(-1).id,note:'Omyl'});assert.equal(summary(s).Fero.balance,0);});
test('inventory correction requires reason, does not create payments',()=>{const s=ready();assert.throws(()=>cmd(s,{type:'adjustment',productId:'D5-001',qty:5}),/dôvod/);cmd(s,{type:'adjustment',productId:'D5-001',qty:5,note:'Inventúra'});assert.equal(s.products[0].stock,5);assert.equal(summary(s).Damian.balance,0);});
test('public catalog never exposes costs, cash history, users, stock quantities',()=>{const s=ready();s.users={Damian:{hash:'private'}};const output=JSON.stringify(publicCatalog(s));for(const key of ['stock','unitCostCents','users','entries','commands','private'])assert.equal(output.includes(`"${key}"`),false);});
test('new product requires owned photo and allows draft then publishing',()=>{const s=ready();s.images.push({id:'photo-1'});const product={name:'Nová čiapka',category:'beanies',priceCents:3500,description:'Vlastná fotografia, replika.',imageIds:['photo-1'],published:false};cmd(s,{type:'receipt',qty:3,amountCents:4500,person:'Fero',product});const p=s.products.at(-1);assert.equal(p.stock,3);assert.equal(publicCatalog(s).products.at(-1).visible,false);cmd(s,{type:'product',productId:p.id,name:p.name,priceCents:4000,description:p.description,published:true});assert.equal(publicCatalog(s).products.at(-1).visible,true);assert.equal(p.price,40);});
test('rejects malformed money, dates, quantity and persons',()=>{for(const changes of [{amountCents:1.5},{amountCents:-2},{qty:0},{qty:1.5},{person:'Someone'},{date:'2026-99-99'}])assert.throws(()=>cmd(ready(),{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian',...changes}));});
test('parcel records all received pieces, only selected pieces go on offer, all fees charge the payer',()=>{
  const s=ready(0);cmd(s,{type:'receipt',productId:'D5-001',qty:10,listedQty:8,amountCents:1,costs:{goodsCents:10000,shippingCents:2000,feesCents:500},person:'Fero'});
  assert.equal(s.products[0].stock,10);assert.equal(s.products[0].listedStock,8);assert.equal(s.products[0].unitCostCents,1250);assert.equal(summary(s).Fero.paid,12500);
  assert.deepEqual(s.entries.at(-1).costs,{goodsCents:10000,shippingCents:2000,feesCents:500,amountCents:12500});
  cmd(s,{type:'sale',productId:'D5-001',qty:8,amountCents:28000,person:'Damian'});assert.equal(s.products[0].stock,2);assert.equal(publicCatalog(s).products[0].visible,false);
  assert.throws(()=>cmd(s,{type:'sale',productId:'D5-001',qty:1,amountCents:3500,person:'Damian'}),/dostatok/);
  const p=s.products[0];cmd(s,{type:'product',productId:p.id,name:p.name,description:p.description,priceCents:3500,published:true,listedQty:2});assert.equal(publicCatalog(s).products[0].visible,true);
});
test('receipt may place zero pieces on offer and its reversal restores offered count and fees',()=>{
  const s=ready(2);cmd(s,{type:'receipt',productId:'D5-001',qty:3,listedQty:0,costs:{goodsCents:3000,shippingCents:500,feesCents:100},person:'Fero'});
  assert.equal(s.products[0].stock,5);assert.equal(s.products[0].listedStock,2);cmd(s,{type:'reversal',entryId:s.entries.at(-1).id,note:'Omyl'});
  assert.equal(s.products[0].stock,2);assert.equal(s.products[0].listedStock,2);assert.equal(summary(s).Fero.paid,0);
});
test('received/listed counts and separate fees are validated on server',()=>{
  for(const changes of [{listedQty:11},{listedQty:-1},{costs:{goodsCents:100,shippingCents:-1,feesCents:0}},{costs:{goodsCents:100,shippingCents:0,feesCents:1.5}}])assert.throws(()=>cmd(ready(),{type:'receipt',productId:'D5-001',qty:10,listedQty:8,costs:{goodsCents:100,shippingCents:0,feesCents:0},person:'Damian',...changes}));
});
test('legacy stock without listing field keeps original availability',()=>{
  const s=ready(3);delete s.products[0].listedStock;cmd(s,{type:'receipt',productId:'D5-001',qty:4,listedQty:2,amountCents:4000,person:'Fero'});assert.equal(s.products[0].listedStock,5);assert.equal(s.products[0].stock,7);
  const output=JSON.stringify(publicCatalog(s));assert.equal(output.includes('listedStock'),false);assert.equal(output.includes('shippingCents'),false);
});

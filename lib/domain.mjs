import { createHash, randomUUID } from 'node:crypto';
import seed from './catalog-seed.json' with { type: 'json' };
import { allocateShipmentCosts } from '../public/shipment-costs.js';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const people = ['Damian', 'Fero'];
export const fail = (message, status = 400) => { throw new AppError(message, status); };
export function text(value, label, max = 500, required = true) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; fail(`${label}: zadajte text.`); }
  const result = value.trim();
  if ((required && !result) || result.length > max) fail(`${label}: skontrolujte dĺžku (max. ${max}).`);
  return result;
}
export function integer(value, label, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}: zadajte platné celé číslo.`);
  return value;
}
function person(value) { if (!people.includes(value)) fail('Vyberte Damiana alebo Fera.'); return value; }
function date(value) {
  const d = text(value, 'Dátum', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) fail('Neplatný dátum.');
  return d;
}
export function initialState() {
  return { version: 1, revision: 0, updatedAt: new Date().toISOString(), users: {}, commands: [], images: [], entries: [], products: seed.products.map(p => ({
    ...p, images: p.images.map(i => ({ ...i, src: new URL(i.src, 'https://d5mfer.vercel.app/').href })),
    stock: null, published: p.visible && p.availability === 'available', unitCostCents: null
  })) };
}
export const listedStock = product => product.listedStock ?? product.stock;
export function receiptCosts(command) {
  if (command.costs == null) return { goodsCents: integer(command.amountCents, 'Náklady spolu', 0), shippingCents: 0, feesCents: 0, amountCents: command.amountCents };
  const goodsCents = integer(command.costs.goodsCents, 'Cena tovaru', 0);
  const shippingCents = integer(command.costs.shippingCents, 'Poštovné', 0);
  const feesCents = integer(command.costs.feesCents, 'Ostatné poplatky', 0);
  return { goodsCents, shippingCents, feesCents, amountCents: integer(goodsCents + shippingCents + feesCents, 'Náklady spolu', 0) };
}
export function publicCatalog(s) {
  const origin = process.env.APP_ORIGIN || (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://d5mfer-app-d5-mfer.vercel.app');
  return { version: 2, mode: process.env.APP_MODE || 'test', updatedAt: s.updatedAt.slice(0, 10), products: s.products.map(p => ({
    id: p.id, name: p.name, category: p.category, color: p.color, colorLabel: p.colorLabel,
    price: p.price, description: p.description, details: p.details, images: p.images.map(i => ({ ...i, src: new URL(i.src, origin).href })),
    photoNote: p.photoNote, referenceImage: p.referenceImage || false, createdAt: p.createdAt,
    visible: p.published && listedStock(p) !== 0, availability: listedStock(p) === 0 ? 'sold_out' : 'available'
  })) };
}
export function summary(s) {
  const result = Object.fromEntries(people.map(p => [p, { received: 0, paid: 0, transfers: 0, balance: 0 }]));
  const reversed = new Set(s.entries.filter(e => e.type === 'reversal').map(e => e.reversesId));
  for (const e of s.entries) {
    if (e.type === 'reversal' || reversed.has(e.id)) continue;
    if (['sale', 'historical_sale'].includes(e.type)) result[e.person].received += e.amountCents;
    if (['receipt', 'historical_purchase'].includes(e.type)) result[e.person].paid += e.amountCents;
    if (e.type === 'transfer') { result[e.person].transfers -= e.amountCents; result[e.to].transfers += e.amountCents; }
  }
  for (const r of Object.values(result)) r.balance = r.received - r.paid + r.transfers;
  return result;
}
export function snapshot(s, actor) {
  return { revision: s.revision, updatedAt: s.updatedAt, actor, products: s.products.map(p => ({ ...p, listedStock: listedStock(p) })), entries: s.entries, shipments: s.shipments || [], accounts: summary(s), needsStock: s.products.some(p => p.stock === null) };
}
export function applyCommand(s, command, actor, now = new Date().toISOString()) {
  const key = text(command.key, 'Identifikátor operácie', 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail('Neplatný identifikátor operácie.');
  const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  const previous = s.commands.find(c => c.key === key);
  if (previous) { if (previous.hash !== hash) fail('Identifikátor operácie už bol použitý.', 409); return { duplicate: true }; }
  if (command.type === 'historical') {
    if (!['purchase', 'sale', 'both'].includes(command.mode)) fail('Vyberte starší nákup, predaj alebo oboje.');
    const productName = text(command.productName, 'Názov tovaru', 100), note = text(command.note, 'Poznámka', 500, false);
    const records = [], common = { historical: true, historicalId: key, affectsStock: false, productName, note, at: now, createdBy: actor };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    const pastDate = value => { const result = date(value); if (result > today) fail('Staršie pohyby nemôžu mať budúci dátum.'); return result; };
    if (command.mode !== 'sale') {
      const costs = receiptCosts({ costs: command.costs });
      records.push({ ...common, id: randomUUID(), type: 'historical_purchase', date: pastDate(command.purchaseDate),
        qty: integer(command.purchaseQty, 'Počet kúpených kusov', 1, 10000), person: person(command.paidBy), amountCents: costs.amountCents, costs });
    }
    if (command.mode !== 'purchase') {
      const soldQty = integer(command.soldQty, 'Počet predaných kusov', 1, 10000), saleDate = pastDate(command.saleDate);
      if (command.mode === 'both' && soldQty > command.purchaseQty) fail('Predaných kusov nemôže byť viac než kúpených.');
      if (command.mode === 'both' && saleDate < command.purchaseDate) fail('Predaj nemôže byť pred dátumom nákupu.');
      records.push({ ...common, id: randomUUID(), type: 'historical_sale', date: saleDate, qty: soldQty,
        person: person(command.soldBy), amountCents: integer(command.saleAmountCents, 'Prijatá suma', 0) });
    }
    s.entries.push(...records); s.commands.push({ key, hash }); s.revision++; s.updatedAt = now;
    return { entryIds: records.map(e => e.id) };
  }
  if (command.type === 'shipment') {
    date(command.date); person(command.person);
    const note = text(command.note, 'Poznámka', 500, false);
    let costs;
    try { costs = allocateShipmentCosts(command.items, command.shippingCents, command.feesCents); }
    catch (e) { fail(e.message); }
    const draft = structuredClone(s), entryIds = [];
    for (const [index, item] of command.items.entries()) {
      const result = applyCommand(draft, {
        key: createHash('sha256').update(`${key}:item:${index}`).digest('hex'), type: 'receipt',
        date: command.date, person: command.person, note,
        productId: item.productId, product: item.product, qty: item.qty, listedQty: item.listedQty,
        costs: costs[index]
      }, actor, now);
      const saved = draft.entries.find(e => e.id === result.entryId);
      Object.assign(saved, { shipmentId: key, shipmentIndex: index + 1, shipmentItems: command.items.length });
      entryIds.push(result.entryId);
    }
    draft.shipments ||= [];
    draft.shipments.push({ id: key, entryIds, itemsCount: command.items.length,
      receivedQty: command.items.reduce((sum, i) => sum + i.qty, 0),
      goodsCents: costs.reduce((sum, c) => sum + c.goodsCents, 0), shippingCents: command.shippingCents,
      feesCents: command.feesCents, amountCents: costs.reduce((sum, c) => sum + c.amountCents, 0),
      allocation: 'received-pieces', person: command.person, date: command.date, at: now, note, createdBy: actor });
    draft.commands.push({ key, hash });
    Object.assign(s, draft);
    return { shipmentId: key, entryIds };
  }
  const p = s.products.find(p => p.id === command.productId);
  const entry = { id: randomUUID(), type: command.type, at: now, date: date(command.date), createdBy: actor, note: text(command.note, 'Poznámka', 500, false) };
  let target = p;
  switch (command.type) {
    case 'opening': {
      if (!p) fail('Produkt sa nenašiel.', 404);
      if (p.stock !== null) fail('Počiatočný stav tohto produktu už bol nastavený.', 409);
      p.stock = integer(command.qty, 'Počet kusov', 0, 10000);
      p.listedStock = p.stock;
      p.unitCostCents = command.unitCostCents == null ? null : integer(command.unitCostCents, 'Náklad na kus');
      Object.assign(entry, { productId: p.id, qty: p.stock, amountCents: 0 });
      break;
    }
    case 'sale': {
      if (!p) fail('Produkt sa nenašiel.', 404);
      if (p.stock === null) fail('Najprv nastavte počiatočný počet kusov.');
      const qty = integer(command.qty, 'Počet kusov', 1, 10000);
      if (p.stock < qty || listedStock(p) < qty) fail('V ponuke už nie je dostatok kusov. Obnovte prehľad alebo uvoľnite kusy mimo ponuky.', 409);
      const amountCents = integer(command.amountCents, 'Prijatá suma', 1);
      p.listedStock = listedStock(p) - qty; p.stock -= qty;
      Object.assign(entry, { productId: p.id, qty, amountCents, person: person(command.person), costCents: p.unitCostCents == null ? null : p.unitCostCents * qty });
      break;
    }
    case 'receipt': {
      const qty = integer(command.qty, 'Počet kusov', 1, 10000);
      const costs = receiptCosts(command), { amountCents } = costs;
      const listedQty = integer(command.listedQty ?? qty, 'Počet kusov do ponuky', 0, qty);
      const paidBy = person(command.person);
      if (command.productId && !p) fail('Produkt sa nenašiel.', 404);
      if (p && p.stock === null) fail('Najprv nastavte počiatočný stav produktu.');
      if (!p) {
        const data = command.product || {};
        const category = ['beanies', 'hoodies', 'tshirts', 'other'].includes(data.category) ? data.category : 'other';
        const imageIds = data.imageIds;
        if (!Array.isArray(imageIds) || imageIds.length < 1 || imageIds.length > 6) fail('Pridajte 1 až 6 fotografií.');
        const images = imageIds.map(id => { const image = s.images.find(i => i.id === id); if (!image) fail('Fotografia sa nenašla. Nahrajte ju znovu.'); return { src: `/api/index?action=image&id=${id}`, crop: 'normal', alt: text(data.name, 'Názov', 100) }; });
        let description = text(data.description, 'Popis', 1800);
        if (data.replica !== false && !/replik/i.test(description)) description += ' Replika, nie originálny výrobok značky.';
        if (data.referenceImage && !/referen/i.test(description)) description += ' Fotografia je iba referenciou vzhľadu, nie fotografiou konkrétneho ponúkaného kusu.';
        target = { id: `D5-${randomUUID().slice(0, 8).toUpperCase()}`, name: text(data.name, 'Názov', 100), category,
          color: 'other', colorLabel: text(data.colorLabel, 'Farba / veľkosť', 100, false), price: integer(data.priceCents, 'Predajná cena', 1) / 100,
          description, details: [text(data.colorLabel, 'Farba / veľkosť', 100, false)].filter(Boolean),
          images, replica: data.replica !== false, referenceImage: Boolean(data.referenceImage), photoNote: data.referenceImage ? 'Referenčná fotografia vzhľadu; nejde o fotografiu konkrétneho ponúkaného kusu.' : 'Fotografia dodaná pre katalóg.', stock: 0, listedStock: 0, unitCostCents: 0,
          published: Boolean(data.published), visible: Boolean(data.published), availability: 'available', createdAt: now };
        s.products.push(target);
      }
      if (target.stock + qty > 10000) fail('Maximálny počet kusov je 10 000.');
      entry.previousUnitCostCents = target.unitCostCents;
      entry.previousListedStock = listedStock(target);
      target.unitCostCents = target.stock === 0 ? Math.round(amountCents / qty) : target.unitCostCents == null ? null : Math.round((target.stock * target.unitCostCents + amountCents) / (target.stock + qty));
      target.listedStock = listedStock(target) + listedQty; target.stock += qty;
      Object.assign(entry, { productId: target.id, qty, receivedQty: qty, listedQty, costs, amountCents, person: paidBy });
      break;
    }
    case 'adjustment': {
      if (!p || p.stock === null) fail('Najprv nastavte počiatočný stav produktu.');
      if (!entry.note) fail('Pri oprave skladu doplňte dôvod.');
      const qty = integer(command.qty, 'Nový stav', 0, 10000);
      Object.assign(entry, { productId: p.id, qty: qty - p.stock, amountCents: 0 }); p.listedStock = Math.min(listedStock(p), qty); p.stock = qty;
      break;
    }
    case 'product': {
      if (!p) fail('Produkt sa nenašiel.', 404);
      p.name = text(command.name, 'Názov', 100); p.price = integer(command.priceCents, 'Predajná cena', 1) / 100;
      p.description = text(command.description, 'Popis', 2000); p.published = Boolean(command.published);
      if (command.listedQty != null) {
        if (p.stock === null) fail('Najprv nastavte počiatočný počet kusov.');
        p.listedStock = integer(command.listedQty, 'Počet kusov v ponuke', 0, p.stock);
        entry.listedQty = p.listedStock;
      }
      Object.assign(entry, { productId: p.id, amountCents: 0 });
      break;
    }
    case 'transfer': {
      const from = person(command.person), to = person(command.to);
      if (from === to) fail('Vyberte dve rôzne osoby.');
      Object.assign(entry, { person: from, to, amountCents: integer(command.amountCents, 'Suma', 1) });
      break;
    }
    case 'reversal': {
      const original = s.entries.find(e => e.id === command.entryId);
      if (!original || !['sale', 'receipt', 'transfer', 'historical_purchase', 'historical_sale'].includes(original.type)) fail('Tento záznam nie je možné stornovať.');
      if (s.entries.some(e => e.reversesId === original.id)) fail('Záznam už bol stornovaný.', 409);
      if (!entry.note) fail('Doplňte dôvod storna.');
      const product = s.products.find(p => p.id === original.productId);
      if (original.type === 'sale') {
        if (product.stock + original.qty > 10000) fail('Po storne by sklad prekročil 10 000 kusov.', 409);
        product.listedStock = listedStock(product) + original.qty; product.stock += original.qty;
      }
      if (original.type === 'receipt') {
        const laterStockMovements = s.entries.slice(s.entries.indexOf(original) + 1).some(e => e.productId === original.productId && (['sale','receipt','adjustment','reversal'].includes(e.type) || (e.type === 'product' && e.listedQty != null)));
        if (laterStockMovements || product.stock < original.qty) fail('Po tomto príjme už boli ďalšie pohyby. Použite opravu skladu a samostatne dohodnite finančné vyrovnanie.', 409);
        product.listedStock = original.previousListedStock ?? Math.max(0, listedStock(product) - original.qty);
        product.stock -= original.qty;
        product.unitCostCents = original.previousUnitCostCents ?? null;
      }
      Object.assign(entry, { reversesId: original.id, productId: original.productId, productName: original.productName, amountCents: original.amountCents, person: original.person,
        ...(original.historical ? { historical: true, historicalId: original.historicalId, affectsStock: false } : {}) });
      break;
    }
    default: fail('Neznáma operácia.');
  }
  if (target) entry.productName = target.name;
  s.entries.push(entry); s.commands.push({ key, hash }); s.revision++; s.updatedAt = now;
  return { entryId: entry.id };
}

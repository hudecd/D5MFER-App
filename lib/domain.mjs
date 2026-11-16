import { createHash, randomUUID } from 'node:crypto';
import seed from './catalog-seed.json' with { type: 'json' };

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
export function publicCatalog(s) {
  return { version: 2, updatedAt: s.updatedAt.slice(0, 10), products: s.products.map(p => ({
    id: p.id, name: p.name, category: p.category, color: p.color, colorLabel: p.colorLabel,
    price: p.price, description: p.description, details: p.details, images: p.images,
    photoNote: p.photoNote, referenceImage: p.referenceImage || false, createdAt: p.createdAt,
    visible: p.published && p.stock !== 0, availability: p.stock === 0 ? 'sold_out' : 'available'
  })) };
}
export function summary(s) {
  const result = Object.fromEntries(people.map(p => [p, { received: 0, paid: 0, transfers: 0, balance: 0 }]));
  const reversed = new Set(s.entries.filter(e => e.type === 'reversal').map(e => e.reversesId));
  for (const e of s.entries) {
    if (e.type === 'reversal' || reversed.has(e.id)) continue;
    if (e.type === 'sale') result[e.person].received += e.amountCents;
    if (e.type === 'receipt') result[e.person].paid += e.amountCents;
    if (e.type === 'transfer') { result[e.person].transfers -= e.amountCents; result[e.to].transfers += e.amountCents; }
  }
  for (const r of Object.values(result)) r.balance = r.received - r.paid + r.transfers;
  return result;
}
export function snapshot(s, actor) {
  return { revision: s.revision, updatedAt: s.updatedAt, actor, products: s.products, entries: s.entries, accounts: summary(s), needsStock: s.products.some(p => p.stock === null) };
}
export function applyCommand(s, command, actor, now = new Date().toISOString()) {
  const key = text(command.key, 'Identifikátor operácie', 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail('Neplatný identifikátor operácie.');
  const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  const previous = s.commands.find(c => c.key === key);
  if (previous) { if (previous.hash !== hash) fail('Identifikátor operácie už bol použitý.', 409); return { duplicate: true }; }
  const p = s.products.find(p => p.id === command.productId);
  const entry = { id: randomUUID(), type: command.type, at: now, date: date(command.date), createdBy: actor, note: text(command.note, 'Poznámka', 500, false) };
  let target = p;
  switch (command.type) {
    case 'opening': {
      if (!p) fail('Produkt sa nenašiel.', 404);
      if (p.stock !== null) fail('Počiatočný stav tohto produktu už bol nastavený.', 409);
      p.stock = integer(command.qty, 'Počet kusov', 0, 10000);
      p.unitCostCents = command.unitCostCents == null ? null : integer(command.unitCostCents, 'Náklad na kus');
      Object.assign(entry, { productId: p.id, qty: p.stock, amountCents: 0 });
      break;
    }
    case 'sale': {
      if (!p) fail('Produkt sa nenašiel.', 404);
      if (p.stock === null) fail('Najprv nastavte počiatočný počet kusov.');
      const qty = integer(command.qty, 'Počet kusov', 1, 10000);
      if (p.stock < qty) fail('Na sklade už nie je dostatok kusov. Obnovte prehľad.', 409);
      const amountCents = integer(command.amountCents, 'Prijatá suma', 1);
      p.stock -= qty;
      Object.assign(entry, { productId: p.id, qty, amountCents, person: person(command.person), costCents: p.unitCostCents == null ? null : p.unitCostCents * qty });
      break;
    }
    case 'receipt': {
      const qty = integer(command.qty, 'Počet kusov', 1, 10000);
      const amountCents = integer(command.amountCents, 'Nákup vrátane dopravy', 0);
      const paidBy = person(command.person);
      if (command.productId && !p) fail('Produkt sa nenašiel.', 404);
      if (p && p.stock === null) fail('Najprv nastavte počiatočný stav produktu.');
      if (!p) {
        const data = command.product || {};
        const category = ['beanies', 'hoodies', 'tshirts', 'other'].includes(data.category) ? data.category : 'other';
        const imageIds = data.imageIds;
        if (!Array.isArray(imageIds) || imageIds.length < 1 || imageIds.length > 6) fail('Pridajte 1 až 6 fotografií.');
        const images = imageIds.map(id => { const image = s.images.find(i => i.id === id); if (!image) fail('Fotografia sa nenašla. Nahrajte ju znovu.'); return { src: `https://d5mfer-app.vercel.app/api/index?action=image&id=${id}`, crop: 'normal', alt: text(data.name, 'Názov', 100) }; });
        target = { id: `D5-${randomUUID().slice(0, 8).toUpperCase()}`, name: text(data.name, 'Názov', 100), category,
          color: 'other', colorLabel: text(data.colorLabel, 'Farba / veľkosť', 100, false), price: integer(data.priceCents, 'Predajná cena', 1) / 100,
          description: text(data.description, 'Popis', 2000), details: [text(data.colorLabel, 'Farba / veľkosť', 100, false)].filter(Boolean),
          images, photoNote: 'Fotografia dodaná pre katalóg.', stock: 0, unitCostCents: 0,
          published: Boolean(data.published), visible: Boolean(data.published), availability: 'available', createdAt: now };
        s.products.push(target);
      }
      if (target.stock + qty > 10000) fail('Maximálny počet kusov je 10 000.');
      entry.previousUnitCostCents = target.unitCostCents;
      target.unitCostCents = target.stock === 0 ? Math.round(amountCents / qty) : target.unitCostCents == null ? null : Math.round((target.stock * target.unitCostCents + amountCents) / (target.stock + qty));
      target.stock += qty;
      Object.assign(entry, { productId: target.id, qty, amountCents, person: paidBy });
      break;
    }
    case 'adjustment': {
      if (!p || p.stock === null) fail('Najprv nastavte počiatočný stav produktu.');
      if (!entry.note) fail('Pri oprave skladu doplňte dôvod.');
      const qty = integer(command.qty, 'Nový stav', 0, 10000);
      Object.assign(entry, { productId: p.id, qty: qty - p.stock, amountCents: 0 }); p.stock = qty;
      break;
    }
    case 'product': {
      if (!p) fail('Produkt sa nenašiel.', 404);
      p.name = text(command.name, 'Názov', 100); p.price = integer(command.priceCents, 'Predajná cena', 1) / 100;
      p.description = text(command.description, 'Popis', 2000); p.published = Boolean(command.published);
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
      if (!original || !['sale', 'receipt', 'transfer'].includes(original.type)) fail('Tento záznam nie je možné stornovať.');
      if (s.entries.some(e => e.reversesId === original.id)) fail('Záznam už bol stornovaný.', 409);
      if (!entry.note) fail('Doplňte dôvod storna.');
      const product = s.products.find(p => p.id === original.productId);
      if (original.type === 'sale') product.stock += original.qty;
      if (original.type === 'receipt') {
        const laterStockMovements = s.entries.slice(s.entries.indexOf(original) + 1).some(e => e.productId === original.productId && ['sale','receipt','adjustment','reversal'].includes(e.type));
        if (laterStockMovements || product.stock < original.qty) fail('Po tomto príjme už boli ďalšie pohyby. Použite opravu skladu a samostatne dohodnite finančné vyrovnanie.', 409);
        product.stock -= original.qty;
        product.unitCostCents = original.previousUnitCostCents ?? null;
      }
      Object.assign(entry, { reversesId: original.id, productId: original.productId, amountCents: original.amountCents, person: original.person });
      break;
    }
    default: fail('Neznáma operácia.');
  }
  if (target) entry.productName = target.name;
  s.entries.push(entry); s.commands.push({ key, hash }); s.revision++; s.updatedAt = now;
  return { entryId: entry.id };
}

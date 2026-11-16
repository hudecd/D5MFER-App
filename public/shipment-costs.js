function whole(value, label, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}: zadajte platné celé číslo.`);
  return value;
}
function shares(total, quantities) {
  const weight = quantities.reduce((sum, n) => sum + n, 0);
  const parts = quantities.map((qty, index) => ({ index, amount: Math.floor(total * qty / weight), remainder: total * qty % weight }));
  let left = total - parts.reduce((sum, part) => sum + part.amount, 0);
  const order = parts.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < left; i++) order[i].amount++;
  return parts.map(part => part.amount);
}
export function allocateShipmentCosts(items, shippingCents, feesCents) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new Error('Balík musí obsahovať 1 až 50 druhov tovaru.');
  whole(shippingCents, 'Poštovné'); whole(feesCents, 'Ostatné poplatky');
  const quantities = items.map(item => whole(item.qty, 'Doručené kusy', 1, 10000));
  const goods = items.map(item => whole(item.goodsCents, 'Cena tovaru'));
  whole(goods.reduce((sum, n) => sum + n, 0) + shippingCents + feesCents, 'Celkové náklady balíka');
  const shipping = shares(shippingCents, quantities), fees = shares(feesCents, quantities);
  return items.map((item, index) => ({
    goodsCents: goods[index], shippingCents: shipping[index], feesCents: fees[index],
    amountCents: goods[index] + shipping[index] + fees[index]
  }));
}

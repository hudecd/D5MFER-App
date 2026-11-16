import { get, put } from '@vercel/blob';
import { initialState, AppError } from './domain.mjs';

const pathname = 'private/d5mfer-ledger-v1.json';
// HTTP compression can prefix the object ETag with W/. Blob conditional writes
// compare the original object validator, including its quotes.
const objectETag = result => result.blob.etag.replace(/^W\//, '');
export async function readState() {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return { state: initialState(), etag: null };
  return { state: await new Response(result.stream).json(), etag: objectETag(result) };
}
export async function transaction(fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await readState();
    const result = await fn(state);
    try {
      await put(pathname, JSON.stringify(state), { access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
      return { state, result };
    } catch (e) {
      if (!['BlobPreconditionFailedError', 'BlobAlreadyExistsError'].includes(e.constructor.name)) throw e;
    }
  }
  throw new AppError('Prebieha iný zápis. Skúste operáciu znova; jej identifikátor zabráni duplicite.', 409);
}
export async function rateLimit(key) {
  const path = `private/limits/${key}.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await get(path, { access: 'private', useCache: false });
    let value = existing ? await new Response(existing.stream).json() : null;
    if (!value || value.until < Date.now()) value = { attempts: 0, until: Date.now() + 15 * 60000 };
    if (value.attempts >= 12) throw new AppError('Priveľa pokusov. Skúste znova o 15 minút.', 429);
    value.attempts++;
    try { await put(path, JSON.stringify(value), { access: 'private', addRandomSuffix: false, contentType: 'application/json', ...(existing ? { ifMatch: objectETag(existing) } : { allowOverwrite: false }) }); return; }
    catch (e) { if (!['BlobPreconditionFailedError','BlobAlreadyExistsError'].includes(e.constructor.name)) throw e; }
  }
  throw new AppError('Skúste prihlásenie znova o chvíľu.', 429);
}

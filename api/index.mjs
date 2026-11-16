import { createHash, randomUUID } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { AppError, people, initialState, publicCatalog, snapshot, applyCommand, text } from '../lib/domain.mjs';
import { readState, transaction, rateLimit } from '../lib/storage.mjs';
import { authenticate, equal, passwordHash, verifyPassword, sessionCookie } from '../lib/auth.mjs';

const json = (res, status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
const secure = req => req.headers.host !== 'localhost:3000';
function assertOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || new URL(origin).host !== req.headers.host) throw new AppError('Otvorte formulár priamo v aplikácii.', 403);
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new AppError('Očakáva sa JSON.', 415);
}
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 3 * 1024 * 1024) throw new AppError('Príliš veľký súbor.', 413); raw += chunk; }
  return JSON.parse(raw || '{}');
}
function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new AppError('Fotografia musí byť JPG, PNG alebo WebP.');
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, `https://${req.headers.host}`), action = url.searchParams.get('action');
  try {
    if (req.method === 'GET') {
      if (action === 'health') return json(res, 200, { ok: true, version: '1.0.0' });
      if (action === 'catalog') {
        const { state } = await readState(); res.setHeader('Access-Control-Allow-Origin', '*');
        return json(res, 200, publicCatalog(state));
      }
      const { state } = await readState();
      if (action === 'status') return json(res, 200, { initialized: Boolean(state.users.Damian && state.users.Fero), mode: process.env.APP_MODE || 'test' });
      if (action === 'image') {
        const id = url.searchParams.get('id');
        const image = state.images.find(i => i.id === id);
        if (!image) throw new AppError('Fotografia sa nenašla.', 404);
        const publicImage = publicCatalog(state).products.some(p => p.visible && p.images.some(i => i.src.includes(`id=${id}`)));
        if (!publicImage) authenticate(req, state);
        const result = await get(image.pathname, { access: 'private' });
        if (!result) throw new AppError('Fotografia sa nenašla.', 404);
        res.setHeader('Content-Type', image.type);
        return res.end(Buffer.from(await new Response(result.stream).arrayBuffer()));
      }
      const actor = authenticate(req, state);
      if (action === 'state' || action === 'export') return json(res, 200, snapshot(state, actor));
      throw new AppError('Táto stránka neexistuje.', 404);
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new AppError('Nepovolená metóda.', 405); }
    assertOrigin(req);
    const data = await body(req);
    if (action === 'setup' || action === 'login') {
      const ip = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'unknown';
      await rateLimit(createHash('sha256').update(`${action}:${ip}:${process.env.SESSION_SECRET}`).digest('hex'));
    }
    if (action === 'setup') {
      if (!process.env.BOOTSTRAP_TOKEN || !equal(data.token, process.env.BOOTSTRAP_TOKEN)) throw new AppError('Neplatný aktivačný odkaz.', 403);
      const users = {};
      for (const name of people) users[name] = { hash: await passwordHash(data.passwords?.[name]), version: randomUUID() };
      const { state } = await transaction(s => {
        if (Object.keys(s.users).length) throw new AppError('Aplikácia už je aktivovaná. Prihláste sa.', 409);
        s.users = users; s.revision++; s.updatedAt = new Date().toISOString();
      });
      res.setHeader('Set-Cookie', sessionCookie('Damian', state.users.Damian.version, secure(req)));
      return json(res, 200, snapshot(state, 'Damian'));
    }
    if (action === 'login') {
      const { state } = await readState();
      if (!people.includes(data.person) || !await verifyPassword(data.password, state.users[data.person]?.hash)) throw new AppError('Nesprávne meno alebo heslo.', 401);
      res.setHeader('Set-Cookie', sessionCookie(data.person, state.users[data.person].version, secure(req)));
      return json(res, 200, snapshot(state, data.person));
    }
    const { state: current } = await readState(), actor = authenticate(req, current);
    if (action === 'logout') {
      res.setHeader('Set-Cookie', `d5_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req) ? '; Secure' : ''}`);
      return json(res, 200, { ok: true });
    }
    if (action === 'password') {
      if (!await verifyPassword(data.currentPassword, current.users[actor].hash)) throw new AppError('Aktuálne heslo nie je správne.', 403);
      const hash = await passwordHash(data.password);
      const version = randomUUID();
      await transaction(s => { authenticate(req, s); s.users[actor] = { hash, version }; });
      res.setHeader('Set-Cookie', sessionCookie(actor, version, secure(req)));
      return json(res, 200, { ok: true });
    }
    if (action === 'command') {
      const { state } = await transaction(s => { const who = authenticate(req, s); return applyCommand(s, data, who); });
      return json(res, 200, snapshot(state, actor));
    }
    if (action === 'upload') {
      const encoded = text(data.base64, 'Fotografia', 2900000);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new AppError('Neplatná fotografia.');
      const buffer = Buffer.from(encoded, 'base64');
      if (buffer.length > 2 * 1024 * 1024 || buffer.length < 16) throw new AppError('Fotografia môže mať najviac 2 MB.');
      const type = imageType(buffer), id = randomUUID(), pathname = `photos/${id}`;
      await put(pathname, buffer, { access: 'private', addRandomSuffix: false, contentType: type });
      await transaction(s => { authenticate(req, s); s.images.push({ id, pathname, type, at: new Date().toISOString(), createdBy: actor }); });
      return json(res, 200, { id, src: `/api/index?action=image&id=${id}` });
    }
    throw new AppError('Neznáma operácia.', 404);
  } catch (e) {
    if (!(e instanceof AppError) && !(e instanceof SyntaxError)) console.error('D5MFER API:', e.constructor.name);
    return json(res, e instanceof AppError ? e.status : e instanceof SyntaxError ? 400 : 503, { error: e instanceof AppError ? e.message : e instanceof SyntaxError ? 'Neplatné údaje formulára.' : 'Úložisko sa nepodarilo načítať. Skúste znova; údaje sa neukladajú iba do telefónu.' });
  }
}

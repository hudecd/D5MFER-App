import { createHmac, timingSafeEqual, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, people } from './domain.mjs';
const scrypt = promisify(scryptCallback);
export function equal(a, b) { const aa = Buffer.from(a || ''), bb = Buffer.from(b || ''); return aa.length === bb.length && timingSafeEqual(aa, bb); }
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AppError('Heslo musí mať 12 až 128 znakov.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128 || typeof hash !== 'string') return false;
  const [salt, expected] = hash.split(':');
  return equal((await scrypt(password, salt, 64)).toString('hex'), expected);
}
function sign(payload) { if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required'); return createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url'); }
export function sessionCookie(person, version, secure = true) {
  const value = Buffer.from(JSON.stringify({ person, version, exp: Date.now() + 30 * 86400000 })).toString('base64url');
  return `d5_session=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`;
}
export function authenticate(req, state) {
  const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('d5_session='))?.slice(11);
  const [data, signature] = (token || '').split('.');
  if (!data || !signature || !equal(signature, sign(data))) throw new AppError('Prihláste sa do aplikácie.', 401);
  let decoded; try { decoded = JSON.parse(Buffer.from(data, 'base64url')); } catch { throw new AppError('Prihláste sa znova.', 401); }
  if (!people.includes(decoded.person) || decoded.exp < Date.now() || state.users[decoded.person]?.version !== decoded.version) throw new AppError('Platnosť prihlásenia skončila.', 401);
  return decoded.person;
}

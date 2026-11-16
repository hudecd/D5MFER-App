import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { passwordHash, verifyPassword, sessionCookie, authenticate } from '../lib/auth.mjs';
process.env.SESSION_SECRET=randomBytes(48).toString('base64url');
test('passwords are salted and checked correctly',async()=>{const a=await passwordHash('Long enough password 123'),b=await passwordHash('Long enough password 123');assert.notEqual(a,b);assert.equal(await verifyPassword('Long enough password 123',a),true);assert.equal(await verifyPassword('incorrect',a),false);await assert.rejects(passwordHash('short'));});
test('session cookie is secure and tampering or revocation is rejected',()=>{const state={users:{Damian:{version:'v1'}}};const cookie=sessionCookie('Damian','v1');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('Secure'));assert.ok(cookie.includes('SameSite=Strict'));const req={headers:{cookie:cookie.split(';')[0]}};assert.equal(authenticate(req,state),'Damian');assert.throws(()=>authenticate({headers:{cookie:req.headers.cookie+'x'}},state));state.users.Damian.version='v2';assert.throws(()=>authenticate(req,state));});

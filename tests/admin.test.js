import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import handler from '../api/admin.js';

async function request(headers={},query={}) {
  let result;
  await handler({method:'GET',headers,query}, {
    setHeader(){},status(status){this.code=status;return this;},json(body){result={status:this.code,...body};}
  });
  return result;
}
test('admin is disabled without an environment key',async()=>{
  const previous=process.env.ADMIN_KEY; delete process.env.ADMIN_KEY;
  try {const r=await request();assert.equal(r.status,503);assert.match(r.error,/ADMIN_KEY/);}
  finally {if(previous===undefined)delete process.env.ADMIN_KEY;else process.env.ADMIN_KEY=previous;}
});
test('admin rejects missing and incorrect credentials when configured',async()=>{
  const previous=process.env.ADMIN_KEY;process.env.ADMIN_KEY=randomBytes(32).toString('hex');
  try {
    assert.equal((await request()).status,401);
    assert.equal((await request({'x-admin-key':randomBytes(32).toString('hex')})).status,401);
  } finally {if(previous===undefined)delete process.env.ADMIN_KEY;else process.env.ADMIN_KEY=previous;}
});
test('admin does not accept secrets in URL query strings',async()=>{
  const previous=process.env.ADMIN_KEY;process.env.ADMIN_KEY=randomBytes(32).toString('hex');
  try {assert.equal((await request({}, {key:process.env.ADMIN_KEY})).status,401);}
  finally {if(previous===undefined)delete process.env.ADMIN_KEY;else process.env.ADMIN_KEY=previous;}
});

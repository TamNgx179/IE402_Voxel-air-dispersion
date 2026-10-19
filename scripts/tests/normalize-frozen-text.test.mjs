import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeFrozenText } from '../normalize-frozen-text.mjs';

async function fixture(fn) {
  const root=await mkdtemp(join(tmpdir(),'voxel-freeze-'));
  try {
    await mkdir(join(root,'deploy'));await mkdir(join(root,'src'));
    const content='print("unchanged")\n';
    const lock=JSON.stringify({schema_version:1,files:{'src/model.py':createHash('sha256').update(content).digest('hex')}});
    await writeFile(join(root,'deploy/model-freeze.json'),lock);
    await writeFile(join(root,'src/model.py'),content.replaceAll('\n','\r\n'));
    await fn(root,lock);
  }finally{await rm(root,{recursive:true,force:true});}
}
test('audit does not write; apply repairs exact CRLF bytes, preserves lock and is idempotent',()=>fixture(async(root,lock)=>{
  const path=join(root,'src/model.py');
  assert.equal((await normalizeFrozenText(root)).repaired_files.length,1);
  assert.match(await readFile(path,'utf8'),/\r\n/);
  assert.equal((await normalizeFrozenText(root,true)).repaired_files.length,1);
  assert.doesNotMatch(await readFile(path,'utf8'),/\r/);
  assert.deepEqual((await normalizeFrozenText(root,true)).repaired_files,[]);
  assert.equal(await readFile(join(root,'deploy/model-freeze.json'),'utf8'),lock);
}));
test('content drift refuses repair, never changes source or lock',()=>fixture(async(root,lock)=>{
  const path=join(root,'src/model.py');await writeFile(path,'print("changed")\r\n');
  await assert.rejects(normalizeFrozenText(root,true),/Content drift/);
  assert.equal(await readFile(path,'utf8'),'print("changed")\r\n');
  assert.equal(await readFile(join(root,'deploy/model-freeze.json'),'utf8'),lock);
}));
test('all files are validated before any repair is applied',()=>fixture(async(root)=>{
  const lock=JSON.parse(await readFile(join(root,'deploy/model-freeze.json'),'utf8'));
  lock.files['src/second.py']='0'.repeat(64);
  await writeFile(join(root,'src/second.py'),'content drift\n');
  await writeFile(join(root,'deploy/model-freeze.json'),JSON.stringify(lock));
  await assert.rejects(normalizeFrozenText(root,true),/Content drift/);
  assert.match(await readFile(join(root,'src/model.py'),'utf8'),/\r\n/);
}));
test('out-of-root frozen paths are refused before reading',()=>fixture(async(root)=>{
  await writeFile(join(root,'deploy/model-freeze.json'),JSON.stringify({schema_version:1,files:{'../bad.py':'bad'}}));
  await assert.rejects(normalizeFrozenText(root,true),/Unsafe frozen path/);
}));

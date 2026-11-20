import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {memoryRuntime} from '../lib/offline.js';
test('standalone distillation runtime needs no evaluation or Studio plugin path', async t => {
 const root=await mkdtemp(join(tmpdir(),'fixchain-runtime-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'runtime.json');
 await writeFile(file,JSON.stringify({schemaVersion:'hmbot.rsi.distillation-runtime/1',python:'python3',skills:'/data/skills',migloop:{directory:'/data/migloop'}}));
 const runtime=await memoryRuntime(file); assert.equal(runtime.skills,'/data/skills'); assert.equal(runtime.pluginRoot,undefined); assert.equal(runtime.evaluation,undefined);
});
test('unsupported domain is rejected before creating a prepared run', async t => {
 const root=await mkdtemp(join(tmpdir(),'fixchain-domain-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const runtime=join(root,'runtime.json'),config=join(root,'config.json'),output=join(root,'prepared');
 await writeFile(runtime,JSON.stringify({schemaVersion:'hmbot.rsi.distillation-runtime/1',python:process.env.PYTHON||'python3',skills:'/unused/skills',migloop:{directory:'/unused/migloop'}}));
 await writeFile(config,JSON.stringify({domain:'invented-domain'}));
 const {prepareOffline}=await import('../lib/offline.js');
 await assert.rejects(prepareOffline(config,output,{runtime}),/supported task domain/);
 const {access}=await import('node:fs/promises');await assert.rejects(access(output),{code:'ENOENT'});
});

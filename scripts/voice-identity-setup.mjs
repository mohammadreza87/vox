#!/usr/bin/env node
/** Install only pinned public model bytes; no user audio or policy approval. */
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm, statfs } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = JSON.parse(await readFile(join(root, 'services/voice-identity/model.json'), 'utf8'));
const args = process.argv.slice(2);
const target = args[args.indexOf('--directory') + 1];
if (!args.includes('--directory') || !target || !isAbsolute(target) || args.some((a,i) => !['--directory','--download-model','--create-keys'].includes(a) && args[i-1] !== '--directory')) throw new Error('Usage: node scripts/voice-identity-setup.mjs --directory ABSOLUTE [--download-model] [--create-keys]');
await mkdir(target, { recursive:true, mode:0o700 });
const info = await lstat(target);
if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) throw new Error('Private owner-only directory required');
const disk = await statfs(target);
if (Number(disk.bavail) * Number(disk.bsize) < model.weightsBytes + 512_000_000) throw new Error('Insufficient free space');
const destination = join(target, model.weightsFile);
if (args.includes('--download-model')) {
  let exists = false;
  try { const s=await lstat(destination); if (!s.isFile() || s.isSymbolicLink() || s.size !== model.weightsBytes) throw new Error('Unexpected existing model'); const digest=createHash('sha256').update(await readFile(destination)).digest('hex'); if(digest!==model.weightsSha256) throw new Error('Model digest mismatch'); exists=true; } catch(e) {if(e.code!=='ENOENT') throw e;}
  if (!exists) {
    const temporary=join(target, `.model-${randomBytes(8).toString('hex')}.partial`);
    const file=await open(temporary, 'wx',0o600);
    try {
      const url=`https://huggingface.co/${model.id}/resolve/${model.revision}/${model.weightsFile}`;
      const response=await fetch(url,{signal:AbortSignal.timeout(120_000)});
      if(!response.ok || !response.body) throw new Error('Model download unavailable');
      const hash=createHash('sha256'); let bytes=0;
      for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>model.weightsBytes)throw new Error('Model size exceeded');hash.update(chunk);await file.writeFile(chunk);}
      if(bytes!==model.weightsBytes || hash.digest('hex')!==model.weightsSha256) throw new Error('Model artifact mismatch');
      await file.sync(); await file.close(); await rename(temporary,destination); await chmod(destination,0o600);
    } finally { await file.close().catch(()=>{}); await rm(temporary,{force:true}); }
  }
}
if(args.includes('--create-keys')) for(const [name,value] of [['socket-auth.key',randomBytes(32).toString('hex')],['template-encryption.key',randomBytes(32).toString('base64')]]) {
  const path=join(target,name); try{const file=await open(path,'wx',0o600);try{await file.writeFile(value+'\n');await file.sync();}finally{await file.close();}}catch(e){if(e.code!=='EEXIST')throw e;const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||st.mode&0o077)throw new Error('Unsafe existing key file');}
}
console.log(JSON.stringify({directory:target,providerId:model.providerId,modelDigest:model.weightsSha256,modelDownloadRequested:args.includes('--download-model'),keysRequested:args.includes('--create-keys'),inspectionQualified:false,policyChanged:false}));

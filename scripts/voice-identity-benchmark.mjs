#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const args=process.argv.slice(2),python=args[args.indexOf('--python')+1],model=args[args.indexOf('--model-dir')+1];
if(!args.includes('--python')||!args.includes('--model-dir')||!isAbsolute(python??'')||!isAbsolute(model??'')||args.length!==4)throw new Error('Usage: node scripts/voice-identity-benchmark.mjs --python ABSOLUTE --model-dir ABSOLUTE');
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../services/voice-identity/worker.py');
const child=spawn(python,[source,'benchmark','--model-dir',model],{stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'}});
const timer=setTimeout(()=>child.kill('SIGKILL'),60_000);let output='',bytes=0;
child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>10_000)child.kill('SIGKILL');else output+=chunk;});child.stderr.resume();
child.on('error',()=>{clearTimeout(timer);console.log(JSON.stringify({error:'local_encoder_benchmark_unavailable'}));process.exitCode=1;});
child.on('exit',code=>{clearTimeout(timer);if(code===0){try{const r=JSON.parse(output);if(r.kind!=='synthetic_signal_encoder_smoke'||r.recognitionAccuracyQualified!==false)throw Error();console.log(JSON.stringify(r));}catch{process.exitCode=1;}}else{console.log(JSON.stringify({error:'local_encoder_benchmark_unavailable'}));process.exitCode=1;}});

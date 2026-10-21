#!/usr/bin/env node
// Read-only server readiness; emits no secrets or biometric data.
import { localVoiceIdentityOptions } from '../src/lib/adaptive/voice-identity/runtime-config.ts';
try {
  const result=await localVoiceIdentityOptions(process.env,{storage:process.env.STUDIO_STORAGE==='firestore'?'firestore':'file'});
  console.log(JSON.stringify({selected:result.selected,ready:result.options.enabled===true,reason:result.readiness}));
  if(result.readiness!=='ready')process.exitCode=2;
} catch {console.log(JSON.stringify({ready:false,reason:'local_voice_configuration_invalid'}));process.exitCode=1;}

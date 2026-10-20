import { it, expect } from 'vitest';
import { trustedStudioRequestOrigin } from './request-origin';
it('trusted public origin ignores the internal request URL',()=>{
    expect(trustedStudioRequestOrigin('http://localhost:3186/api','https://public.synthetic/studio')).toBe('https://public.synthetic');
    expect(trustedStudioRequestOrigin('http://localhost:3186/api','https://public.synthetic:444/studio/')).toBe('https://public.synthetic:444');
});
it('unconfigured direct server retains its exact request origin',()=>expect(trustedStudioRequestOrigin('http://127.0.0.1:3186/api')).toBe('http://127.0.0.1:3186'));
it.each(['http://localhost:3186/studio','http://127.0.0.1:3186/studio','http://[::1]:3186/studio'])('explicit local fixture %s is supported',url=>expect(trustedStudioRequestOrigin('https://other.invalid',url)).toBe(new URL(url).origin));
it.each(['','bad','null','https://user:password@public.synthetic/studio','https://public.synthetic/privacy','https://public.synthetic/studio?x=1','https://public.synthetic/studio#x','http://public.synthetic/studio','http://localhost.attacker.invalid/studio','http://127.0.0.2/studio','https://public.synthetic/studio/child'])('invalid configured %s never falls back',url=>expect(trustedStudioRequestOrigin('http://localhost:3186/api',url)).toBeUndefined());

/** S03: the existing skill-routing-gateway suite, unmodified, with TIREH_CACHED_PROMPT=1 (flags are read at call time). */
import { afterAll, beforeEach, vi } from 'vitest';

vi.hoisted(() => { process.env.TIREH_CACHED_PROMPT = '1'; });
beforeEach(() => { vi.stubEnv('TIREH_CACHED_PROMPT', '1'); });
afterAll(() => { vi.unstubAllEnvs(); delete process.env.TIREH_CACHED_PROMPT; });

import './skill-routing-gateway.test';

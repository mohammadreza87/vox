import { describe, expect, it } from 'vitest';
import { assembleCatalog, CATALOG, catalogView, projectCatalog } from '../catalog';
import type { PackModule } from '../types';
import { coreModule, fixtureCatalog, fixtureRole, fixtureSkill, FIXTURE_MODULES, mobileModule, techModule } from './fixtures';

/** The fixture library with one module replaced. */
const withModule = (module: PackModule, replacing: PackModule = mobileModule) => FIXTURE_MODULES.map((m) => (m === replacing ? module : m));

const BODY_KEYS = ['method', 'qualityBar', 'pitfalls', 'whenToUse', 'frameworks', 'sources', 'deliverable', 'keywords', 'knowledge', 'pointOfView', 'voice', 'boundaries'];

function bodyKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) bodyKeys(item, found);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (BODY_KEYS.includes(key)) found.add(key);
      bodyKeys(inner, found);
    }
  }
  return found;
}

describe('assembleCatalog', () => {
  it('assembles a valid library with packs in their canonical order and a content version', () => {
    const catalog = fixtureCatalog([...FIXTURE_MODULES].reverse());
    expect(catalog.packs.map((p) => p.id)).toEqual(['lifestyle', 'tech', 'mobile', 'publisher']);
    expect(catalog.version).toMatch(/^[0-9a-f]{12}$/);
    expect(fixtureCatalog().version).toBe(fixtureCatalog().version);
  });

  it('rejects roles that reference missing skills', () => {
    const broken: PackModule = { ...mobileModule, roles: mobileModule.roles.map((r, i) => (i === 0 ? { ...r, optionalSkills: ['ua.missing'] } : r)) };
    expect(() => assembleCatalog(withModule(broken))).toThrow(/role mobile\.ua-manager references missing skill ua\.missing/);
  });

  it('rejects duplicate skills and roles', () => {
    const dupeSkill: PackModule = { ...coreModule, skills: [...coreModule.skills, coreModule.skills[0]] };
    expect(() => assembleCatalog(withModule(dupeSkill, coreModule))).toThrow(/duplicate skill core\.decision-memo/);
    const dupeRole: PackModule = { ...techModule, roles: [...techModule.roles, techModule.roles[0]] };
    expect(() => assembleCatalog(withModule(dupeRole, techModule))).toThrow(/duplicate role tech\.product-manager/);
  });

  it('rejects roles outside their pack namespace and packs that list another pack’s role', () => {
    const stray = fixtureRole('tech.stray', 'work', 'Stray', 'Lives in the wrong pack.', ['core.decision-memo', 'core.weekly-review', 'core.goal-setting'], [],
      ['one', 'two', 'three', 'four', 'five', 'six'], 'ash', { pack: 'mobile' });
    const mobile: PackModule = { ...mobileModule, pack: { ...mobileModule.pack!, roles: [...mobileModule.pack!.roles, 'tech.stray'] }, roles: [...mobileModule.roles, stray] };
    expect(() => assembleCatalog(withModule(mobile))).toThrow(/role tech\.stray is not namespaced by its pack mobile/);
    const borrowing: PackModule = { ...mobileModule, pack: { ...mobileModule.pack!, roles: [...mobileModule.pack!.roles, 'tech.product-manager'] } };
    expect(() => assembleCatalog(withModule(borrowing))).toThrow(/pack mobile lists role tech\.product-manager from pack tech/);
  });

  it('rejects over-length fields', () => {
    const longSkill: PackModule = { ...coreModule, skills: [...coreModule.skills, fixtureSkill('core.long', 'x'.repeat(41), 'Too long a title.')] };
    expect(() => assembleCatalog(withModule(longSkill, coreModule))).toThrow(/skill core\.long title/);
    const longRole: PackModule = { ...mobileModule, roles: mobileModule.roles.map((r, i) => (i === 0 ? { ...r, summary: 'y'.repeat(111) } : r)) };
    expect(() => assembleCatalog(withModule(longRole))).toThrow(/role mobile\.ua-manager summary/);
    const longPack: PackModule = { ...mobileModule, pack: { ...mobileModule.pack!, tagline: 'z'.repeat(81) } };
    expect(() => assembleCatalog(withModule(longPack))).toThrow(/pack mobile tagline/);
  });

  it('rejects a role missing from its pack and a pack listing a missing role', () => {
    const unlisted: PackModule = { ...mobileModule, pack: { ...mobileModule.pack!, roles: ['mobile.ua-manager'] } };
    expect(() => assembleCatalog(withModule(unlisted))).toThrow(/role mobile\.aso-specialist is missing from pack mobile/);
    const phantom: PackModule = { ...mobileModule, pack: { ...mobileModule.pack!, roles: [...mobileModule.pack!.roles, 'mobile.ghost'] } };
    expect(() => assembleCatalog(withModule(phantom))).toThrow(/pack mobile lists missing role mobile\.ghost/);
  });

  it('lists every problem in one error', () => {
    const broken: PackModule = {
      ...mobileModule,
      pack: { ...mobileModule.pack!, roles: ['mobile.ua-manager'] },
      roles: mobileModule.roles.map((r, i) => (i === 0 ? { ...r, skills: [...r.skills.slice(0, 3), 'ua.missing'] } : r)),
    };
    const error = (() => { try { assembleCatalog(withModule(broken)); } catch (e) { return e as Error; } })();
    expect(error?.message).toMatch(/missing skill ua\.missing[\s\S]*missing from pack mobile/);
  });
});

describe('client view', () => {
  it('projects any catalog without playbook bodies, keywords or voice', () => {
    const catalog = fixtureCatalog();
    const view = projectCatalog(catalog);
    expect(bodyKeys(view)).toEqual(new Set());
    expect(view.version).toBe(catalog.version);
    expect(view.roles.find((r) => r.id === 'mobile.ua-manager')).toEqual({
      id: 'mobile.ua-manager', pack: 'mobile', space: 'work', title: 'UA Manager', summary: 'Buys installs that pay back.',
      mission: expect.any(String), skills: expect.any(Array), optionalSkills: expect.any(Array), starters: expect.any(Array),
      hue: 'lagoon', traits: expect.any(Object), fa: expect.any(Object),
    });
    expect(view.skills.find((s) => s.id === 'ua.geo-launch')).toEqual({ id: 'ua.geo-launch', title: 'Geo launch plans', summary: expect.any(String) });
  });

  it('serves the shipped catalog the same way', () => {
    const view = catalogView();
    expect(view.version).toBe(CATALOG.version);
    expect(view.roles).toHaveLength(CATALOG.roles.length);
    expect(view.skills).toHaveLength(CATALOG.skills.length);
    expect(bodyKeys(view)).toEqual(new Set());
    expect(catalogView()).toBe(view);
  });
});

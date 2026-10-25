import { describe, expect, it } from 'vitest';

import { JULIUS_FILE_CREATION_GRANTS, juliusFileCreationGrant } from './index';

describe('the file-creation grant table, through the julius barrel', () => {
  it('holds exactly one grant: julius-inworld-data-1 may create under out/', () => {
    expect(Object.keys(JULIUS_FILE_CREATION_GRANTS)).toEqual(['julius-inworld-data-1']);
    expect(juliusFileCreationGrant('julius-inworld-data-1')).toEqual({ prefix: 'out/' });
  });

  it('is frozen, so nothing at runtime can add a row or widen a prefix', () => {
    expect(Object.isFrozen(JULIUS_FILE_CREATION_GRANTS)).toBe(true);
    expect(Object.isFrozen(JULIUS_FILE_CREATION_GRANTS['julius-inworld-data-1'])).toBe(true);
    expect(() => { (JULIUS_FILE_CREATION_GRANTS as Record<string, unknown>)['julius-live-mission-6'] = { prefix: '' }; }).toThrow();
    expect(juliusFileCreationGrant('julius-live-mission-6')).toBeNull();
  });

  it('answers null for any name that is not an own row', () => {
    for (const name of [null, undefined, '', 'constructor', '__proto__', 'julius-inworld-data-2']) {
      expect(juliusFileCreationGrant(name as string | null)).toBeNull();
    }
  });
});

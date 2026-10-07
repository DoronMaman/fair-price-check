import { describe, expect, it } from 'vitest';
import { QUERY_FIELDS } from './intent.js';
import { PropertyQuerySchema } from './query.js';

describe('QUERY_FIELDS', () => {
  it('lists exactly the PropertyQuery schema keys', () => {
    expect([...QUERY_FIELDS].sort()).toEqual(Object.keys(PropertyQuerySchema.shape).sort());
  });
});

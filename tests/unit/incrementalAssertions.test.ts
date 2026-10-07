// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertIncrementalLabelRestored } from '../helpers/incrementalAssertions';
import * as assertions from '../helpers/incrementalAssertions';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';

describe('incremental label restoration postcondition', () => {
  it('accepts the exact original value', () => {
    expect(() => assertIncrementalLabelRestored('Original label', 'Original label')).not.toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5])('rejects a no-op undo retaining edited sample suffix %s', sample => {
    expect(() => assertIncrementalLabelRestored(`Original label ${sample}`, 'Original label')).toThrow(/original text/);
  });
});

describe('incremental exported element restoration', () => {
  const { initialState } = makeIncrementalProject();
  const template = initialState.variants[initialState.activeVariantId].templates[initialState.nodes[initialState.rootId].type];
  const original = template.elements.find(element => element.type === 'text' && element.text)!;

  it('accepts original text and geometry after JSON export', () => {
    expect(() => assertions.assertIncrementalElementRestored(JSON.parse(JSON.stringify(original)), original)).not.toThrow();
  });

  it('rejects retained label edits in the final export', () => {
    expect(() => assertions.assertIncrementalElementRestored({ ...original, text: `${original.text} 5` }, original)).toThrow(/original text/);
  });

  it.each(['x', 'y', 'w', 'h', 'rotation'] as const)('rejects unrestored exported %s', field => {
    expect(() => assertions.assertIncrementalElementRestored({ ...original, [field]: original[field] + 1 }, original)).toThrow(/original geometry/);
  });

  it('rejects a missing exported element', () => {
    expect(() => assertions.assertIncrementalElementRestored(undefined, original)).toThrow(/missing/);
  });
});

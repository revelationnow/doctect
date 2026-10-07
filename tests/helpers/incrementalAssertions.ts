import assert from 'node:assert/strict';
import type { TemplateElement } from '../../types';

export function assertIncrementalLabelRestored(actual: string, original: string): void {
  assert.equal(actual, original, 'Label undo must restore the exact original text');
}

export function assertIncrementalElementRestored(actual: TemplateElement | undefined, original: TemplateElement): void {
  assert.ok(actual, 'Edited element is missing from the final export');
  assertIncrementalLabelRestored(actual.text!, original.text!);
  for (const field of ['x', 'y', 'w', 'h', 'rotation'] as const) {
    assert.equal(actual[field], original[field], `Undo must restore original geometry: ${field}`);
  }
}

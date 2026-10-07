import { expect, it } from 'vitest';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { partitionState } from '../../../../services/document/partition';
import { applyDocumentChanges } from '../../../../services/document/applyChanges';
import { canCoalescePreservedLayerTransfers, materializeLayerMappingsForTransfer } from '../../../../services/document/layerFolds';

function edits() {
  const initial = partitionState(makeIncrementalProject(2).initialState).document;
  const first = applyDocumentChanges(initial, [{ type: 'put-template', variantId: 'default', template: { ...initial.variants.default.templates['page-0'], name: 'First' } }]);
  const second = applyDocumentChanges(first.after, [{ type: 'put-template', variantId: 'default', template: { ...first.after.variants.default.templates['page-0'], name: 'Second' } }]);
  const a = materializeLayerMappingsForTransfer(first, { before: first.before, after: first.after, mappings: [] });
  const b = materializeLayerMappingsForTransfer(second, { before: second.before, after: second.after, mappings: [] });
  return { first, second, a, b };
}
it('coalesces only actual reference-proven unchanged sequences and their exact change objects', () => {
  const { first, second, a, b } = edits();
  expect(canCoalescePreservedLayerTransfers(a, first.changes, b, second.changes)).toBe(true);
  expect(canCoalescePreservedLayerTransfers(a, first.changes, structuredClone(b), second.changes)).toBe(false);
  expect(canCoalescePreservedLayerTransfers(a, first.changes, b, structuredClone(second.changes))).toBe(false);
  expect(canCoalescePreservedLayerTransfers(a, [], b, second.changes)).toBe(false);
});
it('equal-looking but independently replaced layer sequences do not gain continuity authority', () => {
  const { first, a } = edits(), template = first.after.variants.default.templates['page-0'];
  const second = applyDocumentChanges(first.after, [{ type: 'put-template', variantId: 'default', template: { ...template, layers: [...template.layers!] } }]);
  const mappings = template.layers!.map((_layer, position) => ({ type: 'continue' as const,
    from: { variantId: 'default', templateId: 'page-0', position }, to: { variantId: 'default', templateId: 'page-0', position } }));
  const b = materializeLayerMappingsForTransfer(second, { before: second.before, after: second.after, mappings });
  expect(canCoalescePreservedLayerTransfers(a, first.changes, b, second.changes)).toBe(false);
});

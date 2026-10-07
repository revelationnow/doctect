import type { NormalizedProject, NormalizedRecordTypes, ProjectStoreName } from './schema';
import { APP_STATE_FIELD_CLASSIFICATION } from '../../document/partition';
import { effect, runSync, type Work } from '../../../shared/cooperativeWork.js';
import { enumerableEntriesWork, plainJsonBytesWork } from '../../../shared/jsonWork.js';

/** Only selected old/new physical records, including affected container metadata. */
export type NormalizedProjectSlice = { [S in ProjectStoreName]?: ReadonlyMap<string, NormalizedRecordTypes[S]> };
export interface SizeLedger {
  stateBytes: number;
  projectBytes: number;
  documentBytes: number;
  preferenceBytes: number;
  nodeCount: number;
  variantCount: number;
  elementCount: number;
}

// A member carries its trailing comma. Each nonempty container removes exactly
// one comma. Fixed nonempty ancestors (state, wrapper, variant) cost one byte:
// two braces minus that final comma. Empty nodes/templates still cost two braces.
function* memberWork(key: string, valueBytes: number): Work<number> {
  return (yield* plainJsonBytesWork(key)) + 1 + valueBytes + 1;
}
const fields = (objectBytes: number) => objectBytes - 2 + Number(objectBytes > 2);
const preferenceFields = Object.entries(APP_STATE_FIELD_CLASSIFICATION).filter(([, owner]) => owner === 'preference').map(([key]) => key);

function* contributionWork(slice: NormalizedProjectSlice): Work<{
  document: number; wrapper: number; preference: number; elements: number; nodes: number; variants: number;
}> {
  let document = 0; let wrapper = 0; let preference = 0; let elements = 0;
  for (const record of slice.projectHeaders?.values() ?? []) {
    yield* effect(1, () => {
      document += fields(record.encodedSize.documentBytes);
      wrapper += fields(record.encodedSize.valueBytes);
    });
  }
  for (const record of slice.projectNodes?.values() ?? []) document += yield* memberWork(record.key[3], record.encodedSize.valueBytes);
  for (const record of slice.projectVariants?.values() ?? []) {
    document += yield* memberWork(record.key[3], record.encodedSize.valueBytes + (yield* memberWork('templates', 2)) - Number(record.templateOrder.length > 0));
  }
  for (const record of slice.projectTemplates?.values() ?? []) {
    document += yield* memberWork(record.key[4], record.encodedSize.valueBytes);
    elements += record.value.elements.length;
  }
  for (const record of slice.projectSources?.values() ?? []) document += yield* memberWork('generator', record.encodedSize.valueBytes);
  for (const record of slice.projectExtensions?.values() ?? []) {
    yield* effect(1, () => {
      if (record.key[3] === 'wrapper' || record.key[3] === 'cloud') wrapper += fields(record.encodedSize.valueBytes);
      else if (record.key[3] !== 'folds') document += fields(record.encodedSize.valueBytes);
    });
    // Fold exceptions are externally accounted by the preferences overlay counter,
    // not by their positional private envelope or runtime history provenance.
  }
  for (const record of slice.projectPreferences?.values() ?? []) {
    for (const key of preferenceFields) if (yield* effect(1, () => Object.hasOwn(record.value, key))) {
      const value = Reflect.get(record.value, key);
      // TextEncoder.encode(JSON.stringify(undefined/function/symbol)) historically contributes zero.
      const valueBytes = value === undefined || typeof value === 'function' || typeof value === 'symbol'
        ? 0 : yield* plainJsonBytesWork(value);
      preference += yield* memberWork(key, valueBytes);
    }
    for (const [, size] of yield* enumerableEntriesWork(record.encodedSize.templateOverlayBytes)) {
      yield* effect(1, () => { preference += size; });
    }
  }
  return { document, wrapper, preference, elements, nodes: slice.projectNodes?.size ?? 0, variants: slice.projectVariants?.size ?? 0 };
}

/** Bulk initialization from validated codec records; no project reconstruction. */
export function createSizeLedger(project: NormalizedProject): SizeLedger {
  return runSync(createSizeLedgerWork(project));
}

export function* createSizeLedgerWork(project: NormalizedProject): Work<SizeLedger> {
  const documentBytes = 1 + (yield* memberWork('nodes', 2)) + (yield* memberWork('variants', 2));
  return yield* applySizeChangesWork({ stateBytes: documentBytes, projectBytes: 1 + (yield* memberWork('initialState', documentBytes)),
    documentBytes, preferenceBytes: 0, nodeCount: 0, variantCount: 0, elementCount: 0 }, {}, project);
}

/** Pure selected-record arithmetic. No global record/index copy or payload walk.
 * When membership changes, slices must include the affected variant metadata.
 * Task 7 applies document/preference deltas against current counters atomically.
 */
export function applySizeChanges(ledger: SizeLedger, before: NormalizedProjectSlice, after: NormalizedProjectSlice): SizeLedger {
  return runSync(applySizeChangesWork(ledger, before, after));
}

export function* applySizeChangesWork(ledger: SizeLedger, before: NormalizedProjectSlice, after: NormalizedProjectSlice): Work<SizeLedger> {
  const old = yield* contributionWork(before); const next = yield* contributionWork(after);
  const nodeCount = ledger.nodeCount + next.nodes - old.nodes;
  const variantCount = ledger.variantCount + next.variants - old.variants;
  const documentDelta = next.document - old.document + Number(ledger.nodeCount > 0) - Number(nodeCount > 0)
    + Number(ledger.variantCount > 0) - Number(variantCount > 0);
  const preferenceDelta = next.preference - old.preference;
  return { nodeCount, variantCount, elementCount: ledger.elementCount + next.elements - old.elements,
    documentBytes: ledger.documentBytes + documentDelta, preferenceBytes: ledger.preferenceBytes + preferenceDelta,
    stateBytes: ledger.stateBytes + documentDelta + preferenceDelta,
    projectBytes: ledger.projectBytes + documentDelta + preferenceDelta + next.wrapper - old.wrapper };
}

import { describe, expect, it } from 'vitest';
import type { DocumentChange, DocumentState, RecordAddress } from '../../../services/document/contracts';
import { applyDocumentChanges as apply } from '../../../services/document/applyChanges';
import { createEditOperations } from '../../../services/document/editOperations';
import { buildReferenceIndex, updateReferenceIndex, affectedReferences } from '../../../services/document/references';
import { partitionState } from '../../../services/document/partition';
import { makeIncrementalProject } from '../../helpers/incrementalFixtures';

const n = (nodeId: string): RecordAddress => ({ kind: 'node', nodeId });
const t = (templateId: string, variantId = 'default'): RecordAddress => ({ kind: 'template', templateId, variantId });
function fixture(): DocumentState {
  const document = partitionState(makeIncrementalProject(2).initialState).document;
  document.nodes.root.children = ['child', 'ref'];
  document.nodes.child = { ...document.nodes.root, id: 'child', parentId: 'root', children: [] };
  document.nodes.ref = { ...document.nodes.child, id: 'ref', referenceId: 'child' };
  document.variants.default.templates['page-0'].elements = [
    { id: 'link', type: 'rect', linkTarget: 'specific_node', linkValue: 'child' },
    { id: 'grid', type: 'grid', gridConfig: { sourceType: 'specific', sourceId: 'child' } },
    { id: 'filter', type: 'rect', linkTarget: 'child_referrer', linkReferrerParentType: 'page-1' },
    { id: 'url', type: 'rect', linkTarget: 'url', linkValue: 'not-a-node' },
  ] as any;
  return document;
}
const sorted = (addresses: readonly RecordAddress[]) => addresses.map(a => JSON.stringify(a.kind === 'template' ? t(a.templateId, a.variantId) : a)).sort();

describe('reference index', () => {
  it('indexes root, parent, children, referenceId, element links and specific grid sources', () => {
    const index = buildReferenceIndex(fixture());
    expect(sorted(affectedReferences(index, [n('child')]))).toEqual(sorted([n('root'), n('ref'), t('page-0')]));
    expect(sorted(affectedReferences(index, [n('root')]))).toEqual(sorted([{ kind: 'root' }, n('child'), n('ref')]));
    expect(affectedReferences(index, [n('not-a-node')])).toEqual([]);
  });

  it('tracks node types across variants, unresolved fallbacks and referrer parent type filters', () => {
    const document = fixture();
    document.nodes.child.type = 'missing-template';
    const index = buildReferenceIndex(document);
    expect(sorted(affectedReferences(index, [t('page-0', 'another-variant')]))).toEqual(sorted([n('root'), n('ref')]));
    expect(affectedReferences(index, [t('missing-template')])).toEqual([n('child')]);
    expect(affectedReferences(index, [t('page-1')])).toEqual([t('page-0')]);
    expect(affectedReferences(index, [n('page-0')])).toEqual([]);
  });

  it('updates old/new changed records only and deduplicates owners without copying the complete index', () => {
    const document = fixture();
    const index = buildReferenceIndex(document);
    const template = document.variants.default.templates['page-0'];
    const changed = { ...template, elements: template.elements.map(el => el.id === 'link' ? { ...el, linkValue: 'new' } : el.id === 'grid' ? { ...el, gridConfig: { ...el.gridConfig!, sourceId: 'new' } } : el) };
    const edit = apply(document, [{ type: 'put-template', variantId: 'default', template: changed }]);
    const untouched = document.variants.default.templates['page-1'];
    Object.defineProperty(untouched, 'elements', { get() { throw new Error('unrelated record visited'); } });
    Object.defineProperty(index, Symbol.iterator, { value() { throw new Error('complete index traversed'); } });
    const untouchedOwners = index.get('["node","root"]')!;
    const changedOwners = index.get('["node","child"]')!;
    const untouchedSnapshot = sorted([...untouchedOwners]);
    const changedSnapshot = sorted([...changedOwners]);
    const oldDependents = affectedReferences(index, [n('child')]);
    const next = updateReferenceIndex(index, edit);
    expect(next).toBe(index);
    expect(affectedReferences(next, [n('new'), n('new')])).toEqual([t('page-0')]);
    expect(affectedReferences(next, [n('child')])).not.toContainEqual(t('page-0'));
    expect(next.get('["node","child"]')).not.toBe(changedOwners);
    expect(sorted([...changedOwners])).toEqual(changedSnapshot);
    expect(sorted(oldDependents)).toEqual(sorted([n('root'), n('ref'), t('page-0')]));
    expect(next.get('["node","root"]')).toBe(untouchedOwners);
    expect(sorted([...untouchedOwners])).toEqual(untouchedSnapshot);
    expect(updateReferenceIndex(next, { before: edit.after, after: edit.after, changes: [], affected: [] })).toBe(next);
  });

  it('removes deleted variant template entries and exposes type dependents for variant deletion', () => {
    const document = fixture();
    const index = buildReferenceIndex(document);
    expect(affectedReferences(index, [{ kind: 'variant', variantId: 'default' }])).toEqual(expect.arrayContaining([t('page-0'), t('page-1'), n('root')]));
    const edit = apply(document, [
      { type: 'put-variant', variant: { id: 'empty', name: 'Empty' } },
      { type: 'delete-variant', variantId: 'default' },
    ]);
    const next = updateReferenceIndex(index, edit);
    expect(affectedReferences(next, [n('child')])).not.toContainEqual(t('page-0'));
    expect(affectedReferences(next, [{ kind: 'variant', variantId: 'default' }])).toEqual([]);
    expect(affectedReferences(next, [t('page-0')])).toContainEqual(n('root'));
  });

  it('agrees with a fresh build after root, node, template, and variant changes and ID reuse', () => {
    let document = fixture();
    let index = buildReferenceIndex(document);
    const batches: DocumentChange[][] = [
      [{ type: 'put-node', node: { ...document.nodes.ref, referenceId: 'missing' } }],
      [{ type: 'set-root', rootId: 'child' }, { type: 'delete-node', nodeId: 'root' }],
      [{ type: 'delete-template', variantId: 'default', templateId: 'page-0' }],
      [{ type: 'put-node', node: { ...document.nodes.root, children: [], type: 'other' } }],
      [{ type: 'put-template', variantId: 'default', template: { ...document.variants.default.templates['page-0'], elements: [] } }],
    ];
    const targets = [n('root'), n('child'), n('missing'), t('page-0'), t('page-1'), t('other'), { kind: 'variant', variantId: 'default' } as RecordAddress];
    for (const changes of batches) {
      const edit = apply(document, changes);
      index = updateReferenceIndex(index, edit);
      document = edit.after;
      const rebuilt = buildReferenceIndex(document);
      for (const target of targets) expect(sorted(affectedReferences(index, [target]))).toEqual(sorted(affectedReferences(rebuilt, [target])));
    }
  });

  it('keeps one live index equivalent to rebuilds through forward, reverse and forward deletion/ID reuse', () => {
    const original = fixture();
    let document = original;
    const index = buildReferenceIndex(document);
    const batches: { forward: DocumentChange[]; reverse: DocumentChange[] }[] = [
      {
        forward: [
          { type: 'set-root', rootId: 'child' },
          { type: 'delete-node', nodeId: 'root' },
          { type: 'delete-template', variantId: 'default', templateId: 'page-0' },
        ],
        reverse: [
          { type: 'put-node', node: original.nodes.root },
          { type: 'set-root', rootId: 'root' },
          { type: 'put-template', variantId: 'default', template: original.variants.default.templates['page-0'] },
        ],
      },
      {
        forward: [
          { type: 'put-node', node: { ...original.nodes.root, parentId: 'child', children: [], type: 'other', referenceId: 'reused-target' } },
          { type: 'put-template', variantId: 'default', template: {
            ...original.variants.default.templates['page-0'],
            elements: [{ ...original.variants.default.templates['page-0'].elements[0], linkValue: 'reused-target' }],
          } },
        ],
        reverse: [
          { type: 'delete-node', nodeId: 'root' },
          { type: 'delete-template', variantId: 'default', templateId: 'page-0' },
        ],
      },
    ];
    const normalized = (value: ReturnType<typeof buildReferenceIndex>) => [...value]
      .map(([key, owners]) => [key, sorted([...owners])] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const targets: RecordAddress[] = [n('root'), n('child'), n('reused-target'), t('page-0'), t('page-1'), t('other'),
      { kind: 'variant', variantId: 'default' }];
    const snapshots: { owners: ReadonlySet<RecordAddress>; contents: string[] }[] = [];
    const advance = (changes: DocumentChange[]) => {
      for (const owners of index.values()) snapshots.push({ owners, contents: sorted([...owners]) });
      const edit = apply(document, changes);
      expect(edit.affected.length).toBeGreaterThan(0);
      expect(updateReferenceIndex(index, edit)).toBe(index);
      document = edit.after;
      const rebuilt = buildReferenceIndex(document);
      expect(normalized(index)).toEqual(normalized(rebuilt));
      for (const target of targets) expect(sorted(affectedReferences(index, [target])))
        .toEqual(sorted(affectedReferences(rebuilt, [target])));
      for (const { owners, contents } of snapshots) expect(sorted([...owners])).toEqual(contents);
    };
    for (const batch of batches) advance(batch.forward);
    const forward = document;
    expect(sorted(affectedReferences(index, [n('reused-target')]))).toEqual(sorted([n('root'), t('page-0')]));
    for (const batch of [...batches].reverse()) advance(batch.reverse);
    expect(document).toEqual(original);
    expect(affectedReferences(index, [n('reused-target')])).toEqual([]);
    for (const batch of batches) advance(batch.forward);
    expect(document).toEqual(forward);
  });

  it('constructs cascade deletion and reference repairs without scanning unrelated templates', () => {
    const document = fixture();
    const index = buildReferenceIndex(document);
    Object.defineProperty(document.variants.default.templates['page-1'], 'elements', { get() { throw new Error('unrelated template scanned'); } });
    const ops = createEditOperations(document, { activeVariantId: 'default' }, index);
    const edit = apply(document, ops.deleteNodes(['child']));
    expect(edit.after.nodes.child).toBeUndefined();
    expect(edit.after.nodes.ref).toBeUndefined();
    expect(edit.after.nodes.root.children).toEqual([]);
    const [link, grid] = edit.after.variants.default.templates['page-0'].elements;
    expect(link).toMatchObject({ linkTarget: 'none', linkValue: undefined });
    expect(grid.gridConfig).toMatchObject({ sourceType: 'current', sourceId: undefined });
    expect(edit.affected).toEqual(expect.arrayContaining([n('child'), n('ref'), n('root'), t('page-0')]));
    expect(edit.affected).not.toContainEqual(t('page-1'));
    expect(document.nodes.root.children).toEqual(['child', 'ref']);
    expect(() => ops.deleteNodes(['root'])).toThrow(/root/i);
  });
});

import type { AppNode, PageTemplate, Variant } from '../../types';
import type { DocumentChange, DocumentEdit, DocumentState, RecordAddress } from './contracts';

const own = <T>(map: Record<string, T>, id: string): T | undefined => Object.hasOwn(map, id) ? map[id] : undefined;
const set = <T>(map: Record<string, T>, id: string, value: T | undefined) => {
  if (value === undefined) delete map[id];
  else Object.defineProperty(map, id, { value, enumerable: true, configurable: true, writable: true });
};
const metadata = ({ templates: _templates, ...fields }: Variant): Omit<Variant, 'templates'> => fields;
const sameMetadata = (a: Omit<Variant, 'templates'> | undefined, b: Omit<Variant, 'templates'> | undefined) =>
  a === b || (!!a && !!b && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && Object.is(a[key as keyof typeof a], b[key as keyof typeof b])));

function checkIdentity(change: DocumentChange): void {
  const data = (record: unknown, field: string): unknown => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid change identity: expected a record.');
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Invalid change identity: expected own enumerable data.');
    return descriptor.value;
  };
  const id = (value: unknown) => {
    // Empty strings are historically admitted IDs; do not tighten that boundary.
    if (typeof value !== 'string') throw new Error('Invalid change identity: expected a string.');
  };
  if (!change || typeof change !== 'object') throw new Error('Invalid document change.');
  switch (data(change, 'type')) {
    case 'put-node': id(data(data(change, 'node'), 'id')); break;
    case 'delete-node': id(data(change, 'nodeId')); break;
    case 'put-template': id(data(change, 'variantId')); id(data(data(change, 'template'), 'id')); break;
    case 'delete-template': id(data(change, 'variantId')); id(data(change, 'templateId')); break;
    case 'put-variant':
      id(data(data(change, 'variant'), 'id'));
      if (Object.hasOwn(data(change, 'variant') as object, 'templates')) throw new Error('put-variant changes metadata only; use explicit template changes.');
      break;
    case 'delete-variant': id(data(change, 'variantId')); break;
    case 'set-root': id(data(change, 'rootId')); break;
    case 'set-generator': break;
    default: throw new Error('Unknown document change.');
  }
}

/**
 * Trusted immutable editing primitive, not full ingress/size validation. Stage the
 * complete logical batch first, then check final membership. Payloads are shared;
 * callers must not mutate them after submission. No whole-document diff or walk.
 */
export function applyDocumentChanges(document: DocumentState, changes: readonly DocumentChange[]): DocumentEdit {
  changes.forEach(checkIdentity);
  const nodes = new Map<string, AppNode | undefined>();
  const variants = new Map<string, Omit<Variant, 'templates'> | undefined>();
  const templates = new Map<string, Map<string, PageTemplate | undefined>>();
  const touched = new Map<string, RecordAddress>();
  let rootId = document.rootId;
  let generator = document.generator;
  let generatorTouched = false;
  const touch = (address: RecordAddress) => touched.set(JSON.stringify(address), address);
  const putTemplate = (variantId: string, templateId: string, template: PageTemplate | undefined) => {
    if (!templates.has(variantId)) templates.set(variantId, new Map());
    templates.get(variantId)!.set(templateId, template);
    touch({ kind: 'template', variantId, templateId });
  };
  for (const change of changes) {
    switch (change.type) {
      case 'put-node': nodes.set(change.node.id, change.node); touch({ kind: 'node', nodeId: change.node.id }); break;
      case 'delete-node': nodes.set(change.nodeId, undefined); touch({ kind: 'node', nodeId: change.nodeId }); break;
      case 'put-variant': variants.set(change.variant.id, change.variant); touch({ kind: 'variant', variantId: change.variant.id }); break;
      case 'delete-variant': {
        const id = change.variantId;
        variants.set(id, undefined);
        touch({ kind: 'variant', variantId: id });
        // Bulk structural expansion: one enumeration of this variant's template
        // keys, including new records introduced earlier in this batch.
        const ids = new Set([...Object.keys(own(document.variants, id)?.templates ?? {}), ...templates.get(id)?.keys() ?? []]);
        for (const templateId of ids) putTemplate(id, templateId, undefined);
        break;
      }
      case 'put-template': putTemplate(change.variantId, change.template.id, change.template); break;
      case 'delete-template': putTemplate(change.variantId, change.templateId, undefined); break;
      case 'set-root': rootId = change.rootId; touch({ kind: 'root' }); break;
      case 'set-generator': generator = change.generator; generatorTouched = true; touch({ kind: 'generator' }); break;
    }
  }

  const affected: RecordAddress[] = [];
  const effects: DocumentChange[] = [];
  for (const address of touched.values()) {
    let effect: DocumentChange | undefined;
    switch (address.kind) {
      case 'node': {
        const value = nodes.get(address.nodeId);
        if (value !== own(document.nodes, address.nodeId)) effect = value
          ? { type: 'put-node', node: value } : { type: 'delete-node', nodeId: address.nodeId };
        break;
      }
      case 'variant': {
        const old = own(document.variants, address.variantId);
        const value = variants.get(address.variantId);
        if (!sameMetadata(old && metadata(old), value)) effect = value
          ? { type: 'put-variant', variant: value } : { type: 'delete-variant', variantId: address.variantId };
        break;
      }
      case 'template': {
        const value = templates.get(address.variantId)!.get(address.templateId);
        const old = own(document.variants, address.variantId);
        if (value !== (old && own(old.templates, address.templateId))) effect = value
          ? { type: 'put-template', variantId: address.variantId, template: value }
          : { type: 'delete-template', variantId: address.variantId, templateId: address.templateId };
        break;
      }
      case 'root': if (rootId !== document.rootId) effect = { type: 'set-root', rootId }; break;
      case 'generator':
        if (generator !== document.generator || (generator === undefined && Object.hasOwn(document, 'generator')))
          effect = { type: 'set-generator', generator };
        break;
    }
    if (effect) { affected.push(address); effects.push(effect); }
  }

  const nextRoot = nodes.has(rootId) ? nodes.get(rootId) : own(document.nodes, rootId);
  if (!nextRoot) throw new Error('rootId must reference an existing node.');
  for (const [id, updates] of templates) {
    const exists = variants.has(id) ? variants.get(id) !== undefined : Object.hasOwn(document.variants, id);
    if (!exists && [...updates.values()].some(value => value !== undefined)) throw new Error(`Template change requires variant ${id}.`);
  }
  if (!effects.length) return { before: document, after: document, changes: [], affected: [] };

  const after = { ...document };
  const nodeEffects = effects.filter(effect => effect.type === 'put-node' || effect.type === 'delete-node');
  if (nodeEffects.length) {
    after.nodes = { ...document.nodes };
    for (const effect of nodeEffects) set(after.nodes, effect.type === 'put-node' ? effect.node.id : effect.nodeId, effect.type === 'put-node' ? effect.node : undefined);
  }
  const changedVariants = new Set(affected.flatMap(a => a.kind === 'variant' || a.kind === 'template' ? [a.variantId] : []));
  if (changedVariants.size) {
    after.variants = { ...document.variants };
    for (const id of changedVariants) {
      const old = own(document.variants, id);
      const fields = variants.has(id) ? variants.get(id) : old && metadata(old);
      if (!fields) { set(after.variants, id, undefined); continue; }
      const templateEffects = effects.filter(e => (e.type === 'put-template' || e.type === 'delete-template') && e.variantId === id);
      let nextTemplates = old?.templates ?? {};
      if (templateEffects.length) {
        nextTemplates = { ...nextTemplates };
        for (const effect of templateEffects) {
          if (effect.type === 'put-template') set(nextTemplates, effect.template.id, effect.template);
          else if (effect.type === 'delete-template') set(nextTemplates, effect.templateId, undefined);
        }
      }
      set(after.variants, id, { ...fields, templates: nextTemplates });
    }
    if (!Object.keys(after.variants).length) throw new Error('Document must retain at least one variant.');
  }
  after.rootId = rootId;
  if (generatorTouched) {
    if (generator === undefined) delete after.generator;
    else after.generator = generator;
  }
  // Canonical replay must create variant metadata before child puts and remove
  // children before variant deletion. Affected order stays first-touch order.
  const ordered = [
    ...effects.filter(e => e.type === 'put-variant'),
    ...effects.filter(e => e.type !== 'put-variant' && e.type !== 'delete-variant'),
    ...effects.filter(e => e.type === 'delete-variant'),
  ];
  return { before: document, after, changes: ordered, affected };
}

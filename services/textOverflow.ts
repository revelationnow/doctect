import type { PageTemplate, TemplateElement, TextOverflow } from '../types';
import { effect, primitive, runSync, type Work } from '../shared/cooperativeWork.js';
import { copyEnumerableWork, enumerableEntriesWork } from '../shared/jsonWork.js';

export const TEXT_OVERFLOW_VALUES = ['clip', 'ellipsis', 'shrink', 'visible'] as const;
const TEXT_DEFAULTS = { textOverflow: 'clip', textWrap: true } as const;
const GRID_DEFAULTS = { textOverflow: 'clip', textWrap: false } as const;

const isTextOverflow = (value: unknown): value is TextOverflow =>
  typeof value === 'string' && (TEXT_OVERFLOW_VALUES as readonly string[]).includes(value);

export function resolveTextOverflowSettings(
  element: Pick<TemplateElement, 'type' | 'textOverflow' | 'textWrap'>,
) {
  if (element.type !== 'text' && element.type !== 'grid') return null;
  const defaults = element.type === 'grid' ? GRID_DEFAULTS : TEXT_DEFAULTS;
  return {
    textOverflow: isTextOverflow(element.textOverflow) ? element.textOverflow : defaults.textOverflow,
    textWrap: typeof element.textWrap === 'boolean' ? element.textWrap : defaults.textWrap,
  };
}

export function normalizeTextOverflowElement<T extends Record<string, any>>(element: T): T {
  return runSync(normalizeTextOverflowElementWork(element));
}

export function* normalizeTextOverflowElementWork<T extends Record<string, any>>(element: T): Work<T> {
  const settings = yield* effect(1, () => resolveTextOverflowSettings(
    element as unknown as Pick<TemplateElement, 'type' | 'textOverflow' | 'textWrap'>,
  ));
  if (!settings) return element;
  const result = yield* copyEnumerableWork(element);
  return yield* effect(1, () => Object.assign(result, settings));
}

export function normalizeTextOverflowTemplate<T extends PageTemplate>(template: T): T {
  return runSync(normalizeTextOverflowTemplateWork(template));
}

export function* normalizeTextOverflowTemplateWork<T extends PageTemplate>(template: T): Work<T> {
  const result = yield* copyEnumerableWork(template);
  const source = template.elements;
  if (!Array.isArray(source)) throw new TypeError('Expected template elements array');
  const length = source.length;
  const elements: TemplateElement[] = new Array(length);
  for (let index = 0; index < length; index++) {
    const present = yield* effect(1, () => index in source);
    if (present) elements[index] = yield* normalizeTextOverflowElementWork(source[index]);
  }
  return yield* effect(1, () => { result.elements = elements; return result; });
}

export function normalizeTextOverflowTemplates<T extends Record<string, PageTemplate>>(templates: T): T {
  return runSync(normalizeTextOverflowTemplatesWork(templates));
}

export function* normalizeTextOverflowTemplatesWork<T extends Record<string, PageTemplate>>(templates: T): Work<T> {
  const result = {} as T;
  const entries = yield* enumerableEntriesWork(templates);
  for (const [id, template] of entries) {
    const value = yield* normalizeTextOverflowTemplateWork(template);
    yield* effect(1, () => Object.defineProperty(result, id, { value, enumerable: true, writable: true, configurable: true }));
  }
  return result;
}

export function normalizeTextOverflow<T extends Record<string, any>>(state: T): T {
  return runSync(normalizeTextOverflowWork(state));
}

export function* normalizeTextOverflowWork<T extends Record<string, any>>(state: T): Work<T> {
  return yield* normalizeOwnedTextOverflowWork(yield* primitive('clone', () => structuredClone(state)));
}

export function* normalizeOwnedTextOverflowWork<T extends Record<string, any>>(state: T): Work<T> {
  const normalized: Record<string, any> = state;
  if (normalized.variants && typeof normalized.variants === 'object') {
    const entries = yield* enumerableEntriesWork<any>(normalized.variants);
    for (const [, variant] of entries) {
      yield* effect(1, () => {});
      if (variant?.templates && typeof variant.templates === 'object') {
        variant.templates = yield* normalizeTextOverflowTemplatesWork(variant.templates);
      }
    }
  }
  if (normalized.templates && typeof normalized.templates === 'object') {
    normalized.templates = yield* normalizeTextOverflowTemplatesWork(normalized.templates);
  }

  return normalized as T;
}

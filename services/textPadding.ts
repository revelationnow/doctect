import type { PageTemplate, TemplateElement, TextPadding } from '../types';
import { effect, primitive, runSync, type Work } from '../shared/cooperativeWork.js';
import { copyEnumerableWork, enumerableEntriesWork } from '../shared/jsonWork.js';

export const TEXT_PADDING_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type TextPaddingSide = typeof TEXT_PADDING_SIDES[number];

export const ZERO_TEXT_PADDING: Readonly<TextPadding> = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export interface TextContentBox {
  padding: TextPadding;
  x: number;
  y: number;
  width: number;
  height: number;
}

const normalizeSide = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
);

export function normalizeTextPaddingValue(value: unknown): TextPadding {
  const candidate = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    top: normalizeSide(candidate.top),
    right: normalizeSide(candidate.right),
    bottom: normalizeSide(candidate.bottom),
    left: normalizeSide(candidate.left),
  };
}

export function resolveTextPadding(
  element: Pick<TemplateElement, 'textPadding'>,
): TextPadding {
  return normalizeTextPaddingValue(element.textPadding);
}

export function resolveTextContentBox(
  element: Pick<TemplateElement, 'w' | 'h' | 'textPadding'>,
): TextContentBox {
  const padding = resolveTextPadding(element);
  return {
    padding,
    x: padding.left,
    y: padding.top,
    width: Math.max(0, element.w - padding.left - padding.right),
    height: Math.max(0, element.h - padding.top - padding.bottom),
  };
}

export function normalizeTextPaddingElement<T extends Record<string, any>>(element: T): T {
  return runSync(normalizeTextPaddingElementWork(element));
}

export function* normalizeTextPaddingElementWork<T extends Record<string, any>>(element: T): Work<T> {
  if (!(yield* effect(1, () => element.type === 'text'))) return element;
  const result = yield* copyEnumerableWork(element);
  return yield* effect(1, () => Object.assign(result, { textPadding: normalizeTextPaddingValue(element.textPadding) }));
}

export function normalizeTextPaddingTemplate<T extends PageTemplate>(template: T): T {
  return runSync(normalizeTextPaddingTemplateWork(template));
}

export function* normalizeTextPaddingTemplateWork<T extends PageTemplate>(template: T): Work<T> {
  const result = yield* copyEnumerableWork(template);
  const source = template.elements;
  if (!Array.isArray(source)) throw new TypeError('Expected template elements array');
  const length = source.length;
  const elements: TemplateElement[] = new Array(length);
  for (let index = 0; index < length; index++) {
    const present = yield* effect(1, () => index in source);
    if (present) elements[index] = yield* normalizeTextPaddingElementWork(source[index]);
  }
  return yield* effect(1, () => { result.elements = elements; return result; });
}

export function normalizeTextPaddingTemplates<T extends Record<string, PageTemplate>>(templates: T): T {
  return runSync(normalizeTextPaddingTemplatesWork(templates));
}

export function* normalizeTextPaddingTemplatesWork<T extends Record<string, PageTemplate>>(templates: T): Work<T> {
  const result = {} as T;
  const entries = yield* enumerableEntriesWork(templates);
  for (const [id, template] of entries) {
    const value = yield* normalizeTextPaddingTemplateWork(template);
    yield* effect(1, () => Object.defineProperty(result, id, { value, enumerable: true, writable: true, configurable: true }));
  }
  return result;
}

export function normalizeProjectTextPadding<T extends Record<string, any>>(state: T): T {
  return runSync(normalizeProjectTextPaddingWork(state));
}

export function* normalizeProjectTextPaddingWork<T extends Record<string, any>>(state: T): Work<T> {
  return yield* normalizeOwnedProjectTextPaddingWork(yield* primitive('clone', () => structuredClone(state)));
}

export function* normalizeOwnedProjectTextPaddingWork<T extends Record<string, any>>(state: T): Work<T> {
  const normalized: Record<string, any> = state;
  if (normalized.variants && typeof normalized.variants === 'object') {
    const entries = yield* enumerableEntriesWork<any>(normalized.variants);
    for (const [, variant] of entries) {
      yield* effect(1, () => {});
      if (variant?.templates && typeof variant.templates === 'object') {
        variant.templates = yield* normalizeTextPaddingTemplatesWork(variant.templates);
      }
    }
  }
  if (normalized.templates && typeof normalized.templates === 'object') {
    normalized.templates = yield* normalizeTextPaddingTemplatesWork(normalized.templates);
  }
  return normalized as T;
}

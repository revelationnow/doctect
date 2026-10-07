import type { Work, WorkRuntime } from './cooperativeWork.js';

export interface RetainedValue<T> {
  readonly value: T;
  measure(): Promise<void>;
  release(): void;
}
export function retainRawValue<T>(value: T, work: WorkRuntime): RetainedValue<T>;

export const JSON_FRAME_UNITS: 64;
export const JSON_MAX_NESTING: 512;
/** Fragments contain at most 64 UTF-16 code units and never split a surrogate pair. */
export type JsonEmit = (text: string) => Work<void>;
/** Borrowed UTF-8 packet, at most192 bytes; consume/copy before callback completion. */
export type JsonByteEmit = (bytes: Uint8Array) => Work<void>;
export function utf8JsonOutput(textEmit: JsonEmit, byteEmit: JsonByteEmit): JsonEmit;
export type Frame = (emit: JsonEmit) => Work<void>;
export function frameBytesWork(frame: Frame): Work<number>;
export function utf8LengthWork(text: string): Work<number>;
export function plainJsonBytesWork(value: unknown): Work<number>;
export interface CanonicalContext { nesting?: number; parent?: object }
export function canonicalBytesWork(value: unknown, context?: CanonicalContext): Work<number>;
export function canonicalInspectionWork(value: unknown, context?: CanonicalContext): Work<{ bytes: number; maximumDepth: number }>;
/** Required metadata keys only; payload consumers must stream instead. */
export function jsonTextWork(value: unknown): Work<string>;
/** Logical raw graph weight, not JSON bytes, heap size or an admission check. */
export function rawValueWeightWork(value: unknown): Work<{ bytes: number; unmeasuredValues: number }>;
export type JsonMode = 'plain' | 'compat';
export function jsonCloneWork<T>(value: T, mode: JsonMode): Work<T>;
/** Private mutable input only; discard it after failure or cancellation. */
export function normalizeOwnedJsonWork<T>(value: T): Work<T>;
export function copyEnumerableWork<T extends object>(value: T): Work<T>;
export function enumerableEntriesWork<T>(value: Record<string, T>): Work<[string, T][]>;
export function equalFrameWork(left: Frame, right: Frame): Work<boolean>;
export interface CanonicalComparison { equal: boolean; bytes: number }
/** Full equal-value byte count; unequal results report only a compared prefix. */
export function compareCanonicalWork(expected: unknown, actual: unknown, emitExpected?: JsonEmit): Work<CanonicalComparison>;
export function emitComparedCanonicalWork(expected: unknown, actual: unknown, emitExpected: JsonEmit): Work<boolean>;
export function textWork(text: string, emit: JsonEmit): Work<void>;
export function quoteWork(text: string, emit: JsonEmit): Work<void>;
export function compareStringsWork(left: string, right: string): Work<number>;
export function stableSortWork<T>(values: readonly T[], compare: (left: T, right: T) => Work<number>): Work<T[]>;
export function canonicalWork(value: unknown, emit: JsonEmit, nesting?: number): Work<void>;
/** Plain data only: preserves JSON order/conversions without invoking user toJSON. */
export function orderedJsonWork(value: unknown, emit: JsonEmit): Work<void>;
/** Synchronous canonical text; never invoke as one cooperative work operation. */
export function canonicalText(value: unknown): string;

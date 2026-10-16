import type { ActiveRead, PreparationInfo } from './normalized/repository';
import type { AuthorityStamp, ProjectScope, BulkDocumentAck, BulkDocumentBatch, NormalizationAttempt, NormalizationSource } from './normalized/schema';
import type { WorkspaceCatalog } from './workspaceCatalog';

export type StartupOperation = 'prepare' | 'reserve' | 'stage' | 'verify' | 'activate' | 'reopen' | 'active' | 'trusted-active' | 'retained' | 'replace' | 'editor';
export interface StartupEditorAdmission {
  active: ActiveRead;
  workspace: { type: 'workspace-bootstrapped'; admissionId: number; catalog: WorkspaceCatalog;
    projectAuthorities: readonly { readonly scope: ProjectScope; readonly authority: AuthorityStamp }[] };
  projects: { type: 'bootstrapped'; admissionId: number; scope: ProjectScope; authority: AuthorityStamp }[];
}
export type WorkspaceStartupRequest = { type: 'normalization-open' }
  | { type: 'normalization-step'; sessionId: number; operation: StartupOperation; allowFresh?: boolean }
  | { type: 'normalization-continue'; sessionId: number; operationId: number }
  | { type: 'normalization-replace'; sessionId: number; admissionId: number; batch: BulkDocumentBatch }
  | { type: 'normalization-close'; sessionId: number };
export interface StartupContext { startup: true; requestType: WorkspaceStartupRequest['type']; sessionId?: number; operationId?: number; operation?: StartupOperation }
export type StartupValue = PreparationInfo | NormalizationAttempt | ActiveRead | NormalizationSource | BulkDocumentAck | StartupEditorAdmission | undefined;
export type WorkspaceStartupResponse = { type: 'normalization-opened' | 'normalization-closed'; sessionId: number }
  | { type: 'normalization-progress'; sessionId: number; operationId: number; operation: StartupOperation; phase: string; completed: number }
  | { type: 'normalization-result'; sessionId: number; operationId: number; operation: StartupOperation; value: StartupValue }
  | { type: 'normalization-failed'; sessionId: number; operationId: number; name: string; message: string; reason?: string };
const operations: readonly string[] = ['prepare', 'reserve', 'stage', 'verify', 'activate', 'reopen', 'active', 'trusted-active', 'retained', 'replace', 'editor'];
function check(value: unknown): asserts value { if (!value) throw Error('Invalid workspace startup frame'); }
function counter(value: unknown): asserts value is number { check(Number.isSafeInteger(value) && (value as number) > 0); }
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  check(Reflect.ownKeys(value).length <= required.length + optional.length);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === 'string' && (required.includes(key) || optional.includes(key)));
    const d = Object.getOwnPropertyDescriptor(value, key)!; check(d.enumerable && Object.hasOwn(d, 'value'));
  }
  for (const key of required) check(Object.hasOwn(value, key)); return value as Record<string, unknown>;
}
export function isStartupType(value: unknown): value is WorkspaceStartupRequest['type'] {
  return ['normalization-open', 'normalization-step', 'normalization-continue', 'normalization-close', 'normalization-replace'].includes(value as string);
}
export function describeStartupRequest(value: unknown): StartupContext {
  const r = fields(value, ['type'], ['sessionId', 'operationId', 'operation', 'allowFresh', 'admissionId', 'batch']); check(isStartupType(r.type));
  if (r.type === 'normalization-open') { fields(r, ['type']); return { startup: true, requestType: r.type }; }
  counter(r.sessionId);
  if (r.type === 'normalization-replace') {
    fields(r, ['type', 'sessionId', 'admissionId', 'batch']); counter(r.admissionId);
    return { startup: true, requestType: r.type, sessionId: r.sessionId, operation: 'replace' };
  }
  if (r.type === 'normalization-close') { fields(r, ['type', 'sessionId']); return { startup: true, requestType: r.type, sessionId: r.sessionId }; }
  if (r.type === 'normalization-continue') {
    fields(r, ['type', 'sessionId', 'operationId']); counter(r.operationId);
    return { startup: true, requestType: r.type, sessionId: r.sessionId, operationId: r.operationId };
  }
  fields(r, ['type', 'sessionId', 'operation'], ['allowFresh']); check(operations.includes(r.operation as string) && r.operation !== 'replace');
  check(r.allowFresh === undefined || r.operation === 'prepare' && typeof r.allowFresh === 'boolean');
  return { startup: true, requestType: r.type, sessionId: r.sessionId, operation: r.operation as StartupOperation };
}
export function validateStartupReply(context: unknown, value: unknown, expected: StartupContext, requestId: number): void {
  const c = fields(context, Object.keys(expected));
  for (const key of Object.keys(expected)) check(c[key] === Reflect.get(expected, key));
  const r = fields(value, ['type', 'sessionId'], ['operationId', 'operation', 'phase', 'completed', 'value', 'name', 'message', 'reason']);
  counter(r.sessionId); check(r.sessionId === (expected.sessionId ?? requestId));
  if (expected.requestType === 'normalization-open' || expected.requestType === 'normalization-close') {
    fields(r, ['type', 'sessionId']); check(r.type === (expected.requestType === 'normalization-open' ? 'normalization-opened' : 'normalization-closed')); return;
  }
  counter(r.operationId); check(r.operationId === (expected.operationId ?? requestId));
  if (r.type === 'normalization-failed') {
    fields(r, ['type', 'sessionId', 'operationId', 'name', 'message'], ['reason']);
    check(typeof r.name === 'string' && r.name.length <= 128 && typeof r.message === 'string' && r.message.length <= 4096);
    check(r.reason === undefined || typeof r.reason === 'string' && r.reason.length <= 256); return;
  }
  check(operations.includes(r.operation as string) && (expected.operation === undefined || r.operation === expected.operation));
  if (r.type === 'normalization-progress') {
    fields(r, ['type', 'sessionId', 'operationId', 'operation', 'phase', 'completed']);
    check(typeof r.phase === 'string' && r.phase.length <= 64 && Number.isSafeInteger(r.completed) && (r.completed as number) >= 0);
  } else {
    check(r.type === 'normalization-result'); fields(r, ['type', 'sessionId', 'operationId', 'operation', 'value']);
    // Explicit startup bulk boundary. Payload validation remains worker-owned.
    check(r.value === undefined || r.value !== null && typeof r.value === 'object' && !Array.isArray(r.value));
  }
}

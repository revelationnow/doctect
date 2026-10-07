export type Phase = 'discovery' | 'prerequisite' | 'prepare' | 'reserve' | 'stage'
  | 'verify' | 'activate' | 'reopen' | 'retained' | 'recovery' | 'legacy-fence';
export type StoreClass = 'none' | 'source' | 'backup' | 'target' | 'marker';
export type FrameKind = 'none' | 'source' | 'target' | 'proof' | 'stage' | 'marker' | 'legacy';
export type NativeKind = 'clone' | 'parse' | 'keys' | 'scalar' | 'sort' | 'idb-record'
  | 'record-compare' | 'release' | 'compat-json';
export type Metric = 'visits' | 'emittedBytes' | 'sortComparisons' | 'comparedCodeUnits'
  | 'yields' | 'checks' | 'observedAborts' | 'primitiveExceptions'
  | 'candidateRows' | 'candidateBytes' | 'sealRows' | 'sealBytes' | 'metadataRows' | 'metadataBytes' | 'unmeasuredValues'
  | 'pageTransactions' | 'sealTransactions' | 'eofChecks' | 'markerCasRows'
  | 'markerBytes' | 'markerWorkBytes' | 'writes' | 'stageTransactions' | 'stageRecords'
  | 'sourceDerivations' | 'targetDerivations' | 'projectReconstructions'
  | 'frameBytes' | 'hashBytes' | 'sourceHashBytes' | 'targetHashBytes'
  | 'proofHashBytes' | 'stageHashBytes' | 'markerHashBytes' | 'legacyHashBytes'
  | 'legacyCaptures' | 'legacyReads' | 'legacyReadBytes' | 'backupValidations'
  | 'retries' | 'ownedBytes' | 'ownedHighWater' | 'captureGraphs' | 'captureHighWater';
export type Counters = Readonly<Record<Metric, number>>;
export interface WorkEvent {
  phase: Phase; storeClass: StoreClass; frameKind: FrameKind;
  kind: 'work' | 'durable'; counters: Counters;
}
export interface Operation {
  visits: number; utf8Bytes: number; nativeKind?: NativeKind;
  metric?: Metric;
  run(runtime?: WorkRuntime): unknown;
}
export type Work<T> = Generator<Operation, T, unknown>;
export interface Ownership {
  grow(bytes: number): void;
  release(): void;
}
export interface WorkControl {
  assertCurrent(): void;
  yieldTask?(): Promise<void>;
  observe?(event: WorkEvent): void;
}
export interface WorkRuntime {
  run<T>(program: Work<T>): Promise<T>;
  wait<T>(operation: () => Promise<T>): Promise<T>;
  assertCurrent(): void;
  addGuard(guard: () => void): () => void;
  setContext(phase?: Phase, storeClass?: StoreClass, frameKind?: FrameKind): void;
  context(): Readonly<Pick<WorkEvent, 'phase' | 'storeClass' | 'frameKind'>>;
  note(metric: Metric, amount?: number): void;
  snapshot(phase?: Phase): Counters;
  notify(kind?: 'work' | 'durable'): void;
  quiet<T>(operation: () => Promise<T>): Promise<T>;
  /** Logical ownership, not measured heap size. Release remains legal after disposal. */
  own(bytes: number, captureGraph?: boolean): Ownership;
  stopped(): boolean;
  dispose(): void;
}
export function effect<T>(visits: number, run: () => T, utf8Bytes?: number,
  metric?: Operation['metric']): Work<T>;
export function primitive<T>(kind: NativeKind, run: () => T): Work<T>;
export function retainWork(bytes: number): Work<Ownership>;
export function runSync<T>(program: Work<T>): T;
export function setDefaultWorkYieldSlice(ms: number): void;
export function createWorkRuntime(control: WorkControl): WorkRuntime;
export function assertWorkRuntime(value: unknown): asserts value is WorkRuntime;

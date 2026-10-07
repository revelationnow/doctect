import { IDBFactory } from 'fake-indexeddb';
import { createHash } from 'node:crypto';
import { makeIncrementalProject } from './incrementalFixtures';
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import { decomposeProject, reconstructProject } from '../../services/localWorkspace/normalized/codec';
import { NORMALIZED_STORE_NAMES, type NormalizedProject, type ProjectStoreName } from '../../services/localWorkspace/normalized/schema';
import { createNormalizedRepository, type NormalizedEnvironment, type RepositoryOperation, type RepositoryFaultPoint } from '../../services/localWorkspace/normalized/repository';

export const testHash = (text: string) => createHash('sha256').update(text).digest('hex');
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });

/** Shared injected owner setup. Unlike the project harness, this does not open or seed storage. */
export function createIncrementalRepositoryHarness(databaseName = 'task-11-isolated') {
  const indexedDB = new IDBFactory();
  const operations: RepositoryOperation[] = [];
  const environment: NormalizedEnvironment = {
    indexedDB, databaseName, now: () => '2026-09-16T12:00:00.000Z', hash: testHash,
    onOperation: operation => operations.push(operation),
  };
  return { indexedDB, databaseName, environment, operations,
    repository: createNormalizedRepository(environment) };
}

/** Test-only seeding and independent export. Never use the writer's cache as an oracle. */
export async function createIncrementalStoreHarness(project: WorkspaceProject = makeIncrementalProject()) {
  const indexedDB = new IDBFactory(); const databaseName = 'task-7-isolated';
  const scope = { storageGeneration: 'g1', projectId: project.id, incarnation: 'i1' };
  const initial = decomposeProject(project, scope);
  const opening = indexedDB.open(databaseName, 3);
  opening.onupgradeneeded = () => { for (const name of NORMALIZED_STORE_NAMES) opening.result.createObjectStore(name, { keyPath: name === 'normalizationLedger' ? 'id' : 'key' }); };
  const seed = await request(opening); const tx = seed.transaction([...NORMALIZED_STORE_NAMES], 'readwrite'); const seeded = done(tx);
  for (const name of NORMALIZED_STORE_NAMES) for (const record of initial[name].values()) tx.objectStore(name).put(record);
  await seeded; seed.close();
  const operations: RepositoryOperation[] = []; const publications: unknown[] = [];
  let fault: ((point: RepositoryFaultPoint) => void) | undefined;
  let readResult: NormalizedEnvironment['readResult'];
  let hash: NormalizedEnvironment['hash'] = testHash;
  const environment: NormalizedEnvironment = { indexedDB, databaseName, now: () => '2026-09-14T12:00:00.000Z',
    hash: text => hash(text), onOperation: operation => operations.push(operation), fault: point => fault?.(point),
    readResult: (operation, value) => readResult ? readResult(operation, value) : value,
    onPublication: publication => publications.push(publication) };
  const readRecords = async (): Promise<NormalizedProject> => {
    const db = await request(indexedDB.open(databaseName));
    const tx = db.transaction(NORMALIZED_STORE_NAMES.filter(s => s !== 'normalizationLedger'), 'readonly'); const completion = done(tx);
    const records = { scope: { ...scope }, normalizationLedger: new Map() } as NormalizedProject;
    const reads = NORMALIZED_STORE_NAMES.filter((s): s is ProjectStoreName => s !== 'normalizationLedger').map(async store => {
      const values = await request(tx.objectStore(store).getAll());
      Object.assign(records, { [store]: new Map(values.map(value => [JSON.stringify(value.key), value])) });
    });
    await Promise.all(reads); await completion; db.close(); return records;
  };
  const repository = createNormalizedRepository(environment);
  await repository.bindAdmittedProject(await readRecords());
  return { repository, scope, environment, operations, publications, initial,
    clearOperations: () => { operations.length = 0; publications.length = 0; },
    setFault: (value?: typeof fault) => { fault = value; }, setReadResult: (value?: typeof readResult) => { readResult = value; },
    setHash: (value: typeof hash) => { hash = value; },
    readRecords, exportFresh: async () => reconstructProject(await readRecords()),
    seedRecords: async (records: NormalizedProject) => {
      const db = await request(indexedDB.open(databaseName)); const tx = db.transaction(storesForSeed(), 'readwrite'); const completion = done(tx);
      for (const store of storesForSeed()) for (const record of records[store].values()) tx.objectStore(store).put(record);
      await completion; db.close();
    },
    anotherRepository: async () => { const other = createNormalizedRepository(environment); await other.bindAdmittedProject(await readRecords()); return other; },
  };
}

const storesForSeed = () => NORMALIZED_STORE_NAMES.filter((s): s is ProjectStoreName => s !== 'normalizationLedger');

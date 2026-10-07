import { resetLocalWorkspace } from '../localWorkspaceHelpers.js';

export const WORKSPACE_DB_NAME = 'doctect-local-workspace';
export const WORKSPACE_STORE_NAMES = [
    'projects',
    'workspace',
    'presets',
    'pendingImports',
    'migrationLedger',
    'legacyBackup',
];
// The pre-2026-08 state ceiling. Migration fixtures deliberately pin the old
// value: the point is to prove a project authored under it still migrates.
export const LEGACY_STATE_BYTES = 5 * 1024 * 1024;

const LEGACY_KEYS = {
    projects: 'hype_projects',
    activeProject: 'hype_active_project',
    customPresets: 'hype_custom_presets',
    pendingImport: 'hype_import_pending',
};
const LEGACY_DOCUMENT_KEYS = Object.values(LEGACY_KEYS);
const encoder = new TextEncoder();
const clone = value => structuredClone(value);

const stateFromProduction = page => page.evaluate(async () => {
    const { createBlankProject } = await import('/services/presets.ts');
    return createBlankProject();
});

const rawJson = value => ` \n${JSON.stringify(value)}\r\n`;

export const createValidLegacyWorkspace = async (page, options = {}) => {
    const baseState = await stateFromProduction(page);
    const firstState = clone(baseState);
    firstState.nodes[firstState.rootId].title = 'Résumé 根 😀';
    firstState.scale = 1.375;
    firstState.generator = {
        formatVersion: 1,
        templateScript: 'const café = "☕";\nreturn templates;\n',
        hierarchyScript: 'const root = "根";\nreturn hierarchy;\n',
        generatedAt: '2026-08-15T01:00:00.000Z',
    };
    const secondState = clone(baseState);
    secondState.nodes[secondState.rootId].title = 'Second project 雪';
    secondState.scale = 0.625;
    const projects = [
        {
            id: 'project-a',
            name: 'Café project ☕',
            initialState: firstState,
            cloud: { projectId: 'cloud-a', lastSyncedCommitId: 'commit-a' },
            revision: 7,
            retainedWrapperField: { unicode: 'naïve Δ' },
        },
        {
            id: 'project-b',
            name: '雪 project',
            initialState: secondState,
            revision: 2,
            retainedWrapperField: ['second', '😀'],
        },
    ].slice(0, options.projectCount ?? 2);
    const presets = [
        {
            id: 'preset-a',
            title: 'Résumé preset',
            desc: 'First saved preset ☕',
            color: 'text-amber-500',
            isCustom: true,
            initialState: clone(firstState),
            retainedPresetField: { order: 1 },
        },
        {
            id: 'preset-b',
            title: '雪 preset',
            desc: 'Second saved preset 😀',
            isCustom: true,
            initialState: clone(secondState),
            retainedPresetField: { order: 2 },
        },
    ].slice(0, options.presetCount ?? 2);
    const pendingImport = options.pendingImport === false ? null : {
        name: 'Imported project 😀',
        state: clone(firstState),
        cloud: { projectId: 'cloud-import', lastSyncedCommitId: 'commit-import' },
    };
    const activeProjectId = projects.at(-1)?.id ?? '';
    const raw = {
        [LEGACY_KEYS.projects]: rawJson(projects),
        [LEGACY_KEYS.activeProject]: activeProjectId,
        [LEGACY_KEYS.customPresets]: rawJson(presets),
        [LEGACY_KEYS.pendingImport]: pendingImport === null ? null : rawJson(pendingImport),
    };
    return { raw, projects, activeProjectId, presets, pendingImport };
};

export const createLegacyFailure = async (page, kind) => {
    const legacy = await createValidLegacyWorkspace(page, { pendingImport: false });
    const projects = JSON.parse(legacy.raw[LEGACY_KEYS.projects]);
    let affectedItem;
    let message;
    switch (kind) {
        case 'malformed-json':
            legacy.raw[LEGACY_KEYS.projects] = '{ malformed outer JSON 😀';
            message = 'does not contain valid JSON';
            break;
        case 'duplicate-project-ids':
            projects.push({ ...clone(projects[0]), name: 'Duplicate id' });
            legacy.raw[LEGACY_KEYS.projects] = rawJson(projects);
            affectedItem = '2';
            message = 'Duplicate project id';
            break;
        case 'malformed-state':
            projects[0].initialState = null;
            legacy.raw[LEGACY_KEYS.projects] = rawJson(projects);
            affectedItem = '0';
            message = 'Legacy project at index 0 is invalid';
            break;
        case 'future-schema':
            projects[0].initialState.schemaVersion = 13;
            legacy.raw[LEGACY_KEYS.projects] = rawJson(projects);
            affectedItem = '0';
            message = 'future schema version';
            break;
        case 'data-detaching-warning':
            projects[0].initialState.schemaVersion = 8;
            projects[0].initialState.generator = { formatVersion: 2 };
            legacy.raw[LEGACY_KEYS.projects] = rawJson(projects);
            affectedItem = '0';
            message = 'detached';
            break;
        default:
            throw new Error(`Unknown legacy failure fixture: ${kind}`);
    }
    return {
        ...legacy,
        expected: {
            category: 'legacy-invalid',
            affectedKey: LEGACY_KEYS.projects,
            affectedItem,
            message,
        },
    };
};

export const createChangedLegacyWorkspace = (legacy, name, marker = 'changed') => {
    const raw = { ...legacy.raw };
    const projects = JSON.parse(raw[LEGACY_KEYS.projects]);
    projects[0] = {
        ...projects[0],
        name,
        cloud: { projectId: `rollback-${marker}`, lastSyncedCommitId: `commit-${marker}` },
        rollbackMarker: marker,
    };
    raw[LEGACY_KEYS.projects] = rawJson(projects);
    return { raw, projects };
};

export const seedLegacyRaw = async (page, raw) => {
    const expectedBytes = Object.values(raw).reduce(
        (total, value) => total + (value === null ? 0 : encoder.encode(value).byteLength),
        0,
    );
    const seeded = await page.evaluate(({ keys, values }) => {
        for (const key of keys) {
            const value = values[key];
            if (value === null || value === undefined) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        }
        const actual = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
        const bytes = Object.values(actual).reduce(
            (total, value) => total + (value === null ? 0 : new TextEncoder().encode(value).byteLength),
            0,
        );
        return { actual, bytes };
    }, { keys: LEGACY_DOCUMENT_KEYS, values: raw });
    if (JSON.stringify(seeded.actual) !== JSON.stringify(raw) || seeded.bytes !== expectedBytes) {
        throw new Error(`Legacy seed mismatch: expected ${expectedBytes} UTF-8 bytes, got ${seeded.bytes}.`);
    }
    return { bytes: seeded.bytes, raw: seeded.actual };
};

export const prepareValidLegacyWorkspace = async (page, options) => {
    await resetLocalWorkspace(page);
    const legacy = await createValidLegacyWorkspace(page, options);
    const seed = await seedLegacyRaw(page, legacy.raw);
    return { ...legacy, seed };
};

export const prepareHistoricalVersionOneWorkspace = async page => {
    await resetLocalWorkspace(page);
    const legacy = await createValidLegacyWorkspace(page);
    const seed = await seedLegacyRaw(page, legacy.raw);
    const evidence = await page.evaluate(async ({ databaseName, stores }) => {
        const [{ captureLegacySnapshot }, { prepareInitialCopy }, { createBlankProject }] = await Promise.all([
            import('/services/localWorkspace/legacy.ts'),
            import('/services/localWorkspace/migration.ts'),
            import('/services/presets.ts'),
        ]);
        let uuid = 0;
        const prepared = await prepareInitialCopy(captureLegacySnapshot(localStorage), {
            crypto: globalThis.crypto,
            now: () => '2026-08-18T12:00:00.000Z',
            randomUUID: () => `historical-seed-${++uuid}`,
            createBlankProject,
        });
        const historicalProjects = prepared.projects.map(record => {
            const historical = structuredClone(record);
            delete historical.incarnation;
            return historical;
        });
        const historicalLedger = {
            ...structuredClone(prepared.ledger),
            indexedDbVersion: 1,
            state: 'verified',
            ledgerRevision: 1,
            verifiedAt: '2026-08-18T12:01:00.000Z',
        };
        const expectedWorkspace = {
            projects: prepared.projects.map(record => record.project),
            activeProjectId: prepared.workspace.activeProjectId,
            customPresets: prepared.presets.map(record => record.preset),
            pendingImports: prepared.pendingImports.map(record => record.pendingImport),
        };

        await new Promise((resolve, reject) => {
            const deletion = indexedDB.deleteDatabase(databaseName);
            deletion.addEventListener('success', resolve, { once: true });
            deletion.addEventListener('error', () => reject(deletion.error), { once: true });
        });
        const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.addEventListener('upgradeneeded', () => {
                for (const store of stores) {
                    request.result.createObjectStore(store, { keyPath: 'id' });
                }
            }, { once: true });
            request.addEventListener('success', () => resolve(request.result), { once: true });
            request.addEventListener('error', () => reject(request.error), { once: true });
        });
        const transaction = database.transaction(stores, 'readwrite');
        for (const project of historicalProjects) transaction.objectStore('projects').put(project);
        transaction.objectStore('workspace').put(prepared.workspace);
        for (const preset of prepared.presets) transaction.objectStore('presets').put(preset);
        for (const pending of prepared.pendingImports) transaction.objectStore('pendingImports').put(pending);
        transaction.objectStore('migrationLedger').put(historicalLedger);
        transaction.objectStore('legacyBackup').put(prepared.backup);
        await new Promise((resolve, reject) => {
            transaction.addEventListener('complete', resolve, { once: true });
            transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
            transaction.addEventListener('error', () => reject(transaction.error), { once: true });
        });
        database.close();
        return {
            expectedWorkspace,
            expectedTargetDigest: prepared.targetDigest,
            historicalProjects,
            historicalLedger,
        };
    }, { databaseName: WORKSPACE_DB_NAME, stores: WORKSPACE_STORE_NAMES });
    return { ...legacy, seed, ...evidence };
};

export const prepareLegacyFailure = async (page, kind) => {
    await resetLocalWorkspace(page);
    const legacy = await createLegacyFailure(page, kind);
    const seed = await seedLegacyRaw(page, legacy.raw);
    return { ...legacy, seed };
};

export const readLegacyRaw = page => page.evaluate(keys =>
    Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), LEGACY_DOCUMENT_KEYS);

export const writeLegacyRaw = (page, raw) => page.evaluate(({ keys, values }) => {
    for (const key of keys) {
        const value = values[key];
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    }
    return Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
}, { keys: LEGACY_DOCUMENT_KEYS, values: raw });

export const armLegacyStorageEvent = page => page.evaluate(keys => {
    window.__legacyStorageEventObserved = new Promise(resolve => {
        addEventListener('storage', event => {
            if (event.key === null || keys.includes(event.key)) resolve(event.key);
        }, { once: true });
    });
}, LEGACY_DOCUMENT_KEYS);

export const waitForLegacyStorageEvent = page => page.evaluate(() =>
    window.__legacyStorageEventObserved);

export const inspectWorkspaceDatabase = page => page.evaluate(async ({ databaseName, stores }) => {
    if (typeof indexedDB.databases === 'function') {
        const databases = await indexedDB.databases();
        if (!databases.some(database => database.name === databaseName)) return null;
    }
    const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
        request.addEventListener('blocked', () => reject(new Error('Database inspection blocked.')), { once: true });
    });
    try {
        const existingStores = stores.filter(store => database.objectStoreNames.contains(store));
        if (existingStores.length === 0) {
            return { version: database.version, schema: {}, records: {} };
        }
        const transaction = database.transaction(existingStores, 'readonly');
        const schema = Object.fromEntries(existingStores.map(store => [
            store,
            Array.from(transaction.objectStore(store).indexNames),
        ]));
        const records = Object.fromEntries(await Promise.all(existingStores.map(store =>
            new Promise((resolve, reject) => {
                const request = transaction.objectStore(store).getAll();
                request.addEventListener('success', () => resolve([store, request.result]), { once: true });
                request.addEventListener('error', () => reject(request.error), { once: true });
            }))));
        await new Promise((resolve, reject) => {
            transaction.addEventListener('complete', resolve, { once: true });
            transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
            transaction.addEventListener('error', () => reject(transaction.error), { once: true });
        });
        return { version: database.version, schema, records };
    } finally {
        database.close();
    }
}, { databaseName: WORKSPACE_DB_NAME, stores: WORKSPACE_STORE_NAMES });

// The v3 authority: the normalized manifest and ledger. Version-2 stores stay frozen as the historical source.
export const inspectNormalizedWorkspace = page => page.evaluate(async databaseName => {
    const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
    });
    try {
        const read = (store, method, key) => new Promise((resolve, reject) => {
            if (!database.objectStoreNames.contains(store)) return resolve(method === 'get' ? undefined : []);
            const request = database.transaction(store, 'readonly').objectStore(store)[method](key);
            request.addEventListener('success', () => resolve(request.result), { once: true });
            request.addEventListener('error', () => reject(request.error), { once: true });
        });
        return {
            version: database.version,
            manifest: await read('workspace', 'get', 'current'),
            normalizationLedger: await read('normalizationLedger', 'getAll'),
            legacyBackups: (await read('legacyBackup', 'getAll')).filter(backup => backup.kind !== 'normalization-source'),
        };
    } finally {
        database.close();
    }
}, WORKSPACE_DB_NAME);

export const putWorkspaceRecord = (page, storeName, value) => page.evaluate(
    async ({ databaseName, targetStore, record }) => {
        const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            request.addEventListener('success', () => resolve(request.result), { once: true });
            request.addEventListener('error', () => reject(request.error), { once: true });
        });
        try {
            const transaction = database.transaction(targetStore, 'readwrite');
            transaction.objectStore(targetStore).put(record);
            await new Promise((resolve, reject) => {
                transaction.addEventListener('complete', resolve, { once: true });
                transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
                transaction.addEventListener('error', () => reject(transaction.error), { once: true });
            });
        } finally {
            database.close();
        }
    },
    { databaseName: WORKSPACE_DB_NAME, targetStore: storeName, record: value },
);

export const totalStoredRecords = inspection => inspection === null
    ? 0
    : Object.values(inspection.records).reduce((total, records) => total + records.length, 0);

export const installBootstrapPhaseHold = (page, targetPhase) => page.evaluate(async target => {
    const { localWorkspaceStore } = await import('/services/localWorkspace/index.ts');
    let currentPhase = null;
    let held = false;
    let released = false;
    let resolveReached;
    let resolveRelease;
    const reached = new Promise(resolve => { resolveReached = resolve; });
    const release = new Promise(resolve => { resolveRelease = resolve; });
    const hold = async () => {
        if (released || currentPhase !== target) return;
        if (!held) {
            held = true;
            resolveReached();
        }
        await release;
    };
    release.then(() => { released = true; });

    const requestPrototype = IDBRequest.prototype;
    const originalRequestListener = requestPrototype.addEventListener;
    let selectedOpenRequest;
    requestPrototype.addEventListener = function(type, listener, options) {
        if (target === 'opening-local-storage'
            && currentPhase === target
            && this instanceof IDBOpenDBRequest
            && !selectedOpenRequest) {
            selectedOpenRequest = this;
        }
        const wrapped = async event => {
            if (type === 'success' && this === selectedOpenRequest) await hold();
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
        };
        return originalRequestListener.call(this, type, wrapped, options);
    };

    const databasePrototype = IDBDatabase.prototype;
    const originalTransaction = databasePrototype.transaction;
    let selectedTransaction;
    databasePrototype.transaction = function(...args) {
        const transaction = originalTransaction.apply(this, args);
        const mode = args[1] ?? 'readonly';
        const matchingMode = (target === 'checking-existing-projects' && mode === 'readonly')
            || (target === 'copying-projects' && mode === 'readwrite');
        if (!selectedTransaction && currentPhase === target && matchingMode) {
            selectedTransaction = transaction;
        }
        return transaction;
    };

    const transactionPrototype = IDBTransaction.prototype;
    const originalTransactionListener = transactionPrototype.addEventListener;
    transactionPrototype.addEventListener = function(type, listener, options) {
        const wrapped = async event => {
            if (type === 'complete' && this === selectedTransaction) await hold();
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
        };
        return originalTransactionListener.call(this, type, wrapped, options);
    };

    const subtlePrototype = Object.getPrototypeOf(crypto.subtle);
    const originalDigest = subtlePrototype.digest;
    subtlePrototype.digest = async function(...args) {
        await hold();
        return originalDigest.apply(this, args);
    };

    // Normalized copy and verification run in the workspace worker, out of reach
    // of the page's IndexedDB prototypes: hold the next request sent during the phase.
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(...args) {
        if (!released && currentPhase === target
            && (target === 'copying-projects' || target === 'verifying-projects')) {
            void hold().then(() => originalPostMessage.apply(this, args));
            return;
        }
        return originalPostMessage.apply(this, args);
    };

    const originalBootstrap = localWorkspaceStore.bootstrap.bind(localWorkspaceStore);
    localWorkspaceStore.bootstrap = observer => {
        const operation = originalBootstrap({
            ...observer,
            onPhase(phase) {
                currentPhase = phase;
                observer?.onPhase?.(phase);
            },
        });
        return target === 'finishing-upgrade'
            ? operation.then(async result => {
                await hold();
                return result;
            })
            : operation;
    };
    window.__workspaceMigrationPhaseReached = reached;
    window.__releaseWorkspaceMigrationPhase = resolveRelease;
}, targetPhase);

export const installBootstrapResultCapture = page => page.evaluate(async () => {
    const { localWorkspaceStore } = await import('/services/localWorkspace/index.ts');
    const original = localWorkspaceStore.bootstrap.bind(localWorkspaceStore);
    localWorkspaceStore.bootstrap = observer => {
        const operation = original(observer);
        operation.then(result => {
            window.__capturedWorkspaceBootstrapResult = structuredClone(result);
        });
        return operation;
    };
});

export const readCapturedBootstrapResult = page => page.evaluate(() =>
    window.__capturedWorkspaceBootstrapResult);

// Crash on the first legacy read after the transaction that commits the
// `copied` ledger completes, wherever the bootstrap reads legacy next.
export const installCrashAfterCopied = page => page.evaluate(keys => {
    const originalGetItem = Storage.prototype.getItem;
    let armed = false;
    for (const method of ['put', 'add']) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function(value, key) {
            if (this.name === 'migrationLedger' && value?.state === 'copied') {
                this.transaction.addEventListener('complete', () => { armed = true; }, { once: true });
                IDBObjectStore.prototype[method] = original;
            }
            return original.call(this, value, key);
        };
    }
    Storage.prototype.getItem = function(key) {
        if (armed && this === localStorage && keys.includes(key)) {
            Storage.prototype.getItem = originalGetItem;
            throw new Error('Injected crash after committed copy.');
        }
        return originalGetItem.call(this, key);
    };
}, LEGACY_DOCUMENT_KEYS);

export const navigateSpaToEditor = page => page.evaluate(() => {
    history.pushState({}, '', '/app');
    dispatchEvent(new PopStateEvent('popstate'));
});

export const waitForBootstrapPhaseHold = page => page.evaluate(() =>
    window.__workspaceMigrationPhaseReached);

export const releaseBootstrapPhaseHold = page => page.evaluate(() =>
    window.__releaseWorkspaceMigrationPhase());

export const installInitialCopyCorruption = page => page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let corrupted = false;
    IDBObjectStore.prototype.add = function(value, key) {
        if (!corrupted && this.name === 'projects' && value?.project) {
            corrupted = true;
            const changed = structuredClone(value);
            changed.project.name = 'Corrupt target read-back';
            IDBObjectStore.prototype.add = original;
            return original.call(this, changed, key);
        }
        return original.call(this, value, key);
    };
});

export const installInitialCopyAbort = page => page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
        if (this.name === 'workspace' && value?.id === 'current') {
            IDBObjectStore.prototype.add = original;
            throw new DOMException('Injected copy transaction failure.', 'AbortError');
        }
        return original.call(this, value, key);
    };
});

export const installIndexedDbUnavailable = page => page.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: undefined,
    });
});

export const installIndexedDbOpenFailure = page => page.evaluate(() => {
    IDBFactory.prototype.open = function() {
        throw new DOMException('Injected IndexedDB open failure.', 'InvalidStateError');
    };
});

export const installIndexedDbTermination = page => page.evaluate(() => {
    const original = IDBDatabase.prototype.addEventListener;
    let terminated = false;
    IDBDatabase.prototype.addEventListener = function(type, listener, options) {
        const result = original.call(this, type, listener, options);
        if (!terminated && type === 'close') {
            terminated = true;
            queueMicrotask(() => {
                const event = new Event('close');
                if (typeof listener === 'function') listener.call(this, event);
                else listener.handleEvent(event);
            });
        }
        return result;
    };
});

export const holdVersionOneWorkspaceDatabase = page => page.evaluate(async ({ databaseName, stores }) => {
    await new Promise((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(databaseName);
        deletion.addEventListener('success', resolve, { once: true });
        deletion.addEventListener('error', () => reject(deletion.error), { once: true });
    });
    const versionOne = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.addEventListener('upgradeneeded', () => {
            for (const store of stores) request.result.createObjectStore(store, { keyPath: 'id' });
        }, { once: true });
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
    });
    window.__heldWorkspaceDatabase = versionOne;
    window.__heldWorkspaceVersionChangeCount = 0;
    versionOne.addEventListener('versionchange', event => {
        event.preventDefault();
        window.__heldWorkspaceVersionChangeCount += 1;
    });
    return { version: versionOne.version, stores: Array.from(versionOne.objectStoreNames) };
}, { databaseName: WORKSPACE_DB_NAME, stores: WORKSPACE_STORE_NAMES });

export const mountVersionTwoWorkspaceGate = page => page.evaluate(async () => {
    const { mountBlockedUpgradeGate } = await import('/tests/e2e/fixtures/workspaceBlockedUpgradeHarness.tsx');
    return mountBlockedUpgradeGate(2);
});

export const readHeldWorkspaceSignals = page => page.evaluate(() => ({
    versionChangeCount: window.__heldWorkspaceVersionChangeCount,
}));

export const inspectHeldWorkspaceDatabase = page => page.evaluate(async stores => {
    const database = window.__heldWorkspaceDatabase;
    if (!database) throw new Error('Version-1 workspace database is not held.');
    const transaction = database.transaction(stores, 'readonly');
    const records = Object.fromEntries(await Promise.all(stores.map(store => new Promise((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.addEventListener('success', () => resolve([store, request.result]), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
    }))));
    await new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
        transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    });
    return {
        version: database.version,
        versionChangeCount: window.__heldWorkspaceVersionChangeCount,
        records,
    };
}, WORKSPACE_STORE_NAMES);

export const releaseHeldWorkspaceDatabase = page => page.evaluate(() => {
    window.__heldWorkspaceDatabase?.close();
    delete window.__heldWorkspaceDatabase;
});

const streamText = async stream => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
};

export const downloadJson = async (page, buttonName) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    return JSON.parse(await streamText(stream));
};

export const legacyRawFromBundle = bundle => Object.fromEntries(
    bundle.entries.map(entry => [entry.key, entry.present ? entry.raw : null]),
);

const sizeState = state => encoder.encode(JSON.stringify(state)).byteLength;

export const createLargeLegacyWorkspace = async (page, baseState) => {
    const firstState = baseState === undefined
        ? await stateFromProduction(page)
        : clone(baseState);
    const targetBytes = LEGACY_STATE_BYTES - 1024;
    firstState.nodes[firstState.rootId].data = {
        ...firstState.nodes[firstState.rootId].data,
        unicodeSeed: 'Café 根 😀',
        largePayload: '',
    };
    const emptyBytes = sizeState(firstState);
    const payloadBytes = targetBytes - emptyBytes;
    firstState.nodes[firstState.rootId].data.largePayload =
        `${'雪'.repeat(Math.floor(payloadBytes / 3))}${'x'.repeat(payloadBytes % 3)}`;
    const nearLimitStateBytes = sizeState(firstState);
    const secondState = clone(firstState);
    secondState.nodes[secondState.rootId].data.largePayload = '雪'.repeat(350_000);
    const projects = [
        { id: 'near-limit', name: 'Near limit 😀', initialState: firstState },
        { id: 'aggregate-extra', name: 'Aggregate extra 雪', initialState: secondState },
    ];
    const raw = {
        [LEGACY_KEYS.projects]: rawJson(projects),
        [LEGACY_KEYS.activeProject]: 'near-limit',
        [LEGACY_KEYS.customPresets]: rawJson([]),
        [LEGACY_KEYS.pendingImport]: null,
    };
    const aggregateProjectBytes = encoder.encode(raw[LEGACY_KEYS.projects]).byteLength;
    return {
        raw,
        projects,
        activeProjectId: 'near-limit',
        nearLimitStateBytes,
        aggregateProjectBytes,
    };
};

export const prepareLargeLegacyWorkspace = async page => {
    await resetLocalWorkspace(page);
    const legacy = await createLargeLegacyWorkspace(page);
    const seed = await seedLegacyRaw(page, legacy.raw);
    return { ...legacy, seed };
};

export const prepareNearLimitLegacyWorkspaceFromBuiltEditor = async page => {
    await resetLocalWorkspace(page);
    await page.goto('/app');
    await page.getByTestId('project-pane').first().waitFor();
    // The built editor's own JSON download of its fresh seed project.
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="project-tab"]').first().getByTitle('Close Project', { exact: true }).click();
    await page.getByRole('button', { name: 'Save JSON & Close', exact: true }).click();
    const baseState = JSON.parse(await streamText(await (await downloadPromise).createReadStream()));
    if (!baseState?.nodes || !baseState?.variants) throw new Error('Built editor did not create a seed project state.');

    await resetLocalWorkspace(page);
    const large = await createLargeLegacyWorkspace(page, baseState);
    const projects = [large.projects[0]];
    const raw = {
        ...large.raw,
        [LEGACY_KEYS.projects]: rawJson(projects),
    };
    const seed = await seedLegacyRaw(page, raw);
    return {
        ...large,
        raw,
        projects,
        aggregateProjectBytes: encoder.encode(raw[LEGACY_KEYS.projects]).byteLength,
        seed,
    };
};

export const installPerformanceCapture = page => page.addInitScript(() => {
    window.__workspaceMigrationPerformance = {
        startedAt: performance.now(),
        longTasks: [],
        supported: PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false,
    };
    if (window.__workspaceMigrationPerformance.supported) {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                window.__workspaceMigrationPerformance.longTasks.push({
                    name: entry.name,
                    startTime: entry.startTime,
                    duration: entry.duration,
                });
            }
        });
        observer.observe({ type: 'longtask', buffered: true });
        window.__workspaceMigrationPerformance.observer = observer;
    }
});

export const readPerformanceCapture = page => page.evaluate(() => {
    const capture = window.__workspaceMigrationPerformance;
    capture.observer?.disconnect();
    return {
        durationMs: performance.now() - capture.startedAt,
        longTaskSupported: capture.supported,
        longTasks: capture.longTasks,
    };
});

export const installProjectPreparationWorkerCapture = page => page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    const capture = {
        workers: [],
        requests: 0,
        responses: 0,
        workspaceRequests: [],
        transactions: [],
    };
    globalThis.__workspaceProjectPreparationWorkers = capture;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(storeNames, mode, options) {
        const opened = transaction.call(this, storeNames, mode, options);
        capture.transactions.push({
            database: this.name,
            stores: typeof storeNames === 'string' ? [storeNames] : Array.from(storeNames),
            mode: mode ?? 'readonly',
        });
        return opened;
    };
    globalThis.Worker = new Proxy(NativeWorker, {
        construct(Target, args) {
            const worker = Reflect.construct(Target, args);
            capture.workers.push({
                url: String(args[0]),
                type: args[1]?.type ?? null,
            });
            const postMessage = worker.postMessage.bind(worker);
            worker.postMessage = (...postArgs) => {
                if (postArgs[0]?.type === 'prepare-project') capture.requests += 1;
                const workspaceRequest = postArgs[0]?.request?.type;
                if (typeof workspaceRequest === 'string') capture.workspaceRequests.push(workspaceRequest);
                return postMessage(...postArgs);
            };
            worker.addEventListener('message', event => {
                if (event.data?.type === 'project-prepared'
                    || event.data?.type === 'project-preparation-failed') {
                    capture.responses += 1;
                }
            });
            return worker;
        },
    });
});

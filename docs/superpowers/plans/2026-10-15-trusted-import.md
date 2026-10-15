# Trusted Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gallery "Open in editor" / fork fast (33s → ≤ 8s desktop for the 2026 Planner) by trusting the worker's own fresh writes in `stage-import`, `replace-staged-import` and `consume-import`, and by replacing the post-commit metered workspace re-read with the trusted active read.

**Architecture:** Same pattern as Trusted Create / Open / Replace. Native, byte-identical twins of the metered frames (`envelopeFrameText`, `trustedImportDescriptor`, `hash(canonicalText(...))`) and the `'sync'` modes of the existing validation traversals replace metered work only inside the worker's own commit (`commitWorkspace`). Post-write verification compares readback rows with the rows just written. `NormalizedWorkspaceStore.snapshot()` reads through a new `readTrustedActiveSnapshot` (one readonly transaction, plain reconstruct). Inspection, retry, recovery and `readActiveSnapshot` keep full metered verification.

**Tech Stack:** TypeScript, IndexedDB (fake-indexeddb in tests), Vitest, Playwright, cooperative Work runtime (`shared/cooperativeWork.js`, `shared/jsonWork.js`).

**Spec:** `docs/superpowers/specs/2026-10-14-trusted-import-design.md`

## Global Constraints

- Stored formats, digests, proofs, manifests, receipts, commit windows and acks are unchanged: every native twin must be byte-identical to its metered frame, pinned by an equivalence test.
- Authority, identity, attempt and provenance checks are unchanged; the compare-and-swap seal stays (only the pending-import row comparison becomes native).
- `inspectWorkspaceAttempt`, retry, restart, recovery and bootstrap verification keep the full metered verification. `readActiveSnapshot` keeps its metered implementation for its other callers.
- An `already-staged` or `already-consumed` outcome (nothing written) keeps the full metered verification.
- Do not touch the private `captureFrame` in `repository.ts`: it frames normalization source digests.
- Preparation must stay deterministic: no randomness in migration or repair paths.
- Run vitest and playwright with `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp` (absolute).
- E2E ports: `E2E_WEB_PORT=4410 E2E_API_PORT=4411`. After any server or e2e run, restore the tracked `server/analytics.db` (`git checkout -- server/analytics.db`); never commit it.
- Never commit bench or scratch files (`tests/benchtmp/`, `.superpowers/`, the gallery payload).
- Don't loosen existing pinned tests; when an existing test pins metered behaviour that this plan deliberately changes, update it to pin the new behaviour and say so in the commit message.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The last commit on the branch regenerates the onboarding bundle: `node onboarding/build.mjs`.

## Review Focus

1. A consume when another, untouched pending import is also stored: that row is still validated (now natively), and a corrupt descriptor on it is still refused. Pinned in Task 2.
2. A schema-7 pre-layer gallery state staged through the trusted path: migration warnings and the repair-added `layer_default` layer come out identical to the metered path. Pinned in Task 1 and Task 2.
3. Unicode, U+2028, lone surrogates and empty-string keys in a pending import: native frame text is byte-identical. Pinned in Task 1.
4. A retry of the same stage after success (`already-staged`) and a re-consume (`already-consumed`): still answered correctly with full verification. Pinned in Task 3.
5. The snapshot returned after a structural commit when another project has saved edits: equals the metered read (not stale initializers). Pinned in Task 4.

---

## File Structure

- Modify `services/localWorkspace/normalized/work.ts`: add `envelopeFrameText` (native twin of `envelopeFrame`).
- Modify `services/localWorkspace/normalized/workspaceCommands.ts`: add `trustedImportDescriptor`, a trusted pending-import row check in `validateCapture`, trusted branches in `prepareWorkspaceMutation`, and trusted written-import verification in `verifyWorkspacePostconditions`.
- Modify `services/localWorkspace/normalized/repository.ts`: pass trusted inputs to verification, add native pending-import compare in `sealWorkspaceCapture`, add `trustedActiveRead` / `readTrustedActiveSnapshot`.
- Modify `services/localWorkspace/workspaceStartupProtocol.ts`, `services/localWorkspace/normalized/startup.ts`, `services/localWorkspace/workspaceStartup.ts`: route the `'trusted-active'` startup operation.
- Modify `services/localWorkspace/NormalizedWorkspaceStore.ts`: `snapshot()` uses `readTrustedActiveSnapshot`.
- Create `tests/unit/localWorkspace/normalized/trustedImport.test.ts`: all new tests (one `describe` per task).
- Modify `tests/unit/localWorkspace/normalized/normalEditorStore.test.ts`: store-level post-commit read test.
- Modify spec `Result` section in Task 5.

---

### Task 1: Native twins and preparation equivalence

**Files:**
- Modify: `services/localWorkspace/normalized/work.ts`
- Modify: `services/localWorkspace/normalized/workspaceCommands.ts` (near `importDescriptor`, ~line 275)
- Create: `tests/unit/localWorkspace/normalized/trustedImport.test.ts`

**Interfaces:**
- Produces: `envelopeFrameText(label: string, value: object): string` (work.ts); `trustedImportDescriptor(row: StoredPendingImport, hash: (text: string) => Promise<string>): Promise<ImportDescriptor>` (workspaceCommands.ts, exported). Test helpers in `trustedImport.test.ts`: `sha256Hex`, `frameText`, `legacyState`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/localWorkspace/normalized/trustedImport.test.ts`:

```ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { runSync } from '../../../../shared/cooperativeWork.js';
import { canonicalText } from '../../../../shared/jsonWork.js';
import { canonicalFrame, envelopeFrame, envelopeFrameText, hashFrame } from '../../../../services/localWorkspace/normalized/work';
import * as commands from '../../../../services/localWorkspace/normalized/workspaceCommands';
import { preparePendingImport, preparePendingImportWork } from '../../../../services/localWorkspace/validation';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createPlannerProject } from '../../../../services/presets';
import type { StoredPendingImport } from '../../../../services/localWorkspace/schema';

const sha256Hex = async (text: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const frameText = (frame: ReturnType<typeof envelopeFrame>) => {
  const chunks: string[] = [];
  runSync(frame(function* (text: string) { chunks.push(text); }));
  return chunks.join('');
};
/** A gallery project published before layers existed (schema 7). */
const legacyState = () => {
  const state = structuredClone(makeIncrementalProject(2).initialState) as any;
  state.schemaVersion = 7;
  for (const variant of Object.values(state.variants) as any[]) for (const template of Object.values(variant.templates) as any[]) {
    delete template.layers; for (const element of template.elements) delete element.layerId;
  }
  return state;
};
const pendingInput = (state: unknown, id = 'gallery-import') => ({ id, targetProjectId: `${id}-target`, name: 'Gallery 雪 😀', state,
  createdAt: '2026-10-14T00:00:00.000Z' });
const storedRow = (state: unknown): StoredPendingImport => ({ id: 'gallery-import', position: 0,
  pendingImport: preparePendingImport(pendingInput(state), { warningPolicy: 'retain' }),
  attemptProvenance: { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64), pendingImportDigest: 'c'.repeat(64) } });
const awkward = { b: 1, a: [1, { z: 1, y: 2 }], '😀 key': 'value ', '': '', 'lone \ud800': 'tail \udc00', 'Ä': null, 'a\u0000': 'nul' };

describe('trusted import twins', () => {
  it.each([['workspace-import-v1'], ['workspace-seal']])('envelopeFrameText(%s) is byte-identical to envelopeFrame', label => {
    for (const value of [awkward, storedRow(createPlannerProject()), storedRow(legacyState())]) {
      expect(envelopeFrameText(label, value)).toBe(frameText(envelopeFrame(label, value)));
    }
  });

  it('trustedImportDescriptor equals the metered import descriptor digests', async () => {
    for (const row of [storedRow(createPlannerProject()), storedRow(legacyState()), { ...storedRow(legacyState()), attemptProvenance: undefined } as any]) {
      if (row.attemptProvenance === undefined) delete row.attemptProvenance;
      const w = makeWorkHarness();
      const expected = { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
        recordDigest: await hashFrame(w.runtime, 'proof', envelopeFrame('workspace-import-v1', row)),
        pendingImportDigest: await hashFrame(w.runtime, 'proof', canonicalFrame(row.pendingImport)),
        ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: { ...row.attemptProvenance } } : {}) };
      expect(await commands.trustedImportDescriptor(row, sha256Hex)).toEqual(expected);
    }
  });

  it('hash(canonicalText(x)) equals the metered canonical proof digest', async () => {
    for (const value of [awkward, storedRow(createPlannerProject()).pendingImport]) {
      expect(await sha256Hex(canonicalText(value))).toBe(await hashFrame(makeWorkHarness().runtime, 'proof', canonicalFrame(value)));
    }
  });

  it.each([['planner', () => createPlannerProject()], ['schema-7 pre-layer', legacyState]])(
    'preparePendingImport (sync) equals preparePendingImportWork for a %s state', async (_name, state) => {
      for (const warningPolicy of ['retain', 'reject'] as const) {
        const input = pendingInput(state());
        let sync: unknown, syncError: unknown, metered: unknown, meteredError: unknown;
        try { sync = preparePendingImport(structuredClone(input), { warningPolicy }); } catch (error) { syncError = error; }
        try { metered = await makeWorkHarness().runtime.run(preparePendingImportWork(structuredClone(input), { warningPolicy })); } catch (error) { meteredError = error; }
        expect(String(syncError ?? '')).toBe(String(meteredError ?? ''));
        expect(sync).toEqual(metered);
      }
      const prepared = preparePendingImport(pendingInput(legacyState()), { warningPolicy: 'retain' }) as any;
      for (const variant of Object.values(prepared.state.variants) as any[]) for (const template of Object.values(variant.templates) as any[]) {
        expect(template.layers.map((layer: any) => layer.id)).toEqual(['layer_default']);
      }
    });

  it.each([
    ['numeric createdAt', (input: any) => ({ ...input, createdAt: 1 })],
    ['future schema', (input: any) => ({ ...input, state: { ...input.state, schemaVersion: 99 } })],
    ['missing name', (input: any) => { const { name: _name, ...rest } = input; return rest; }],
    ['extra field', (input: any) => ({ ...input, surprise: true })],
  ])('preparePendingImport rejects %s exactly like the metered preparation', async (_name, change) => {
    const input = change(pendingInput(legacyState()));
    let syncError: unknown, meteredError: unknown;
    try { preparePendingImport(structuredClone(input), { warningPolicy: 'retain' }); } catch (error) { syncError = error; }
    try { await makeWorkHarness().runtime.run(preparePendingImportWork(structuredClone(input), { warningPolicy: 'retain' })); } catch (error) { meteredError = error; }
    expect(syncError).toBeDefined();
    expect(String(syncError)).toBe(String(meteredError));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace/normalized/trustedImport.test.ts`
Expected: FAIL — `envelopeFrameText` is not exported from `work.ts`, `commands.trustedImportDescriptor` is not a function. (The `preparePendingImport` equivalence tests may already pass; that is fine — they pin existing behaviour this plan relies on.) If one of the four rejection cases is accepted by *both* preparations, it is not an invalid input for this traversal: replace it with another input both reject (for example `state: null`) rather than deleting the assertion that both reject identically.

- [ ] **Step 3: Implement the twins**

In `services/localWorkspace/normalized/work.ts`, add `canonicalText` to the existing `../../../shared/jsonWork.js` import and append after `envelopeFrame`:

```ts
/** Native twin of envelopeFrame's text for the worker's own fresh rows: lexical
 * code-unit key order, each payload framed canonically at its original depth.
 * Tests pin byte equality with envelopeFrame. */
export const envelopeFrameText = (label: string, value: object): string => {
  const keys = Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return `[${canonicalText(label)},{${keys.map(key => `${canonicalText(key)}:${canonicalText((value as Record<string, unknown>)[key])}`).join(',')}}]`;
};
```

In `services/localWorkspace/normalized/workspaceCommands.ts`, change the `./work` import to `import { canonicalFrame, envelopeFrame, envelopeFrameText, equalFrameWork, hashFrame, orderedFrame } from './work';` and add directly after `importDescriptor`:

```ts
/** Native twin of importDescriptor for the worker's own commit; tests pin equality. */
export async function trustedImportDescriptor(row: StoredPendingImport, hash: (text: string) => Promise<string>): Promise<ImportDescriptor> {
  return { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
    recordDigest: await hash(envelopeFrameText('workspace-import-v1', row)),
    pendingImportDigest: await hash(canonicalText(row.pendingImport)),
    ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: { ...row.attemptProvenance! } } : {}) };
}
```

If the `envelopeFrameText` test fails for the lone-surrogate or NUL key, compare the two texts, find the quoting difference (`quoteWork` vs `canonicalText` of a string), and make the twin match `envelopeFrame` exactly. Do not change `envelopeFrame`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace/normalized/trustedImport.test.ts`
Expected: PASS (all tests in `trusted import twins`).

- [ ] **Step 5: Commit**

```bash
git add services/localWorkspace/normalized/work.ts services/localWorkspace/normalized/workspaceCommands.ts tests/unit/localWorkspace/normalized/trustedImport.test.ts
git commit -m "perf(local-workspace): native twins for pending-import frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Trusted stage and consume preparation

**Files:**
- Modify: `services/localWorkspace/normalized/workspaceCommands.ts` (`validateCapture` ~line 280, `prepareWorkspaceMutation` ~lines 348–570)
- Test: `tests/unit/localWorkspace/normalized/trustedImport.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `envelopeFrameText`, `trustedImportDescriptor` (Task 1); existing `TrustedWorkspacePreparation { requestDigest: string; hash(text: string): Promise<string> }`.
- Produces: `validateCapture(captured, batch, work, before = true, trusted?: TrustedCaptureCheck)` where
  `interface TrustedCaptureCheck { hash(text: string): Promise<string>; writtenImports?: readonly StoredPendingImport[] }` (module-private). With `trusted`, prepared stage/replace/consume use sync preparation and native hashes; the prepared result (`manifest`, `putImports`, `deleteImportIds`, `delta`, `outcome`, `addProjects`) is identical to the metered preparation of the same batch.

- [ ] **Step 1: Write the failing tests**

Append to `trustedImport.test.ts` (add the imports to the top of the file: `import { afterAll, beforeAll, vi } from 'vitest';`, `import * as validation from '../../../../services/localWorkspace/validation';`, `import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';`, `import { physicalRows } from '../../../helpers/normalizationHarness';`, `import { NORMALIZED_STORE_NAMES, type NormalizedProject } from '../../../../services/localWorkspace/normalized/schema';`, `import type { WorkspaceBatch, WorkspaceLifecycleIntent } from '../../../../services/localWorkspace/normalized/workspaceCommands';`):

```ts
describe('trusted import preparation', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  let sequence = 0;
  beforeAll(async () => { h = await createWorkspaceCommandHarness(); });
  afterAll(() => h?.adapter.close());
  /** The command capture prepareWorkspaceMutation sees, read from the harness's current physical rows. */
  const capture = async () => {
    const rows = await physicalRows(h, [...NORMALIZED_STORE_NAMES, 'workspace', 'presets', 'pendingImports']);
    const manifest = rows.workspace[0];
    const projects = manifest.members.map((member: any) => ({ scope: { storageGeneration: manifest.storageGeneration,
      projectId: member.projectId, incarnation: member.incarnation },
      ...Object.fromEntries(NORMALIZED_STORE_NAMES.map(store => [store, store === 'normalizationLedger' ? new Map()
        : new Map(rows[store].filter((row: any) => row.key[1] === member.projectId).map((row: any) => [JSON.stringify(row.key), row]))])) } as NormalizedProject));
    return { manifest, initial: { revision: rows.normalizationLedger[0].sourceWorkspaceRevision, coreDigest: rows.normalizationLedger[0].initialWorkspaceDigest },
      memberHeaders: rows.projectHeaders, projects, presets: rows.presets, pendingImports: rows.pendingImports } as any;
  };
  /** Prepares one batch twice — metered, then trusted — and returns both results. */
  const preparePair = async (intent: WorkspaceLifecycleIntent) => {
    const captured = await capture(), now = h.preparation.now();
    const request: WorkspaceBatch = { ...h.request(intent), identity: { clientId: 'trusted-pair', commandId: `pair-${++sequence}`, commandSequence: sequence },
      expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
    const run = async (trusted: boolean) => {
      const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
      try {
        const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
        const result = await commands.prepareWorkspaceMutation(captured, input.batch, now, w.runtime, undefined,
          trusted ? { requestDigest, hash: sha256Hex } : undefined);
        const value = { manifest: result.manifest, outcome: result.outcome, putImports: result.putImports, deleteImportIds: result.deleteImportIds,
          delta: result.delta, addProjects: result.addProjects.map(project => Object.fromEntries(Object.entries(project).map(([key, map]) =>
            [key, map instanceof Map ? [...map] : map]))) };
        result.release(); return value;
      } finally { input.release(); }
    };
    return { metered: await run(false), trusted: await run(true) };
  };

  it.each([['planner', () => createPlannerProject()], ['schema-7 pre-layer', legacyState]])('stages a %s import exactly like the metered preparation', async (_name, state) => {
    const { metered, trusted } = await preparePair({ type: 'stage-import', pendingImport: pendingInput(state(), `stage-${sequence + 1}`),
      attemptProvenance: { sourceKeyDigest: 'd'.repeat(64), payloadDigest: 'e'.repeat(64) } });
    expect(trusted).toEqual(metered);
    expect(trusted.outcome).toBe('staged');
  });

  it('stages through the sync preparation only', async () => {
    const metered = vi.spyOn(validation, 'preparePendingImportWork'), sync = vi.spyOn(validation, 'preparePendingImport');
    try {
      const captured = await capture();
      const request: WorkspaceBatch = { ...h.request({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'sync-only') }),
        expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
      const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
      try {
        const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
        metered.mockClear(); sync.mockClear();
        (await commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined, { requestDigest, hash: sha256Hex })).release();
      } finally { input.release(); }
      expect(metered).not.toHaveBeenCalled();
      expect(sync).toHaveBeenCalled();
    } finally { metered.mockRestore(); sync.mockRestore(); }
  });

  it('consumes beside another stored pending import exactly like the metered preparation', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(createPlannerProject(), 'kept') });
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'eaten') });
    const { metered, trusted } = await preparePair({ type: 'consume-import', importId: 'eaten' });
    expect(trusted).toEqual(metered);
    expect(trusted.outcome).toBe('consumed');
  });

  it('still refuses a corrupt descriptor on an untouched pending import', async () => {
    const captured = await capture();
    const kept = captured.manifest.pendingImports.find((row: any) => row.id === 'kept');
    expect(kept).toBeDefined();
    captured.manifest = { ...captured.manifest, pendingImports: captured.manifest.pendingImports.map((row: any) => row.id === 'kept' ? { ...row, recordDigest: '0'.repeat(64) } : row) };
    const request: WorkspaceBatch = { ...h.request({ type: 'activate-project', projectId: h.a.id }),
      expected: { revision: captured.manifest.revision, coreDigest: captured.manifest.coreDigest } };
    const w = makeWorkHarness(); const input = await commands.captureWorkspaceBatch(request, w.runtime);
    try {
      const requestDigest = await commands.hashTrustedWorkspaceRequest(input.batch, sha256Hex);
      await expect(commands.prepareWorkspaceMutation(captured, input.batch, h.preparation.now(), w.runtime, undefined, { requestDigest, hash: sha256Hex }))
        .rejects.toThrow();
    } finally { input.release(); }
  });
});
```

Note: the corrupt-descriptor test may fail earlier than the descriptor check (for example on the manifest core digest). Any rejection is the required behaviour; do not weaken it to accept success.

- [ ] **Step 2: Run tests to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace/normalized/trustedImport.test.ts -t "trusted import preparation"`
Expected: FAIL on `stages through the sync preparation only` (`preparePendingImportWork` is called). The equality tests may pass already, because nothing is trusted yet.

- [ ] **Step 3: Implement the trusted capture check**

In `workspaceCommands.ts`:

1. Extend the validation import with `preparePendingImport, validateMigratedState`, and the jsonWork import already has `canonicalText` and `copyEnumerableWork`.
2. Add, above `validateCapture`:

```ts
interface TrustedCaptureCheck { hash(text: string): Promise<string>; writtenImports?: readonly StoredPendingImport[] }
/** Trusted Import: validateCapture's pending-import row checks with the sync traversals and native digests.
 * A row this commit just wrote is proved by equal frame text; it was prepared once from the batch. */
async function checkTrustedImportRow(row: StoredPendingImport, manifest: NormalizedWorkspaceManifest, trusted: TrustedCaptureCheck): Promise<void> {
  const written = trusted.writtenImports?.find(value => value.id === row.id);
  if (written) {
    requireContract(envelopeFrameText('workspace-import-v1', row) === envelopeFrameText('workspace-import-v1', written), 'Pending import readback mismatch');
  } else {
    runSync(exactFieldsWork(row, ['id', 'pendingImport', 'position'], ['attemptProvenance', ''])); externalId(row.id); safeCounter(row.position);
    const pending = row.pendingImport;
    runSync(exactFieldsWork(pending, ['id', 'targetProjectId', 'name', 'state', 'createdAt', 'warnings'], ['cloud', '']));
    requireContract(Array.isArray(pending.warnings), 'Invalid retained import warnings');
    for (let i = 0; i < pending.warnings.length; i++) {
      if (i in pending.warnings) requireContract(typeof pending.warnings[i] === 'string', 'Invalid retained import warning');
    }
    const input = runSync(copyEnumerableWork(pending)) as unknown as Record<string, unknown>; delete input.warnings;
    validateMigratedState(pending.state); preparePendingImport(input, { warningPolicy: 'reject' });
    requireContract(row.id === pending.id, 'Pending import identity mismatch');
    if (row.attemptProvenance !== undefined) provenance(row.attemptProvenance, true);
  }
  const descriptor = manifest.pendingImports.find(value => value.id === row.id);
  requireContract(descriptor && canonicalText(descriptor) === canonicalText(await trustedImportDescriptor(row, trusted.hash)), 'Import descriptor mismatch');
}
```

3. Change `validateCapture`'s signature to `async function validateCapture(captured: CapturedWorkspaceCommand, batch: WorkspaceBatch, work: WorkRuntime, before = true, trusted?: TrustedCaptureCheck): Promise<void>` and make the pending-import loop start with:

```ts
  for (const row of captured.pendingImports) {
    if (trusted) { await work.run(effect(1, () => {})); await checkTrustedImportRow(row, captured.manifest, trusted); continue; }
    // ...existing metered checks unchanged...
```

(The `effect` keeps one cooperative checkpoint per row so cancellation and progress still run between rows.)

- [ ] **Step 4: Implement the trusted preparation branches**

In `prepareWorkspaceMutation`:

```ts
    await validateCapture(captured, batch, work, true, trusted ? { hash: trusted.hash } : undefined);
```

Add a local helper after `const requestDigest = ...`:

```ts
    // Trusted Import: native twin of hashFrame(work, 'proof', canonicalFrame(value)).
    const proofDigest = (value: unknown) => trusted ? trusted.hash(canonicalText(value)) : hashFrame(work, 'proof', canonicalFrame(value));
```

Then change exactly these sites:

- `setImport`: `const descriptor = trusted ? await trustedImportDescriptor(row, trusted.hash) : await importDescriptor(row, work);`
- `matchingPending`: `const digest = await proofDigest(pending);`
- `case 'stage-import'`: `const pending = trusted ? preparePendingImport(intent.pendingImport, { warningPolicy: 'retain' }) : await work.run(preparePendingImportWork(intent.pendingImport, { warningPolicy: 'retain' }));`
- `case 'replace-staged-import'`: the same for `replacement.pendingImport`, and in the old-row check replace `await hashFrame(work, 'proof', canonicalFrame(old.pendingImport))` with `await proofDigest(old.pendingImport)`.
- `case 'consume-import'`: `const digest = await proofDigest(pending);`
- The final weight: `owner.grow((trusted ? runSync(rawValueWeightWork({ manifest: next, putPresets, putImports, delta })) : await work.run(rawValueWeightWork({ manifest: next, putPresets, putImports, delta }))).bytes);`

Leave the `same(work, row.pendingImport, pending)` comparison in the `already-staged` branch metered (retry path).

- [ ] **Step 5: Run tests to verify they pass**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace/normalized/trustedImport.test.ts tests/unit/localWorkspace/normalized/workspaceCommands.test.ts tests/unit/localWorkspace/normalized/workspaceTransactions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/localWorkspace/normalized/workspaceCommands.ts tests/unit/localWorkspace/normalized/trustedImport.test.ts
git commit -m "perf(local-workspace): prepare staged and consumed imports once, natively

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Trusted post-write verification and native seal compare

**Files:**
- Modify: `services/localWorkspace/normalized/workspaceCommands.ts` (`verifyWorkspacePostconditions`, ~line 583 and the stage branch ~line 700)
- Modify: `services/localWorkspace/normalized/repository.ts` (`commitWorkspace` ~line 2100–2180, `sealWorkspaceCapture` ~line 1920)
- Test: `tests/unit/localWorkspace/normalized/trustedImport.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `TrustedCaptureCheck`, `checkTrustedImportRow`, `trustedImportDescriptor` (Task 2).
- Produces: `verifyWorkspacePostconditions(batch, current, receipt, work, trusted?: { requestDigest: string; written: readonly NormalizedProject[]; writtenImports?: readonly StoredPendingImport[]; hash?(text: string): Promise<string> })`; `sealWorkspaceCapture(..., options: { nativeProjectCompare?: boolean; nativeImportCompare?: boolean })`.

- [ ] **Step 1: Write the failing tests**

Append to `trustedImport.test.ts` (add `import { afterEach, beforeEach } from 'vitest';` to the top-level vitest import):

```ts
describe('trusted import commits', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());

  it('verifies a fresh stage by readback equality, preparing the input once', async () => {
    const metered = vi.spyOn(validation, 'preparePendingImportWork'), sync = vi.spyOn(validation, 'preparePendingImport');
    try {
      const result = await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'fresh') });
      expect(result.outcome).toBe('staged');
      expect(metered).not.toHaveBeenCalled();
      expect(sync.mock.calls.filter(([input]) => (input as { id?: string }).id === 'fresh')).toHaveLength(1);
    } finally { metered.mockRestore(); sync.mockRestore(); }
    const stored = (await physicalRows(h, ['pendingImports'])).pendingImports;
    expect(stored.map((row: any) => row.id)).toEqual(['fresh']);
  });

  it('refuses to acknowledge a stage whose durable readback differs from what was written', async () => {
    let fired = false;
    h.environment.workspaceReadResult = (operation, value) => {
      if (operation.phase !== 'verify-read' || operation.store !== 'pendingImports') return value;
      fired = true; const row = value as any; return { ...row, pendingImport: { ...row.pendingImport, name: 'Changed' } };
    };
    await expect(h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'tampered') })).rejects.toThrow('Pending import readback mismatch');
    expect(fired).toBe(true);
  });

  it('still answers a retried stage and a repeated consume with full verification', async () => {
    const pendingImport = pendingInput(legacyState(), 'retried');
    const attemptProvenance = { sourceKeyDigest: 'd'.repeat(64), payloadDigest: 'e'.repeat(64) };
    expect((await h.commit({ type: 'stage-import', pendingImport, attemptProvenance })).outcome).toBe('staged');
    const metered = vi.spyOn(validation, 'preparePendingImportWork');
    try {
      expect((await h.commit({ type: 'stage-import', pendingImport, attemptProvenance })).outcome).toBe('already-staged');
      expect(metered).toHaveBeenCalled();
    } finally { metered.mockRestore(); }
    expect((await h.commit({ type: 'consume-import', importId: 'retried' })).outcome).toBe('consumed');
    await h.commit({ type: 'activate-project', projectId: h.a.id });
    expect((await h.commit({ type: 'consume-import', importId: 'retried' })).outcome).toBe('already-consumed');
  });

  it('refuses a consume whose pending-import row changed between capture and seal', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'raced') });
    const [row] = (await physicalRows(h, ['pendingImports'])).pendingImports;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = h.indexedDB.open(h.databaseName); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    try {
      h.environment.workspaceFault = point => {
        // A transaction created now is ordered before the seal's own transaction on the same store.
        if (point.phase === 'before-cas') db.transaction('pendingImports', 'readwrite').objectStore('pendingImports')
          .put({ ...row, pendingImport: { ...row.pendingImport, name: 'Raced' } });
      };
      await expect(h.commit({ type: 'consume-import', importId: 'raced' })).rejects.toThrow('Workspace captured record changed');
    } finally { h.environment.workspaceFault = undefined; db.close(); }
  });

  it('stores the same rows through the trusted commit as the metered preparation describes', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(legacyState(), 'bytes') });
    const [row] = (await physicalRows(h, ['pendingImports'])).pendingImports;
    const [workspace] = (await physicalRows(h, ['workspace'])).workspace;
    const descriptor = workspace.pendingImports.find((value: any) => value.id === 'bytes');
    const w = makeWorkHarness();
    expect(descriptor.recordDigest).toBe(await hashFrame(w.runtime, 'proof', envelopeFrame('workspace-import-v1', row)));
    expect(descriptor.pendingImportDigest).toBe(await hashFrame(w.runtime, 'proof', canonicalFrame(row.pendingImport)));
    expect(row.pendingImport).toEqual(await makeWorkHarness().runtime.run(preparePendingImportWork(pendingInput(legacyState(), 'bytes'), { warningPolicy: 'retain' })));
  });
});
```

If `h.indexedDB` / `h.databaseName` are not exposed by `createWorkspaceCommandHarness`, read them from the normalization harness it spreads (`tests/helpers/normalizationHarness.ts` uses `h.indexedDB.open(h.databaseName)`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace/normalized/trustedImport.test.ts -t "trusted import commits"`
Expected: FAIL — the fresh stage calls `preparePendingImportWork` (verification re-prepares), and the tampered readback fails with `Staged import result mismatch` instead of `Pending import readback mismatch`. The raced consume may already pass through the metered compare; it pins the native compare added below.

- [ ] **Step 3: Trusted verification**

In `verifyWorkspacePostconditions`:

1. Widen the parameter: `trusted?: { requestDigest: string; written: readonly NormalizedProject[]; writtenImports?: readonly StoredPendingImport[]; hash?(text: string): Promise<string> }`.
2. First line inside `try`: `const importCheck = trusted?.hash ? { hash: trusted.hash, writtenImports: trusted.writtenImports ?? [] } : undefined;` and call `await validateCapture(current, batch, work, false, importCheck);`.
3. In `case 'stage-import': case 'replace-staged-import':` restructure so the consumed-member scan runs first, then branch:

```ts
        const input = intent.type === 'stage-import' ? intent.pendingImport : intent.replacement.pendingImport;
        const row = await work.run(findWork(current.pendingImports, input.id, value => value.id));
        let consumed: WorkspaceMember | undefined;
        for (const member of manifest.members) {
          await work.run(effect(1, () => {}));
          if (member.consumedImport.consumedImportId !== undefined
            && (await work.run(compareStringsWork(member.consumedImport.consumedImportId, input.id))) === 0) {
            requireContract(!consumed, 'Ambiguous consumed result'); consumed = member;
          }
        }
        const written = importCheck?.writtenImports.find(value => value.id === input.id);
        if (written && (outcome === 'staged' || outcome === 'replaced')) {
          // Trusted Import: validateCapture proved this row equals the row this commit prepared once and wrote.
          requireContract(row && !consumed, 'Staged import result mismatch');
          pendingImports.push(row.pendingImport);
        } else {
          const provenanceInput = intent.type === 'stage-import' ? intent.attemptProvenance : intent.replacement.attemptProvenance;
          const expected = await work.run(preparePendingImportWork(input, { warningPolicy: 'retain' }));
          const digest = await hashFrame(work, 'proof', canonicalFrame(expected));
          const expectedAttempt = provenanceInput ? { ...provenanceInput, pendingImportDigest: digest } : undefined;
          // ...the existing already-consumed / staged checks, unchanged, using row, consumed, expected, digest, expectedAttempt...
        }
        if (intent.type === 'replace-staged-import') requireContract(!(await work.run(findWork(manifest.pendingImports, intent.expected.importId, value => value.id))), 'Replaced import remains');
        break;
```

Keep the existing two inner branches (`if (outcome === 'already-consumed') {...} else {...}`) verbatim inside the `else`.

- [ ] **Step 4: Repository wiring and native seal compare**

In `repository.ts` `commitWorkspace`:

- The seal call becomes `await sealWorkspaceCapture(capture, work, prepared, () => { ...unchanged... }, { nativeImportCompare: true });`
- The verification call becomes:

```ts
        const verified = await verifyWorkspacePostconditions(input.batch, after, prepared.manifest.lastCommit!, work,
          { requestDigest, written: prepared.addProjects, writtenImports: prepared.putImports, hash });
```

In `sealWorkspaceCapture`, widen `options` to `{ nativeProjectCompare?: boolean; nativeImportCompare?: boolean }` and add, inside `compare`, directly after the `nativeProjectCompare` block:

```ts
          if (options.nativeImportCompare && selection.store === 'pendingImports') {
            // Trusted Import: the native twin of envelopeFrame's text; equal text is an equal frame.
            const text = envelopeFrameText('workspace-seal', value as object);
            try {
              complete = text === envelopeFrameText('workspace-seal', before.value as object);
              requireContract(complete, 'Workspace captured record changed');
            } finally {
              work.note('primitiveExceptions'); work.note('sealRows'); work.note('sealBytes', text.length);
              if (!complete) work.note('unmeasuredValues');
            }
            return;
          }
```

Add `envelopeFrameText` to the `./work` import in `repository.ts`. `prepareWorkspaceMutation` is already called with `{ requestDigest, hash }` in `commitWorkspace`; leave the recovery and inspection call sites untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace`
Expected: PASS. If an existing test pinned the metered re-preparation in `commitWorkspace` (for example by counting `preparePendingImportWork` calls), update it to pin the trusted behaviour and name it in the commit message.

- [ ] **Step 6: Commit**

```bash
git add services/localWorkspace/normalized/workspaceCommands.ts services/localWorkspace/normalized/repository.ts tests/unit/localWorkspace/normalized/trustedImport.test.ts
git commit -m "perf(local-workspace): verify staged imports against the written row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Trusted post-commit workspace read

**Files:**
- Modify: `services/localWorkspace/normalized/repository.ts` (`NormalizedRepository` interface ~line 101; `createNormalizationSession` return ~line 1525; trusted reads ~line 1270–1325; `readActiveSnapshot` ~line 1551; repository export object ~line 3147)
- Modify: `services/localWorkspace/workspaceStartupProtocol.ts`, `services/localWorkspace/normalized/startup.ts`, `services/localWorkspace/workspaceStartup.ts`
- Modify: `services/localWorkspace/NormalizedWorkspaceStore.ts` (`snapshot()` ~line 141)
- Test: `tests/unit/localWorkspace/normalized/trustedImport.test.ts`, `tests/unit/localWorkspace/normalized/normalEditorStore.test.ts`

**Interfaces:**
- Produces: `NormalizedRepository.readTrustedActiveSnapshot(work?: WorkRuntime): Promise<ActiveRead | undefined>`; startup operation `'trusted-active'`; `createWorkspaceStartupRepository(...)` facade gains `readTrustedActiveSnapshot`.

- [ ] **Step 1: Write the failing tests**

Append to `trustedImport.test.ts` (add `import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';` and `import { mutateRow } from '../../../helpers/normalizationHarness';` to the imports):

```ts
describe('trusted active read', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());
  const both = async () => {
    const repository = createNormalizedRepository(h.environment) as any;
    return { metered: await repository.readActiveSnapshot(), trusted: await repository.readTrustedActiveSnapshot() };
  };

  it('returns exactly the metered active read after stage, consume, a preset save and a saved edit', async () => {
    await h.commit({ type: 'stage-import', pendingImport: pendingInput(createPlannerProject(), 'planner') });
    let { metered, trusted } = await both(); expect(trusted).toEqual(metered);
    await h.commit({ type: 'consume-import', importId: 'planner' });
    ({ metered, trusted } = await both()); expect(trusted).toEqual(metered);
    await h.commit({ type: 'save-custom-preset', preset: { id: 'preset', title: 'Preset', desc: '', isCustom: true, initialState: makeIncrementalProject(2).initialState } });
    ({ metered, trusted } = await both()); expect(trusted).toEqual(metered);
    const created = await h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'edited' } });
    const material = created.projects[0];
    await h.repository.bindAdmittedProject(material.records);
    const root = (await both()).metered.snapshot.projects.find((project: any) => project.id === 'edited').initialState.nodes.root;
    await h.repository.commitDocument({ scope: material.scope, clientId: 'trusted-read', commitGeneration: 1, commitId: 'edit-1', editorGeneration: 1,
      expectedRevision: 0, changes: [{ type: 'put-node', node: { ...root, title: 'Saved edit' } }] });
    ({ metered, trusted } = await both());
    expect(trusted).toEqual(metered);
    expect(trusted.snapshot.projects.find((project: any) => project.id === 'edited').initialState.nodes.root.title).toBe('Saved edit');
  });

  it('refuses an active generation without exactly one workspace row', async () => {
    await mutateRow(h, 'workspace', store => store.clear());
    await expect((createNormalizedRepository(h.environment) as any).readTrustedActiveSnapshot()).rejects.toThrow('Invalid active workspace');
  });
});
```

Append to `tests/unit/localWorkspace/normalized/normalEditorStore.test.ts`:

```ts
it('returns a fresh trusted workspace read after a structural commit, not the metered reopen', async () => {
  expect(initial.status).toBe('ready');
  requests = [];
  const pendingImport = { id: 'store-import', targetProjectId: 'store-target', name: 'Store import',
    state: initial.snapshot.projects[0].initialState, createdAt: '2026-10-14T00:00:00.000Z' };
  const staged = await store.commit({ type: 'stage-import', pendingImport });
  expect(requests).toContain('trusted-active');
  expect(requests).not.toContain('active');
  const { createNormalizedRepository } = await import('../../../../services/localWorkspace/normalized/repository');
  expect(staged).toEqual((await createNormalizedRepository(h.environment).readActiveSnapshot())!.snapshot);
  requests = [];
  const consumed = await store.commit({ type: 'consume-import', importId: 'store-import' });
  expect(requests).not.toContain('active');
  expect(consumed.projects.some((project: any) => project.id === 'store-target')).toBe(true);
  expect(consumed).toEqual((await createNormalizedRepository(h.environment).readActiveSnapshot())!.snapshot);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace/normalized/trustedImport.test.ts tests/unit/localWorkspace/normalized/normalEditorStore.test.ts`
Expected: FAIL — `readTrustedActiveSnapshot is not a function`; the store test sees `'active'` and no `'trusted-active'`.

- [ ] **Step 3: Implement `trustedActiveRead` in the repository**

In `createNormalizationSession` (next to `trustedWorkspaceAdmission`), lift the `ordered` helper out of `trustedWorkspaceAdmission` into a sibling function that both use:

```ts
    /** Ancillary rows ordered by position and matched to their manifest descriptors by id and position. */
    function trustedAncillary<T extends { position: number }>(rows: Map<string, unknown[]>, name: 'presets' | 'pendingImports',
      descriptors: readonly { id: string; position: number }[]): T[] {
      const live = [...rows.get(name)! as T[]].sort((a, b) => a.position - b.position);
      if (live.length !== descriptors.length) trustedFailure('Active ancillary membership mismatch');
      live.forEach((row, index) => {
        const descriptor = descriptors[index], id = (row as { id?: unknown }).id;
        if (typeof id !== 'string' || id !== descriptor.id || row.position !== descriptor.position) trustedFailure('Active ancillary descriptor mismatch');
      });
      return live;
    }
```

Replace the body of the old `ordered` closure in `trustedWorkspaceAdmission` with calls to `trustedAncillary(rows, 'presets', workspace.presets)` / `trustedAncillary(rows, 'pendingImports', workspace.pendingImports)`.

Then add:

```ts
    /** Trusted Import: a structural commit's fresh durable snapshot, read the way a trusted open
     * admits the workspace: one readonly transaction, each project reconstructed once with the
     * plain codec and its fold record checked. */
    async function trustedActiveRead(): Promise<ActiveRead | undefined> {
      const captured = await trustedCapture();
      if (!captured) return undefined;
      const { marker, workspace, images, rows } = captured;
      const projects = new Map<string, WorkspaceProject>();
      for (const member of workspace.members) projects.set(member.projectId, (await trustedProject(images.get(member.projectId)!)).external);
      const presets = trustedAncillary<{ position: number; preset: WorkspaceSnapshot['customPresets'][number] }>(rows, 'presets', workspace.presets);
      const pendingImports = trustedAncillary<StoredPendingImport>(rows, 'pendingImports', workspace.pendingImports);
      const order = runSync(projectWorkspaceOrderWork(workspace));
      work.assertCurrent();
      const snapshot: WorkspaceSnapshot = { projects: order.projectOrder.map(id => projects.get(id)!), activeProjectId: order.activeProjectId,
        customPresets: presets.map(row => row.preset), pendingImports: pendingImports.map(row => row.pendingImport) };
      return { authority: marker as ActiveAuthority, workspace, snapshot,
        source: { kind: marker.sourceKind, acceptedLegacyDigest: workspace.legacyAcceptance.kind === 'accepted' ? workspace.legacyAcceptance.digest : null } };
    }
```

Expose it from the context object returned by `createNormalizationSession`: `trustedActive: () => operation('reopen', () => trustedActiveRead()),`.

Below `readActiveSnapshot` add `const readTrustedActiveSnapshot = (work?: WorkRuntime) => withRead(work, context => context.trustedActive());`, add `readTrustedActiveSnapshot(work?: WorkRuntime): Promise<ActiveRead | undefined>;` to the `NormalizedRepository` interface next to `readActiveSnapshot`, and add `readTrustedActiveSnapshot` to the repository's returned object next to `readActiveSnapshot`.

If the equality test shows a difference against the metered read (for example `source.kind` from `marker.sourceKind` vs `pass.source.kind`, project order, or a field the metered reconstructor attaches), make the trusted read produce the metered value. Do not change `readActiveSnapshot`.

- [ ] **Step 4: Route `'trusted-active'` through the worker startup protocol**

`workspaceStartupProtocol.ts`: add `'trusted-active'` to the `StartupOperation` union and to the `operations` array.

`normalized/startup.ts`, in the operation switch:

```ts
            case 'trusted-active': value = await repository.readTrustedActiveSnapshot(current.work); break;
```

`workspaceStartup.ts`: add `'readTrustedActiveSnapshot'` to the `Pick<NormalizedRepository, ...>` in `createWorkspaceStartupRepository`'s return type and to the returned object:

```ts
    async readTrustedActiveSnapshot(work) { const owner = open(work); try { return await owner.call('trusted-active') as Awaited<ReturnType<NormalizedRepository['readTrustedActiveSnapshot']>>; } finally { owner.close(); } },
```

If `validateStartupReply` or any other switch over `StartupOperation` needs an arm for the new operation, give it the same treatment as `'active'`.

- [ ] **Step 5: Use it for the post-commit read**

In `NormalizedWorkspaceStore.ts`, `snapshot()`:

```ts
  async function snapshot(): Promise<WorkspaceSnapshot> {
    current(); const read = async () => {
      // Trusted Import: a fresh durable read of the active generation, the way trusted open reads it.
      const active = await repository.readTrustedActiveSnapshot(); current();
      if (!active) throw new WorkspaceStoreError('No verified normalized workspace.', 'authority-lost'); return active.snapshot;
    };
    return session ? session.exclusiveRead(read) : read();
  }
```

Leave the other `readActiveSnapshot` calls in this file (legacy drift, recovery) unchanged.

- [ ] **Step 6: Run tests to verify they pass**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/localWorkspace tests/unit/NormalizedWorkspaceBootstrapGate.test.tsx tests/unit/importProject.test.ts tests/unit/localWorkspaceBoundary.test.ts`
Expected: PASS. Update any test that pins the startup operation list or the store's request sequence (`'active'` after a structural commit) to the new `'trusted-active'`, and name it in the commit message.

- [ ] **Step 7: Commit**

```bash
git add services/localWorkspace tests/unit
git commit -m "perf(local-workspace): read the workspace after a structural commit the trusted way

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Measure, verify end to end, record the result

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-trusted-import-design.md` (add `## Result`)
- Scratch only (never commit): `tests/benchtmp/importBench.test.ts`, copied from `/media/anoop/ssd_1/Work/doctect/doctect/.superpowers/bench/trusted-import/importBench.test.ts`

- [ ] **Step 1: Node bench**

```bash
mkdir -p tests/benchtmp && cp /media/anoop/ssd_1/Work/doctect/doctect/.superpowers/bench/trusted-import/importBench.test.ts tests/benchtmp/
TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/benchtmp/importBench.test.ts 2>&1 | grep -aoE "(stage|consume\(fresh\)|readmit): [0-9]+ms[^\x1b]*"
```

Expected: `stage` ≤ 2000ms and `consume(fresh)` ≤ 2000ms (before: 10318ms and 5734ms). If a number misses its target, profile with `PROF_DIR=<dir>` (the bench writes `.cpuprofile` files; summarize with `node /media/anoop/ssd_1/Work/doctect/doctect/.superpowers/bench/trusted-import/prof-sum.cjs <file>`) and report the remaining hot spots instead of widening scope.

Then `rm -rf tests/benchtmp`.

- [ ] **Step 2: Full unit suite and type check**

```bash
TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run
npx tsc --noEmit -p .
```

Expected: all pass (the known `accountModeration.test.js` beforeAll timeout under load may flake; rerun that file alone to confirm).

- [ ] **Step 3: Chromium e2e**

```bash
TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp E2E_WEB_PORT=4410 E2E_API_PORT=4411 npx playwright test --project=chromium
git checkout -- server/analytics.db
```

Expected: all pass, including `tests/e2e/gallery.spec.js` "opens a project published before layers existed in the editor" and the fork tests.

- [ ] **Step 4: Browser click-to-editor timing**

Start a dev server from this worktree on spare ports (SQLite, never the main checkout's `.env`). The preview worktree's Vite config sits at the same depth, so its certificate path still resolves; copy it with the ports changed (untracked scratch under `.superpowers/`, never commit):

```bash
mkdir -p .superpowers/dev-lan
sed -e 's/port: 4510/port: 4520/' -e 's#127.0.0.1:4511#127.0.0.1:4521#' \
  ../preview-lan/.superpowers/dev-lan/vite.lan.config.ts > .superpowers/dev-lan/vite.lan.config.ts
env -u DATABASE_URL PORT=4521 RESEND_API_KEY= SIGNUP_CAP= CLIENT_URL=https://localhost:4520 BETTER_AUTH_URL=https://localhost:4520/api/auth \
  TRUSTED_ORIGINS=https://localhost:4520 npx concurrently --kill-others -n api,web "node server/index.js" "npx vite --config .superpowers/dev-lan/vite.lan.config.ts"
```

Run it in the background and wait until `https://localhost:4520/` answers. The tracked `server/analytics.db` already holds the published 2026 Planner (the API logs `[gallery-index] indexed 1 project(s)`); if `/gallery` shows no "Open in editor" button, stop and report instead of publishing data by hand. Then:

```bash
node /media/anoop/ssd_1/Work/doctect/doctect/.superpowers/bench/trusted-import/e2e-timing.cjs https://localhost:4520
```

Expected: `EDITOR project-tab visible` ≤ 8000ms (before: 33087ms). Stop the server, `rm -rf .superpowers/dev-lan`, and run `git checkout -- server/analytics.db`.

- [ ] **Step 5: Record the result in the spec**

Append to the spec:

```markdown
## Result

| 2026 Planner gallery project | before | after |
|---|---|---|
| click → editor, Chromium dev build, desktop | 33s | <measured>s |
| Node bench `stage-import` | 10.3s | <measured>s |
| Node bench `consume-import` | 5.7s | <measured>s |
```

Replace each `<measured>` with the number from Steps 1 and 4.

- [ ] **Step 6: Commit, then regenerate the onboarding bundle as the last commit**

```bash
git add docs/superpowers/specs/2026-10-14-trusted-import-design.md
git commit -m "docs(spec): record trusted import result

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
node onboarding/build.mjs
git add onboarding/index.html
git commit -m "chore(onboarding): regenerate bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short   # expect clean apart from untracked scratch; server/analytics.db unmodified
```

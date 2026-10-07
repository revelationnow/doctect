// Dependency-free: server callers can drain the same programs synchronously.
const phases = new Set(['discovery', 'prerequisite', 'prepare', 'reserve', 'stage',
  'verify', 'activate', 'reopen', 'retained', 'recovery', 'legacy-fence']);
const stores = new Set(['none', 'source', 'backup', 'target', 'marker']);
const frames = new Set(['none', 'source', 'target', 'proof', 'stage', 'marker', 'legacy']);
const natives = new Set(['clone', 'parse', 'keys', 'scalar', 'sort', 'idb-record',
  'record-compare', 'release', 'compat-json']);
const metrics = [
  'visits', 'emittedBytes', 'sortComparisons', 'comparedCodeUnits',
  'yields', 'checks', 'observedAborts', 'primitiveExceptions',
  'candidateRows', 'candidateBytes', 'sealRows', 'sealBytes', 'metadataRows', 'metadataBytes', 'unmeasuredValues',
  'pageTransactions', 'sealTransactions', 'eofChecks', 'markerCasRows',
  'markerBytes', 'markerWorkBytes', 'writes', 'stageTransactions', 'stageRecords',
  'sourceDerivations', 'targetDerivations', 'projectReconstructions',
  'frameBytes', 'hashBytes', 'sourceHashBytes', 'targetHashBytes',
  'proofHashBytes', 'stageHashBytes', 'markerHashBytes', 'legacyHashBytes',
  'legacyCaptures', 'legacyReads', 'legacyReadBytes', 'backupValidations',
  'retries', 'ownedBytes', 'ownedHighWater', 'captureGraphs', 'captureHighWater',
];
const metricNames = new Set(metrics);
const executors = new WeakSet();
const visitLimit = 1024;
const byteLimit = 65536;

function enumValue(values, value) {
  if (!values.has(value)) throw new TypeError('Invalid work protocol enum');
}

function finiteNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Work counter must be finite');
  }
}

function nonnegativeInteger(value) {
  finiteNumber(value);
  if (!Number.isInteger(value) || value < 0) throw new RangeError('Invalid work cost');
}

function operationFields(operation) {
  // Capture once: budget validation and execution use exactly the same fields.
  const { visits, utf8Bytes, nativeKind, metric, run } = operation;
  nonnegativeInteger(visits);
  nonnegativeInteger(utf8Bytes);
  if (visits < 1 || visits > visitLimit || utf8Bytes > byteLimit) {
    throw new RangeError('Work operation exceeds quantum');
  }
  if (nativeKind !== undefined) enumValue(natives, nativeKind);
  if (metric !== undefined) enumValue(metricNames, metric);
  if (typeof run !== 'function') throw new TypeError('Work operation must be synchronous');
  return { visits, utf8Bytes, nativeKind, metric, run };
}

function synchronousResult(value) {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function') {
    // A rejected native Promise must not create an unrelated unhandled rejection.
    Promise.resolve(value).catch(() => {});
    throw new TypeError('Work operation returned a thenable');
  }
  return value;
}

export function* effect(visits, run, utf8Bytes = 0, metric) {
  return yield { visits, utf8Bytes, run, metric };
}

export function* primitive(nativeKind, run) {
  return yield { visits: 1, utf8Bytes: 0, nativeKind, run };
}

export function* retainWork(bytes) {
  return yield {
    visits: 1, utf8Bytes: 0,
    run(runtime) {
      if (runtime === undefined) return { grow() {}, release() {} };
      assertWorkRuntime(runtime);
      return runtime.own(bytes);
    },
  };
}

export function runSync(program) {
  let done = false;
  try {
    let step = program.next();
    while (!step.done) {
      let value;
      try {
        const operation = operationFields(step.value);
        value = synchronousResult(operation.run(undefined));
      } catch (error) {
        step = program.throw(error);
        continue;
      }
      step = program.next(value);
    }
    done = true;
    return step.value;
  } finally {
    if (!done) program.return(undefined);
  }
}

function abortError() {
  return new DOMException('Work runtime disposed', 'AbortError');
}

// Private numeric wakeups only. No document payload or port leaves this queue.
function createTaskScheduler() {
  let channel;
  let timer;
  let pending;
  let disposed = false;
  function finish() {
    const task = pending;
    pending = undefined;
    timer = undefined;
    channel?.port1.unref?.();
    channel?.port2.unref?.();
    task?.resolve();
  }
  return {
    yieldTask() {
      if (disposed) return Promise.reject(abortError());
      if (pending) return Promise.reject(new Error('Task already pending'));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        try {
          if (typeof MessageChannel === 'function') {
            if (!channel) {
              channel = new MessageChannel();
              channel.port1.onmessage = finish;
            }
            channel.port1.ref?.();
            channel.port2.ref?.();
            channel.port2.postMessage(0);
          } else {
            timer = setTimeout(finish, 0);
          }
        } catch (error) {
          pending = undefined;
          reject(error);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      channel?.port1.close();
      channel?.port2.close();
      const task = pending;
      pending = undefined;
      channel = undefined;
      timer = undefined;
      task?.reject(abortError());
    },
  };
}

function emptyCounters() {
  return Object.fromEntries(metrics.map(metric => [metric, 0]));
}

export function assertWorkRuntime(value) {
  if (!executors.has(value)) throw new TypeError('Expected authentic WorkRuntime');
}

export function createWorkRuntime(control) {
  const { assertCurrent: controlGuard, yieldTask: injectedYield, observe } = control;
  if (typeof controlGuard !== 'function'
    || injectedYield !== undefined && typeof injectedYield !== 'function'
    || observe !== undefined && typeof observe !== 'function') {
    throw new TypeError('Invalid work control');
  }
  const scheduler = createTaskScheduler();
  const yieldTask = injectedYield ?? scheduler.yieldTask;
  const guards = new Map();
  const globalCounters = emptyCounters();
  const phaseCounters = new Map([...phases].map(phase => [phase, emptyCounters()]));
  let phase = 'prepare', storeClass = 'none', frameKind = 'none';
  let quantumVisits = 0, quantumBytes = 0, quietDepth = 0;
  let stopped = false, lifecycleError, running = false;

  function increment(metric, amount = 1, owner = phase) {
    globalCounters[metric] += amount;
    phaseCounters.get(owner)[metric] += amount;
  }

  function stop(error) {
    if (!stopped) {
      stopped = true;
      lifecycleError = error;
      increment('observedAborts');
      scheduler.dispose();
    }
  }

  function assertCurrent() {
    if (stopped) throw lifecycleError;
    // These hot counters use fixed properties; keep generic accounting for
    // dynamic metrics and ownership attributed to an earlier phase.
    globalCounters.checks++;
    phaseCounters.get(phase).checks++;
    try {
      controlGuard();
      for (const guard of guards.values()) guard();
    } catch (error) {
      stop(error);
      throw lifecycleError;
    }
    // A guard can dispose the runtime without itself throwing.
    if (stopped) throw lifecycleError;
  }

  function snapshot(owner) {
    if (owner !== undefined) enumValue(phases, owner);
    return Object.freeze({ ...(owner === undefined ? globalCounters : phaseCounters.get(owner)) });
  }

  function notify(kind = 'work') {
    assertCurrent();
    if (kind !== 'work' && kind !== 'durable') throw new TypeError('Invalid work event kind');
    if (!quietDepth && observe) {
      const event = Object.freeze({ phase, storeClass, frameKind, kind, counters: snapshot() });
      try {
        const result = observe(event);
        if (result !== null && (typeof result === 'object' || typeof result === 'function')
          && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
      } catch {
        // Passive observers cannot determine execution or publication.
      }
    }
    assertCurrent();
  }

  async function run(program) {
    if (running) throw new Error('Reentrant work run');
    running = true;
    let done = false;
    function advance(method, value) {
      assertCurrent();
      try { return program[method](value); }
      finally { assertCurrent(); }
    }
    try {
      let step = advance('next', undefined);
      while (!step.done) {
        let value;
        try {
          assertCurrent();
          const operation = operationFields(step.value);
          assertCurrent();
          if (quantumVisits + operation.visits > visitLimit
            || quantumBytes + operation.utf8Bytes > byteLimit) {
            notify();
            assertCurrent();
            try { await yieldTask(); }
            finally { assertCurrent(); }
            increment('yields');
            quantumVisits = 0;
            quantumBytes = 0;
          }
          assertCurrent();
          quantumVisits += operation.visits;
          quantumBytes += operation.utf8Bytes;
          globalCounters.visits += operation.visits;
          phaseCounters.get(phase).visits += operation.visits;
          globalCounters.emittedBytes += operation.utf8Bytes;
          phaseCounters.get(phase).emittedBytes += operation.utf8Bytes;
          if (operation.metric !== undefined) increment(operation.metric);
          if (operation.nativeKind !== undefined) increment('primitiveExceptions');
          try { value = synchronousResult(operation.run(runtime)); }
          finally { assertCurrent(); }
        } catch (error) {
          // Guard failures are never delivered to application catch blocks.
          assertCurrent();
          step = advance('throw', error);
          continue;
        }
        step = advance('next', value);
      }
      done = true;
      assertCurrent();
      return step.value;
    } finally {
      try {
        if (!done) program.return(undefined);
      } finally {
        running = false;
        // Cleanup errors cannot replace latched lifecycle loss.
        if (stopped) throw lifecycleError;
      }
    }
  }

  const runtime = {
    run,
    async wait(operation) {
      if (running) throw new Error('Cannot wait during active work run');
      assertCurrent();
      try { return await operation(); }
      finally { assertCurrent(); }
    },
    assertCurrent,
    addGuard(guard) {
      assertCurrent();
      if (typeof guard !== 'function') throw new TypeError('Invalid work guard');
      const token = {};
      guards.set(token, guard);
      return () => { guards.delete(token); };
    },
    setContext(nextPhase, nextStore, nextFrame) {
      assertCurrent();
      if (nextPhase !== undefined) enumValue(phases, nextPhase);
      if (nextStore !== undefined) enumValue(stores, nextStore);
      if (nextFrame !== undefined) enumValue(frames, nextFrame);
      if (nextPhase !== undefined) {
        phase = nextPhase;
        storeClass = nextStore ?? 'none';
        frameKind = nextFrame ?? 'none';
      } else {
        if (nextStore !== undefined) storeClass = nextStore;
        if (nextFrame !== undefined) frameKind = nextFrame;
      }
    },
    context: () => Object.freeze({ phase, storeClass, frameKind }),
    note(metric, amount = 1) {
      enumValue(metricNames, metric);
      finiteNumber(amount);
      if ((metric === 'ownedHighWater' || metric === 'captureHighWater') && amount < 0) {
        throw new RangeError('Highwater counters cannot decrease');
      }
      increment(metric, amount);
    },
    snapshot,
    notify,
    async quiet(operation) {
      quietDepth++;
      try { return await operation(); }
      finally { quietDepth--; }
    },
    own(bytes, captureGraph = false) {
      assertCurrent();
      nonnegativeInteger(bytes);
      if (typeof captureGraph !== 'boolean') throw new TypeError('Invalid capture graph flag');
      const owner = phase;
      increment('ownedBytes', bytes, owner);
      if (captureGraph) increment('captureGraphs', 1, owner);
      for (const counters of [globalCounters, phaseCounters.get(owner)]) {
        counters.ownedHighWater = Math.max(counters.ownedHighWater, counters.ownedBytes);
        counters.captureHighWater = Math.max(counters.captureHighWater, counters.captureGraphs);
      }
      let released = false;
      return {
        grow(delta) {
          assertCurrent();
          if (released) throw new Error('Ownership already released');
          nonnegativeInteger(delta);
          bytes += delta;
          increment('ownedBytes', delta, owner);
          for (const counters of [globalCounters, phaseCounters.get(owner)]) {
            counters.ownedHighWater = Math.max(counters.ownedHighWater, counters.ownedBytes);
          }
        },
        release() {
          if (released) return;
          released = true;
          increment('ownedBytes', -bytes, owner);
          if (captureGraph) increment('captureGraphs', -1, owner);
        },
      };
    },
    stopped: () => stopped,
    dispose() { stop(abortError()); },
  };
  for (const method of Object.values(runtime)) Object.freeze(method);
  Object.freeze(runtime);
  executors.add(runtime);
  return runtime;
}

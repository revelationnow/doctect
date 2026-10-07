import { afterEach } from 'vitest';
import { createWorkRuntime, type Phase, type WorkEvent, type WorkRuntime } from '../../shared/cooperativeWork.js';

const runtimes: WorkRuntime[] = [];
afterEach(() => { for (const runtime of runtimes) runtime.dispose(); runtimes.length = 0; });

export function makeWorkHarness(phase: Phase = 'prepare', timerTasks = false) {
  let cancelled = false;
  let observer: ((event: WorkEvent) => void) | undefined;
  const events: WorkEvent[] = [];
  const runtime = createWorkRuntime({
    assertCurrent: () => { if (cancelled) throw new DOMException('cancelled', 'AbortError'); },
    ...(timerTasks ? { yieldTask: () => new Promise<void>(resolve => setTimeout(resolve, 0)) } : {}),
    observe: event => { events.push(event); return observer?.(event); },
  });
  runtime.setContext(phase); runtimes.push(runtime);
  return { runtime, events, cancel: () => { cancelled = true; },
    observe: (next?: typeof observer) => { observer = next; } };
}

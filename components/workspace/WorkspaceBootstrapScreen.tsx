import { Check, Circle, Database, LoaderCircle } from 'lucide-react';
import type { WorkspaceBootstrapPhase } from '../../services/localWorkspace/index';

export const PHASE_LABELS: Record<WorkspaceBootstrapPhase, string> = {
  'opening-local-storage': 'Opening project storage',
  'checking-existing-projects': 'Checking saved projects',
  'copying-projects': 'Preparing saved projects',
  'verifying-projects': 'Checking project data',
  'finishing-upgrade': 'Getting the editor ready',
};

export type OpeningStep = 'workspace' | 'download' | 'prepare' | 'editor';

export const GALLERY_OPEN_STEPS: readonly OpeningStep[] = ['workspace', 'download', 'prepare', 'editor'];

export const PENDING_OPEN_STEPS: readonly OpeningStep[] = ['workspace', 'prepare', 'editor'];

export interface OpeningProgress {
  name: string;
  steps: readonly OpeningStep[];
  step: OpeningStep;
}

const STEP_LABELS: Record<OpeningStep, string> = {
  workspace: 'Opening your projects',
  download: 'Downloading the project',
  prepare: 'Preparing the project',
  editor: 'Opening the editor',
};

type StepState = 'done' | 'current' | 'upcoming';

const STEP_TEXT_CLASSES: Record<StepState, string> = {
  done: 'text-slate-500',
  current: 'font-medium text-blue-800',
  upcoming: 'text-slate-400',
};

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return <Check className="size-5" aria-hidden="true" />;
  }
  if (state === 'current') {
    return (
      <LoaderCircle
        className="size-5 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }
  return <Circle className="size-5" aria-hidden="true" />;
}

interface WorkspaceBootstrapScreenProps {
  phase: WorkspaceBootstrapPhase;
  opening?: OpeningProgress;
  overlay?: boolean;
}

export function WorkspaceBootstrapScreen({ phase, opening, overlay }: WorkspaceBootstrapScreenProps) {
  const mainClassName = overlay
    ? 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 sm:px-6'
    : 'flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 sm:px-6';

  if (!opening) {
    return (
      <main className={mainClassName} aria-labelledby="workspace-bootstrap-heading">
        <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.45)] sm:p-8">
          <div className="mb-5 flex size-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Database className="size-6" aria-hidden="true" />
          </div>
          <h1
            id="workspace-bootstrap-heading"
            className="text-2xl font-bold tracking-tight text-slate-900"
          >
            Opening your projects
          </h1>
          <p className="mt-3 max-w-[68ch] text-sm leading-6 text-slate-600 sm:text-base">
            Doctect is checking your saved projects before opening the editor.
          </p>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-7 flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800"
          >
            <LoaderCircle
              className="size-5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>{PHASE_LABELS[phase]}</span>
          </div>
        </section>
      </main>
    );
  }

  const currentIndex = opening.steps.indexOf(opening.step);
  const stateOf = (index: number): StepState =>
    index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
  const heading = opening.name ? `Opening “${opening.name}”` : 'Opening your project';
  const statusText = opening.step === 'workspace'
    ? `${STEP_LABELS[opening.step]} — ${PHASE_LABELS[phase]}`
    : STEP_LABELS[opening.step];

  return (
    <main className={mainClassName} aria-labelledby="workspace-bootstrap-heading">
      <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.45)] sm:p-8">
        <div className="mb-5 flex size-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Database className="size-6" aria-hidden="true" />
        </div>
        <h1
          id="workspace-bootstrap-heading"
          className="text-2xl font-bold tracking-tight text-slate-900"
        >
          {heading}
        </h1>
        <p className="mt-3 max-w-[68ch] text-sm leading-6 text-slate-600 sm:text-base">
          Getting everything ready. This can take a few seconds on a phone.
        </p>
        <ol className="mt-7 space-y-3 text-sm">
          {opening.steps.map((step, index) => {
            const state = stateOf(index);
            return (
              <li
                key={step}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                className={`flex items-center gap-3 ${STEP_TEXT_CLASSES[state]}`}
              >
                <StepIcon state={state} />
                <span>{STEP_LABELS[step]}</span>
              </li>
            );
          })}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">
          {statusText}
        </p>
      </section>
    </main>
  );
}

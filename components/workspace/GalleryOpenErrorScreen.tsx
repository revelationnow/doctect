import { AlertTriangle } from 'lucide-react';

interface GalleryOpenErrorScreenProps {
  name: string;
  onRetry(): void;
  onContinue(): void;
  onBack(): void;
}

const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

/** Gallery Direct Open, spec section 2: the download failed or the create was refused. The commit is atomic, so
 * nothing was added; the user can retry, open the workspace as it is, or go back to the listing. */
export function GalleryOpenErrorScreen({ name, onRetry, onContinue, onBack }: GalleryOpenErrorScreenProps) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 sm:px-6"
      aria-labelledby="gallery-open-error-heading"
    >
      <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.45)] sm:p-8">
        <div className="mb-5 flex size-12 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
          <AlertTriangle className="size-6" aria-hidden="true" />
        </div>
        <h1 id="gallery-open-error-heading" className="text-2xl font-bold tracking-tight text-slate-900">
          Couldn’t open “{name || 'this project'}”
        </h1>
        <p className="mt-3 max-w-[68ch] text-sm leading-6 text-slate-600 sm:text-base">
          Nothing was added to your projects. Check your connection and try again.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onRetry}
            className={`${BUTTON} bg-blue-600 text-white shadow-[0_8px_18px_-12px_rgba(37,99,235,0.9)] hover:bg-blue-700`}>
            Try again
          </button>
          <button type="button" onClick={onContinue}
            className={`${BUTTON} border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}>
            Continue to editor
          </button>
          <button type="button" onClick={onBack} className={`${BUTTON} text-slate-600 hover:bg-slate-100 hover:text-slate-900`}>
            Back to gallery
          </button>
        </div>
      </section>
    </main>
  );
}

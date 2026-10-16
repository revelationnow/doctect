
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, LoaderCircle, X, Trash2 } from 'lucide-react';
import { useBackDismiss } from './editor-layout/useBackDismiss';

interface CloseProjectConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmClose: () => Promise<void>;
  onSaveAndClose: () => Promise<void>;
  projectName: string;
}

type PendingAction = 'close' | 'save';

const Spinner: React.FC = () => (
  <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
);

export const CloseProjectConfirmModal: React.FC<CloseProjectConfirmModalProps> = ({ 
    isOpen, onClose, onConfirmClose, onSaveAndClose, projectName 
}) => {
  // The action in flight; drives the pressed button's spinner and label, and the live region.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pending = pendingAction !== null;
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const close = () => {
    if (!pendingRef.current) onClose();
  };
  // Touch back gesture: same as the X button; a close in flight keeps the dialog and its entry.
  useBackDismiss(isOpen, () => {
    if (pendingRef.current) return false;
    onClose();
    return true;
  });

  const runAction = async (kind: PendingAction, action: () => Promise<void>): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(kind);
    try {
      await Promise.resolve().then(action);
    } catch {
      // Parent state remains intact so the user can retry either close path.
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPendingAction(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center p-4 border-b">
             <h2 className="text-lg font-bold text-slate-800">Close Project?</h2>
             <button type="button" onClick={close} disabled={pending} className="p-1 hover:bg-slate-100 rounded-full text-slate-500 disabled:cursor-wait disabled:opacity-50"><X size={20}/></button>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {pendingAction === 'close' ? 'Closing project…' : pendingAction === 'save' ? 'Saving and closing…' : ''}
        </p>
        
        <div className="p-6">
            <div className="flex items-start gap-4">
                <div className="p-3 bg-amber-100 text-amber-600 rounded-full flex-shrink-0">
                    <AlertTriangle size={24} />
                </div>
                <div>
                    <p className="text-slate-600 font-medium mb-1">
                        Do you want to save changes to <span className="font-bold text-slate-800">"{projectName}"</span>?
                    </p>
                    <p className="text-sm text-slate-500 leading-relaxed">
                        If you close without saving, any unsaved changes will be lost permanently.
                    </p>
                </div>
            </div>
        </div>

        <div className="p-4 border-t bg-slate-50 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button 
            type="button"
            onClick={close}
            disabled={pending}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium text-sm transition-colors disabled:cursor-wait disabled:opacity-50"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={() => { void runAction('close', onConfirmClose); }}
            disabled={pending}
            className="px-4 py-2 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-50"
          >
            {pendingAction === 'close' ? <><Spinner /> Closing…</> : <><Trash2 size={16} /> Close without Saving</>}
          </button>
          <button 
            type="button"
            onClick={() => { void runAction('save', onSaveAndClose); }}
            disabled={pending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm shadow-sm transition-colors flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-50"
          >
            {pendingAction === 'save' ? <><Spinner /> Saving…</> : <><Download size={16} /> Save JSON & Close</>}
          </button>
        </div>
      </div>
    </div>
  );
};

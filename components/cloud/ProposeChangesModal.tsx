import React, { useEffect, useRef, useState } from 'react';
import { X, GitPullRequest } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cloudApi, ApiError } from '../../services/cloudApi';
import { useBackDismiss } from '../editor-layout/useBackDismiss';
import { trapTab } from '../editor-layout/focusTrap';

interface ProposeChangesModalProps {
    sourceProjectId: string;
    onClose: () => void;
}

export function ProposeChangesModal({ sourceProjectId, onClose }: ProposeChangesModalProps) {
    const navigate = useNavigate();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    // Touch: the back gesture closes this dialog alone (the ⋯ sheet it was opened from stays), as
    // its Close button does.
    useBackDismiss(true, onClose);

    // Focus moves into the dialog on open and back to the opener on close, so Tab is trapped
    // from the first press: the row that opened it (a sheet row beneath the backdrop, or the
    // popover button that closes with the popover) is never the next stop.
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);

    const submit = async () => {
        if (!title.trim()) { setError('A title is required.'); return; }
        setBusy(true); setError(null);
        try {
            const res = await cloudApi.createMergeRequest({ sourceProjectId, title, description });
            navigate(`/mr/${res.mergeRequest.id}`);
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not create merge request');
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center" onClick={onClose}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="propose-dialog-title" tabIndex={-1}
                className="bg-white rounded-xl shadow-2xl w-[440px] outline-none"
                onClick={e => e.stopPropagation()} onKeyDown={event => trapTab(event, dialogRef.current)}>
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h2 id="propose-dialog-title" className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                        <GitPullRequest size={14} /> Propose changes to upstream
                    </h2>
                    <button onClick={onClose} aria-label="Close propose changes" className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
                </div>
                <div className="p-4 space-y-3">
                    <p className="text-xs text-slate-500">
                        Your latest cloud save will be proposed to the upstream project's owner.
                        Save to cloud first if you have unsaved edits.
                    </p>
                    <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                        className="w-full border rounded p-2 text-xs" placeholder="Title, e.g. 'Add iPad variant'" />
                    <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={3}
                        className="w-full border rounded p-2 text-xs" placeholder="What changed and why?" />
                    {error && <div className="text-xs text-red-600">{error}</div>}
                </div>
                <div className="px-4 py-3 border-t flex justify-end gap-2">
                    <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border text-slate-600">Cancel</button>
                    <button onClick={submit} disabled={busy}
                        className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">
                        {busy ? 'Creating…' : 'Create merge request'}
                    </button>
                </div>
            </div>
        </div>
    );
}

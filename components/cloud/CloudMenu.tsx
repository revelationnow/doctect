import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Cloud, History, UploadCloud, Globe, GitPullRequest, Pencil } from 'lucide-react';
import { useSession } from '../../lib/auth-client';
import { cloudApi, ApiError, CloudProject } from '../../services/cloudApi';
import { AppState } from '../../types';
import { HistoryModal } from './HistoryModal';
import { PublishModal } from './PublishModal';
import { ProposeChangesModal } from './ProposeChangesModal';
import { LazyEditListingModal } from './LazyEditListingModal';
import { MENU_ROW_CLASS, useMenuListHost } from '../editor-layout/MenuListContext';
import type { WorkspaceProject } from '../../services/localWorkspace/index';

interface CloudMenuProps {
    project: WorkspaceProject;
    getWorkingProject?: () => WorkspaceProject;
    onLinkCloud: (cloud: { projectId: string; lastSyncedCommitId: string }) => Promise<boolean>;
    onRestoreState: (
        state: AppState,
        cloud?: { projectId: string; lastSyncedCommitId: string },
    ) => Promise<boolean>;
}

type CloudLink = NonNullable<WorkspaceProject['cloud']>;

/**
 * The header's Cloud trigger and popover. Inside a `MenuListContext` host (the phone ⋯ sheet) the
 * same items render as a list of rows instead, with no trigger: the host shows them whenever it is
 * open, and a completed one-shot action dismisses the host as the popover would close.
 */
export function CloudMenu({ project, getWorkingProject, onLinkCloud, onRestoreState }: CloudMenuProps) {
    const { data: session } = useSession();
    const list = useMenuListHost();
    const [open, setOpen] = useState(false);
    // The items are on view: the popover is open, or the host lists them.
    const expanded = list !== null || open;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [showPublish, setShowPublish] = useState(false);
    const [publishProject, setPublishProject] = useState<WorkspaceProject | null>(null);
    const [showEditListing, setShowEditListing] = useState(false);
    const [showPropose, setShowPropose] = useState(false);
    const [cloudProject, setCloudProject] = useState<CloudProject | null>(null);
    const [saveConflict, setSaveConflict] = useState(false);
    const [pendingCloudLinks, setPendingCloudLinks] = useState<Record<string, CloudLink>>({});
    const ref = useRef<HTMLDivElement>(null);
    const location = useLocation();
    const navigate = useNavigate();
    const pendingCloudLink = pendingCloudLinks[project.id] ?? null;

    useEffect(() => {
        if (list) return; // rows have no popover to close
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setError(null); }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [list]);

    useEffect(() => {
        if (expanded && project.cloud && !cloudProject) {
            cloudApi.getProject(project.cloud.projectId).then(setCloudProject).catch(() => {});
        }
    }, [expanded, project.cloud, cloudProject]);

    /** A one-shot action completed: the popover closes, or the list's host is dismissed. */
    const done = () => { if (list) list.onDismiss(); else setOpen(false); };

    const saveToCloud = async () => {
        setBusy(true); setError(null); setSaveConflict(false);
        try {
            if (pendingCloudLink) {
                if (await onLinkCloud(pendingCloudLink) === false) {
                    setError('Cloud save succeeded, but its local link was not saved.');
                    return;
                }
                setPendingCloudLinks(current => {
                    const next = { ...current };
                    delete next[project.id];
                    return next;
                });
                done();
                return;
            }

            const current = getWorkingProject?.() ?? project;
            const message = window.prompt('Describe this save (commit message):', current.cloud ? 'Update' : 'Initial save');
            if (message === null) return;
            let cloudLink: CloudLink;
            if (!current.cloud) {
                const res = await cloudApi.createProject({ name: current.name, state: current.initialState, message });
                cloudLink = { projectId: res.project.id, lastSyncedCommitId: res.commit.id };
            } else {
                const res = await cloudApi.saveCommit(current.cloud.projectId, current.cloud.lastSyncedCommitId, { state: current.initialState, message });
                cloudLink = { projectId: current.cloud.projectId, lastSyncedCommitId: res.commit.id };
            }
            if (await onLinkCloud(cloudLink) === false) {
                setPendingCloudLinks(current => ({ ...current, [project.id]: cloudLink }));
                setError('Cloud save succeeded, but its local link was not saved.');
                return;
            }
            done();
        } catch (e) {
            if (e instanceof ApiError && e.code === 'USERNAME_REQUIRED') {
                navigate('/welcome', { state: { from: location.pathname } });
                return;
            }
            if (e instanceof ApiError && e.code === 'PROJECT_HEAD_CHANGED') {
                setSaveConflict(true);
                setError('Cloud project changed since your last save. Local edits are unchanged.');
                return;
            }
            setError(e instanceof ApiError ? e.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    const reloadCloudVersion = async () => {
        if (!project.cloud) return;
        setBusy(true); setError(null);
        try {
            const latest = await cloudApi.getProject(project.cloud.projectId);
            if (!latest.headCommitId) throw new Error('Cloud project has no saved version.');
            const commit = await cloudApi.getCommit(project.cloud.projectId, latest.headCommitId);
            if (await onRestoreState(commit.state, {
                projectId: project.cloud.projectId,
                lastSyncedCommitId: latest.headCommitId,
            }) === false) {
                setError('Cloud version loaded, but it was not saved locally.');
                return;
            }
            setCloudProject(latest);
            setSaveConflict(false);
            done();
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not reload cloud version');
        } finally {
            setBusy(false);
        }
    };

    // One item list for both renderings. Rows are 44px tall with 16px icons and close the host when
    // a link is followed (so a navigation prompt is never hidden under it); the popover keeps its
    // compact desktop styling untouched. Items that open a modal only close the popover: the modal
    // is rendered below, so a dismissed host would take it down too.
    const linkClass = list ? MENU_ROW_CLASS : 'block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50';
    const buttonClass = list
        ? clsx(MENU_ROW_CLASS, 'disabled:opacity-40')
        : 'w-full text-left flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50';
    const iconSize = list ? 16 : 12;
    const follow = list?.onDismiss;
    const items = !session?.user ? (
        <Link to="/login" state={{ from: location.pathname }} onClick={follow} className={linkClass}>
            Sign in to save to cloud
        </Link>
    ) : !session.user.username ? (
        <Link to="/welcome" state={{ from: location.pathname }} onClick={follow} className={linkClass}>
            Set a username to use cloud features
        </Link>
    ) : (
        <>
            <button disabled={busy} onClick={saveToCloud} className={buttonClass}>
                <UploadCloud size={iconSize} /> {pendingCloudLink ? 'Retry local link' : project.cloud ? 'Save to cloud' : 'Save to cloud (new)'}
            </button>
            {project.cloud && (
                <button onClick={() => { setShowHistory(true); setOpen(false); }} className={buttonClass}>
                    <History size={iconSize} /> Version history
                </button>
            )}
            {cloudProject?.forkedFromProjectId && (
                <Link to={`/gallery/${cloudProject.forkedFromProjectId}`} onClick={follow}
                    className={list ? clsx(MENU_ROW_CLASS, 'text-slate-500') : 'block px-3 py-1.5 text-[11px] text-slate-400 hover:bg-slate-50'}>
                    ↳ forked from upstream — view source
                </Link>
            )}
            {project.cloud && (
                <button onClick={() => { try { setPublishProject(getWorkingProject?.() ?? project); setShowPublish(true); setOpen(false); }
                    catch (error) { setError(error instanceof Error ? error.message : 'Current project is unavailable.'); } }}
                    className={buttonClass}>
                    <Globe size={iconSize} /> Publish to gallery…
                </button>
            )}
            {cloudProject?.visibility === 'public' && (
                <button onClick={() => { setShowEditListing(true); setOpen(false); }} className={buttonClass}>
                    <Pencil size={iconSize} /> Edit gallery listing…
                </button>
            )}
            {cloudProject?.forkedFromProjectId && (
                <button onClick={() => { setShowPropose(true); setOpen(false); }} className={buttonClass}>
                    <GitPullRequest size={iconSize} /> Propose changes to upstream…
                </button>
            )}
            {error && <div className={list ? 'px-4 py-2 text-sm text-red-600' : 'px-3 py-1.5 text-xs text-red-600'}>{error}</div>}
            {saveConflict && (
                <button disabled={busy} onClick={reloadCloudVersion}
                    className={list
                        ? clsx(MENU_ROW_CLASS, 'font-medium text-blue-700 disabled:opacity-40')
                        : 'w-full text-left px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50'}>
                    Reload cloud version
                </button>
            )}
        </>
    );

    return (
        <div className={list ? undefined : 'relative'} ref={ref}>
            {list ? items : (
                <>
                    <button onClick={() => setOpen(o => !o)}
                        className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600" title="Cloud">
                        <Cloud size={14} /> <span className="hidden md:inline">Cloud</span>
                    </button>
                    {open && (
                        <div className="absolute right-0 top-7 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 min-w-[200px]">
                            {items}
                        </div>
                    )}
                </>
            )}
            {showHistory && project.cloud && (
                <HistoryModal
                    cloudProjectId={project.cloud.projectId}
                    onRestore={async state => {
                        if (await onRestoreState(state) !== false) setShowHistory(false);
                    }}
                    onClose={() => setShowHistory(false)}
                />
            )}
            {showPublish && project.cloud && (
                <PublishModal project={publishProject ?? project} cloudProjectId={project.cloud.projectId}
                    onClose={() => setShowPublish(false)}
                    onPublished={() => { setShowPublish(false); window.alert('Published! View it in the Gallery.'); }} />
            )}
            {showEditListing && project.cloud && (
                <LazyEditListingModal projectId={project.cloud.projectId}
                    onClose={() => setShowEditListing(false)}
                    onSaved={() => {
                        setShowEditListing(false);
                        // Dropping the cached project makes the menu refetch on its next open, so
                        // a listing edited and then unpublished elsewhere cannot keep offering
                        // this item from stale state.
                        setCloudProject(null);
                        window.alert('Listing updated. Your published version is unchanged.');
                    }} />
            )}
            {showPropose && project.cloud && (
                <ProposeChangesModal sourceProjectId={project.cloud.projectId} onClose={() => setShowPropose(false)} />
            )}
        </div>
    );
}

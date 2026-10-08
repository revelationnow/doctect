import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { User, LogOut, Image, Settings, FolderOpen, Shield } from 'lucide-react';
import { signOut } from '../lib/auth-client';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { MENU_ROW_CLASS, useMenuListHost } from './editor-layout/MenuListContext';

/**
 * The header's Account trigger and popover. Inside a `MenuListContext` host (the phone ⋯ sheet)
 * the same links and Sign out render as a list of rows with no trigger; following a link
 * dismisses the host first, as the sheet's own navigation rows do.
 */
export function AccountMenu() {
    const { user, loading, error, refresh } = useCurrentUser();
    const list = useMenuListHost();
    const [open, setOpen] = useState(false);
    const [logoutError, setLogoutError] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const location = useLocation();
    const navigate = useNavigate();

    const handleSignOut = async () => {
        setLogoutError(false);
        try {
            const result = await signOut();
            if (result?.error) throw result.error;
            await refresh();
            setOpen(false);
            navigate('/login', { replace: true });
        } catch {
            setLogoutError(true);
        }
    };

    useEffect(() => {
        if (list) return; // rows have no popover to close
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [list]);

    if (loading) return null;
    if (error) {
        if (list) {
            return (
                <div role="alert">
                    <div className="px-4 py-2 text-sm text-red-700">Unable to verify account authority.</div>
                    <button type="button" onClick={() => void refresh()} className={clsx(MENU_ROW_CLASS, 'font-semibold text-red-700')}>Retry</button>
                    <button type="button" onClick={() => void handleSignOut()} className={clsx(MENU_ROW_CLASS, 'font-semibold text-red-700')}>Sign out</button>
                    {logoutError && <div className="px-4 py-2 text-sm text-red-700">Unable to sign out. Try again.</div>}
                </div>
            );
        }
        return (
            <div role="alert" className="flex items-center gap-2 text-xs text-red-700">
                <span>Unable to verify account authority.</span>
                <button type="button" onClick={() => void refresh()} className="font-semibold hover:text-red-900">Retry</button>
                <button type="button" onClick={() => void handleSignOut()} className="font-semibold hover:text-red-900">Sign out</button>
                {logoutError && <span>Unable to sign out. Try again.</span>}
            </div>
        );
    }
    if (!user) {
        return list
            ? <Link to="/login" state={{ from: location.pathname }} onClick={list.onDismiss} className={MENU_ROW_CLASS}>Sign in</Link>
            : <Link to="/login" state={{ from: location.pathname }} className="text-xs font-medium text-slate-500 hover:text-blue-600">Sign in</Link>;
    }
    const username = user.username;
    const profileTo = username ? `/u/${username}` : '/welcome';
    const profileState = username ? undefined : { from: location.pathname };
    // One link list for both renderings: following a link closes the popover, or dismisses the host.
    const follow = list ? list.onDismiss : () => setOpen(false);
    const linkClass = list ? MENU_ROW_CLASS : 'flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50';
    const iconSize = list ? 16 : 12;
    const items = (
        <>
            <Link to={profileTo} state={profileState} onClick={follow} className={list ? MENU_ROW_CLASS : 'block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50'}>My profile</Link>
            <Link to="/gallery" onClick={follow} className={linkClass}><Image size={iconSize} /> Gallery</Link>
            <Link to="/projects" onClick={follow} className={linkClass}><FolderOpen size={iconSize} /> My projects</Link>
            {(user.role === 'admin' || user.role === 'owner') && (
                <Link to="/admin/moderation" onClick={follow} className={linkClass}>
                    <Shield size={iconSize} /> Moderation
                </Link>
            )}
            <Link to="/account" onClick={follow} className={linkClass}><Settings size={iconSize} /> Account settings</Link>
            {logoutError && <div role="alert" className={list ? 'px-4 py-2 text-sm text-red-700' : 'px-3 py-1.5 text-xs text-red-700'}>Unable to sign out. Try again.</div>}
            <button onClick={() => void handleSignOut()}
                className={list ? MENU_ROW_CLASS : 'w-full text-left flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50'}>
                <LogOut size={iconSize} /> Sign out
            </button>
        </>
    );
    if (list) {
        return (
            <div ref={ref}>
                {/* Stands in for the trigger's label, which names the account on the header. */}
                <div className="px-4 py-2 text-xs text-slate-500">{username ? `Signed in as ${username}` : 'No username set yet'}</div>
                {items}
            </div>
        );
    }
    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600"
                title="Account"
            >
                <User size={14} /> <span className="hidden md:inline">{username || 'Set username'}</span>
            </button>
            {open && (
                <div className="absolute right-0 top-7 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
                    {items}
                </div>
            )}
        </div>
    );
}

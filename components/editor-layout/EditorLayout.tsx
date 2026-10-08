import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import type { TouchEditorActions } from './touchActions';
import { SidebarDrawer } from './SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX, SheetDetent } from './PropertiesSheet';
import { TabletToolbar } from './TabletToolbar';
import { PhoneTopBar } from './PhoneTopBar';
import { TouchToolButtons } from './TouchToolButtons';
import { TouchOverlayHostProvider } from './TouchOverlayHost';

export interface EditorLayoutProps {
    formFactor: FormFactor;
    editorBar: React.ReactNode;
    toolbar: React.ReactNode;
    sidebar: React.ReactNode;
    canvas: React.ReactNode;
    properties: React.ReactNode;
    sidebarWidth: number;
    propertiesPanelWidth: number;
    onStartResize: (panel: 'sidebar' | 'properties') => void;
    touchActions?: TouchEditorActions;
    selectionLabel?: string;
    navigationKey?: string;
}

export function DesktopEditorLayout(props: EditorLayoutProps) {
    const { editorBar, toolbar, sidebar, canvas, properties, sidebarWidth, propertiesPanelWidth, onStartResize } = props;
    return (
        <>
            {editorBar}
            <div className="flex flex-1 overflow-hidden">
                <div style={{ width: sidebarWidth }} className="flex-shrink-0 relative flex flex-col">
                    {sidebar}
                    <div
                        className="absolute right-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onMouseDown={() => onStartResize('sidebar')}
                    />
                </div>
                <div className="flex-1 flex flex-col relative min-w-0">
                    {toolbar}
                    <div className="flex-1 bg-slate-200 overflow-hidden relative flex flex-col">
                        {canvas}
                    </div>
                </div>
                <div style={{ width: propertiesPanelWidth }} className="flex-shrink-0 relative flex flex-col">
                    <div
                        className="absolute left-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onMouseDown={() => onStartResize('properties')}
                    />
                    {properties}
                </div>
            </div>
        </>
    );
}

/**
 * Browsers set `isContentEditable` (inherited editability too); the reflected `contentEditable`
 * property and the attribute cover jsdom, which only stores the property as a plain expando.
 */
const isContentEditableTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement
    && (target.isContentEditable || target.contentEditable === 'true' || target.getAttribute('contenteditable') === 'true');

/**
 * Drawer state shared by both touch layouts: picking a page/template (any navigation change)
 * closes the drawer, and rotation closes it and refits the canvas (the sheet keeps its detent).
 */
function useTouchLayoutState(navigationKey: string | undefined, onRotate: (() => void) | undefined) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    useEffect(() => { setDrawerOpen(false); }, [navigationKey]);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(orientation: portrait)');
        const onChange = () => { setDrawerOpen(false); onRotate?.(); };
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, [onRotate]);
    return { drawerOpen, setDrawerOpen };
}

/** Tablet: one toolbar row, canvas + properties docked right at a fixed width, sidebar in a drawer. */
function TabletEditorLayout({ sidebar, canvas, properties, touchActions, navigationKey }: EditorLayoutProps & { touchActions: TouchEditorActions }) {
    const { drawerOpen, setDrawerOpen } = useTouchLayoutState(navigationKey, touchActions.fitToWidth);
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <TouchOverlayHostProvider>
                <TabletToolbar actions={touchActions} onOpenSidebar={() => setDrawerOpen(true)} />
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="relative flex min-w-0 flex-1 flex-col bg-slate-200">{canvas}</div>
                    <div className="flex w-[320px] shrink-0 flex-col border-l bg-white">{properties}</div>
                </div>
                <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>{sidebar}</SidebarDrawer>
            </TouchOverlayHostProvider>
        </div>
    );
}

/** The tool pill floats this far above the properties sheet's peek row. */
export const PILL_BOTTOM_GAP_PX = 12;
/** CSS variable on the phone canvas wrapper: the pill's height plus its gap, 0 while the pill is unmounted. */
export const PILL_INSET_VAR = '--touch-pill-inset';

/** Phone: top bar, full-screen canvas with a floating tool pill, properties in a bottom sheet, sidebar in a drawer. */
function PhoneEditorLayout({ sidebar, canvas, properties, touchActions, navigationKey, selectionLabel }: EditorLayoutProps & { touchActions: TouchEditorActions }) {
    const { drawerOpen, setDrawerOpen } = useTouchLayoutState(navigationKey, touchActions.fitToWidth);
    const [detent, setDetent] = useState<SheetDetent>('peek');
    const canvasRef = useRef<HTMLDivElement>(null);
    const pillRef = useRef<HTMLDivElement>(null);

    // Scroll room under the page for the pill: the wrapper publishes the pill's height plus its gap
    // as a CSS variable, which the touch CSS adds to the canvas content's bottom padding, so the page
    // bottom can be scrolled clear of the pill. Measured live: the pill wraps to one or two rows
    // with the width. 0 while the pill is unmounted (sheet at half/full).
    useLayoutEffect(() => {
        const wrapper = canvasRef.current;
        if (!wrapper) return;
        const pill = pillRef.current;
        const apply = () => wrapper.style.setProperty(PILL_INSET_VAR, `${pill ? pill.offsetHeight + PILL_BOTTOM_GAP_PX : 0}px`);
        apply();
        if (!pill || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(apply);
        observer.observe(pill);
        return () => observer.disconnect();
    }, [detent]);

    // Selecting something from half/full keeps the user's detent; editing text always drops to peek
    // so the inline editor is not hidden behind the sheet and keyboard.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onFocusIn = (event: FocusEvent) => { if (isContentEditableTarget(event.target)) setDetent('peek'); };
        el.addEventListener('focusin', onFocusIn);
        return () => el.removeEventListener('focusin', onFocusIn);
    }, []);

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <TouchOverlayHostProvider>
                <PhoneTopBar actions={touchActions} onOpenSidebar={() => setDrawerOpen(true)} />
                <div ref={canvasRef} className="relative flex min-h-0 flex-1 flex-col bg-slate-200"
                    style={{ paddingBottom: SHEET_PEEK_PX }}>
                    {canvas}
                    {detent === 'peek' && (
                        // All nine tools stay reachable at phone widths: the row wraps inside the pill
                        // instead of scrolling Fit off the edge. `w-max` sizes the pill to the full row,
                        // capped by max-w, so it wraps only as much as the screen requires.
                        <div ref={pillRef} data-testid="touch-tool-pill" data-touch-chrome="tool-pill"
                            className="absolute left-1/2 z-20 w-max max-w-[calc(100vw-16px)] -translate-x-1/2 rounded-2xl border bg-white/95 px-1 shadow-lg"
                            style={{ bottom: SHEET_PEEK_PX + PILL_BOTTOM_GAP_PX }}>
                            <TouchToolButtons actions={touchActions} showFit wrap />
                        </div>
                    )}
                </div>
                <PropertiesSheet detent={detent} onDetentChange={setDetent} title={selectionLabel ?? 'Properties'}>
                    {properties}
                </PropertiesSheet>
                <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>{sidebar}</SidebarDrawer>
            </TouchOverlayHostProvider>
        </div>
    );
}

export function EditorLayout(props: EditorLayoutProps) {
    if (props.formFactor === 'tablet' && props.touchActions) return <TabletEditorLayout {...props} touchActions={props.touchActions} />;
    if (props.formFactor === 'phone' && props.touchActions) return <PhoneEditorLayout {...props} touchActions={props.touchActions} />;
    return <DesktopEditorLayout {...props} />;
}

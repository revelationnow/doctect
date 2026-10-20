import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import type { TouchEditorActions } from './touchActions';
import { SidebarDrawer } from './SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX, SheetDetent } from './PropertiesSheet';
import { TabletToolbar } from './TabletToolbar';
import { PhoneTopBar } from './PhoneTopBar';
import { TouchFitButton, TouchToolButtons } from './TouchToolButtons';
import { ToolPillScroller } from './ToolPillScroller';
import { TouchOverlayHostProvider } from './TouchOverlayHost';
import { useInputMode } from './FormFactorContext';
import { PropertiesDock } from './PropertiesDock';

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
                        data-sidebar-resize-handle=""
                        className="absolute right-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onPointerDown={event => { event.preventDefault(); onStartResize('sidebar'); }}
                    />
                </div>
                <div className="flex-1 flex flex-col relative min-w-0">
                    {toolbar}
                    <div className="flex-1 bg-slate-200 overflow-hidden relative flex flex-col">
                        {canvas}
                    </div>
                </div>
                <PropertiesDock width={propertiesPanelWidth} onStartResize={() => onStartResize('properties')}>{properties}</PropertiesDock>
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
 * Drawer state shared by both narrow layouts: picking a page/template (any navigation change)
 * closes the drawer, and on a touch device rotation closes it and refits the canvas (the sheet keeps
 * its detent). Rotation is a touch notion: in a mouse window `(orientation: portrait)` flips whenever
 * a resize crosses width == height, which must neither close the drawer nor refit — a refit would
 * discard a Ctrl+wheel zoom, and useTouchFit's ResizeObserver already follows a mouse window's width
 * until the user zooms.
 */
function useTouchLayoutState(navigationKey: string | undefined, onRotate: (() => void) | undefined) {
    const touchInput = useInputMode() === 'touch';
    const [drawerOpen, setDrawerOpen] = useState(false);
    useEffect(() => { setDrawerOpen(false); }, [navigationKey]);
    useEffect(() => {
        if (!touchInput || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(orientation: portrait)');
        const onChange = () => { setDrawerOpen(false); onRotate?.(); };
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, [onRotate, touchInput]);
    return { drawerOpen, setDrawerOpen };
}

/** Tablet: one toolbar row, canvas + the resizable, collapsible properties dock, sidebar in a drawer. */
function TabletEditorLayout({ sidebar, canvas, properties, propertiesPanelWidth, onStartResize, touchActions, navigationKey }: EditorLayoutProps & { touchActions: TouchEditorActions }) {
    const { drawerOpen, setDrawerOpen } = useTouchLayoutState(navigationKey, touchActions.fitToWidth);
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <TouchOverlayHostProvider>
                <TabletToolbar actions={touchActions} onOpenSidebar={() => setDrawerOpen(true)} />
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="relative flex min-w-0 flex-1 flex-col bg-slate-200">{canvas}</div>
                    <PropertiesDock width={propertiesPanelWidth} onStartResize={() => onStartResize('properties')} capToCanvas>{properties}</PropertiesDock>
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
    // bottom can be scrolled clear of the pill. Measured live rather than assumed one row high.
    // 0 while the pill is unmounted (sheet at half/full).
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
                        // One row at every phone width (R43): the tools swipe sideways inside the pill
                        // when the screen is narrower than them, and Fit is pinned outside the scroller.
                        // `w-max` sizes the pill to the full row, capped by max-w.
                        <div ref={pillRef} data-testid="touch-tool-pill" data-touch-chrome="tool-pill"
                            className="absolute left-1/2 z-20 flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 items-center rounded-2xl border bg-white/95 px-1 shadow-lg"
                            style={{ bottom: SHEET_PEEK_PX + PILL_BOTTOM_GAP_PX }}>
                            <ToolPillScroller activeKey={`${touchActions.tool}:${touchActions.multiSelect}`}>
                                <TouchToolButtons actions={touchActions} />
                            </ToolPillScroller>
                            <span aria-hidden className="mx-0.5 h-7 w-px shrink-0 bg-slate-200" />
                            <TouchFitButton actions={touchActions} />
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

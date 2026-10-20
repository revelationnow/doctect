import React, { createContext, useContext, useEffect } from 'react';
import type { FormFactor, InputMode } from '../../hooks/useEditorFormFactor';

const FormFactorContext = createContext<FormFactor>('desktop');
const InputModeContext = createContext<InputMode>('mouse');

/** The editor's layout: 'tablet' and 'phone' for touch devices and for narrow mouse windows alike. */
export const useFormFactor = (): FormFactor => useContext(FormFactorContext);
/** How the user points. Touch-only behaviour (44px targets, row ⋯ sheets, gestures) reads this, not the layout. */
export const useInputMode = (): InputMode => useContext(InputModeContext);

/**
 * `input` defaults to touch for a narrow layout and mouse for desktop, which is what every caller
 * meant before narrow mouse windows existed; EditorPage passes the detected input explicitly.
 */
export function FormFactorProvider({ value, input = value === 'desktop' ? 'mouse' : 'touch', children }: {
    value: FormFactor; input?: InputMode; children: React.ReactNode;
}) {
    useEffect(() => {
        const root = document.documentElement;
        if (value === 'desktop') {
            root.removeAttribute('data-form-factor');
            return;
        }
        root.setAttribute('data-form-factor', value);
        return () => root.removeAttribute('data-form-factor');
    }, [value]);

    useEffect(() => {
        const root = document.documentElement;
        if (input !== 'touch') {
            root.removeAttribute('data-input');
            return;
        }
        root.setAttribute('data-input', 'touch');
        return () => root.removeAttribute('data-input');
    }, [input]);

    return (
        <FormFactorContext.Provider value={value}>
            <InputModeContext.Provider value={input}>{children}</InputModeContext.Provider>
        </FormFactorContext.Provider>
    );
}

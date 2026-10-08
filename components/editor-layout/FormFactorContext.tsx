import React, { createContext, useContext, useEffect } from 'react';
import type { FormFactor } from '../../hooks/useEditorFormFactor';

const FormFactorContext = createContext<FormFactor>('desktop');

export const useFormFactor = (): FormFactor => useContext(FormFactorContext);

export function FormFactorProvider({ value, children }: { value: FormFactor; children: React.ReactNode }) {
    useEffect(() => {
        const root = document.documentElement;
        if (value === 'desktop') {
            root.removeAttribute('data-form-factor');
            return;
        }
        root.setAttribute('data-form-factor', value);
        return () => root.removeAttribute('data-form-factor');
    }, [value]);

    return <FormFactorContext.Provider value={value}>{children}</FormFactorContext.Provider>;
}

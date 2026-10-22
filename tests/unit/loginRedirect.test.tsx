import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from '../../pages/LoginPage';

vi.mock('../../lib/auth-client', () => ({
    signIn: {
        email: vi.fn((_creds: any, handlers: any) => { handlers.onSuccess(); return Promise.resolve(); }),
        social: vi.fn(),
    },
    signUp: {
        email: vi.fn((_creds: any, handlers: any) => { handlers.onSuccess(); return Promise.resolve(); }),
    },
    useSession: () => ({ data: null, isPending: false }),
}));

const renderAt = (initialEntries: any[]) => render(
    <MemoryRouter initialEntries={initialEntries}>
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/gallery/xyz" element={<div>GALLERY_DETAIL_MARKER</div>} />
            <Route path="/app" element={<div>APP_MARKER</div>} />
        </Routes>
    </MemoryRouter>
);

const fillAndSubmitSignIn = (container: HTMLElement) => {
    const email = container.querySelector('input[type="email"]') as HTMLInputElement;
    const password = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'a@b.com' } });
    fireEvent.change(password, { target: { value: 'password1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
};

describe('LoginPage redirect behavior', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns to the page the user came from after sign-in', async () => {
        const { container } = renderAt([{ pathname: '/login', state: { from: '/gallery/xyz' } }]);
        fillAndSubmitSignIn(container);
        expect(await screen.findByText('GALLERY_DETAIL_MARKER')).toBeInTheDocument();
    });

    // Sign-in's callback and the emailed verification link reload the page, which drops router
    // state, so the page to return to also rides along in the URL.
    it('returns to the page named in the from query after a full page load', async () => {
        const { container } = renderAt(['/login?from=%2Fgallery%2Fxyz']);
        fillAndSubmitSignIn(container);
        expect(await screen.findByText('GALLERY_DETAIL_MARKER')).toBeInTheDocument();
    });

    it('carries the page to return to in the sign-in callback URL', async () => {
        const { signIn } = await import('../../lib/auth-client');
        const { container } = renderAt([{ pathname: '/login', state: { from: '/gallery/xyz' } }]);
        fillAndSubmitSignIn(container);
        expect(signIn.email).toHaveBeenCalledWith(
            expect.objectContaining({ callbackURL: `${window.location.origin}/login?verified=1&from=%2Fgallery%2Fxyz` }),
            expect.anything(),
        );
    });

    it('ignores a return path that would leave the site', async () => {
        const { container } = renderAt(['/login?from=%2F%2Fevil.example%2Fx']);
        fillAndSubmitSignIn(container);
        expect(await screen.findByText('APP_MARKER')).toBeInTheDocument();
    });

    it('defaults to /app when there is no "from" state', async () => {
        const { container } = renderAt(['/login']);
        fillAndSubmitSignIn(container);
        expect(await screen.findByText('APP_MARKER')).toBeInTheDocument();
    });
});

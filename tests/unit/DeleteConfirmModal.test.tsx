import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal';

afterEach(cleanup);

describe('DeleteConfirmModal', () => {
  it('warns that deleting a page also deletes its children and the references to it', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal isOpen onClose={vi.fn()} onConfirm={onConfirm} nodeTitle="January 6, 2026" />);

    expect(screen.getByRole('heading', { name: 'Delete Page?' })).toBeInTheDocument();
    expect(screen.getByText('All child pages within this section')).toBeInTheDocument();
    expect(screen.getByText('Any references pointing to these pages')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Everything' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('says only the pointer goes when every node being deleted is a reference', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal isOpen onClose={vi.fn()} onConfirm={onConfirm} nodeTitle="January 5, 2026" referencesOnly />);

    expect(screen.getByRole('heading', { name: 'Delete Reference?' })).toBeInTheDocument();
    expect(screen.getByText(/the reference to/)).toHaveTextContent('Are you sure you want to delete the reference to "January 5, 2026"?');
    expect(screen.getByText(/Only the reference goes/)).toBeInTheDocument();
    expect(screen.queryByText('All child pages within this section')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Everything' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Reference' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GalleryOpenErrorScreen } from '../../components/workspace/GalleryOpenErrorScreen';

it('names the project, says nothing was added, and routes its three actions', () => {
  const onRetry = vi.fn(), onContinue = vi.fn(), onBack = vi.fn();
  render(<GalleryOpenErrorScreen name="P" onRetry={onRetry} onContinue={onContinue} onBack={onBack} />);
  expect(screen.getByRole('heading', { name: 'Couldn’t open “P”' })).toBeVisible();
  expect(screen.getByText('Nothing was added to your projects. This may be a connection problem, or the project may not open in this version.')).toBeVisible();
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Try again', 'Continue to editor', 'Back to gallery']);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue to editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to gallery' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('announces the failure to assistive tech as an assertive alert, without its buttons', () => {
  render(<GalleryOpenErrorScreen name="P" onRetry={() => {}} onContinue={() => {}} onBack={() => {}} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveAttribute('aria-live', 'assertive');
  expect(within(alert).getByRole('heading', { name: 'Couldn’t open “P”' })).toBeInTheDocument();
  expect(within(alert).getByText(/^Nothing was added to your projects\./)).toBeInTheDocument();
  expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
});

it('falls back to a generic name', () => {
  render(<GalleryOpenErrorScreen name="" onRetry={() => {}} onContinue={() => {}} onBack={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Couldn’t open “this project”' })).toBeVisible();
});

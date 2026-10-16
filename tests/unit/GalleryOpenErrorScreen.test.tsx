import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GalleryOpenErrorScreen } from '../../components/workspace/GalleryOpenErrorScreen';

it('names the project, says nothing was added, and routes its three actions', () => {
  const onRetry = vi.fn(), onContinue = vi.fn(), onBack = vi.fn();
  render(<GalleryOpenErrorScreen name="P" onRetry={onRetry} onContinue={onContinue} onBack={onBack} />);
  expect(screen.getByRole('heading', { name: 'Couldn’t open “P”' })).toBeVisible();
  expect(screen.getByText('Nothing was added to your projects. Check your connection and try again.')).toBeVisible();
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Try again', 'Continue to editor', 'Back to gallery']);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue to editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to gallery' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('falls back to a generic name', () => {
  render(<GalleryOpenErrorScreen name="" onRetry={() => {}} onContinue={() => {}} onBack={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Couldn’t open “this project”' })).toBeVisible();
});

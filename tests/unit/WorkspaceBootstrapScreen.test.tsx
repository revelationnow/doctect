import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { GALLERY_OPEN_STEPS, PENDING_OPEN_STEPS, WorkspaceBootstrapScreen } from '../../components/workspace/WorkspaceBootstrapScreen';

it('keeps the plain bootstrap copy without an opening', () => {
  render(<WorkspaceBootstrapScreen phase="checking-existing-projects" />);
  expect(screen.getByRole('heading', { name: 'Opening your projects' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Checking saved projects');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

it('names the project and marks done, current and upcoming steps', () => {
  render(<WorkspaceBootstrapScreen phase="opening-local-storage" opening={{ name: '2026 Planner', steps: GALLERY_OPEN_STEPS, step: 'prepare' }} />);
  expect(screen.getByRole('heading', { name: 'Opening “2026 Planner”' })).toBeVisible();
  const items = within(screen.getByRole('list')).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual(['Opening your projects', 'Downloading the project', 'Preparing the project', 'Opening the editor']);
  expect(items.map(item => item.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming']);
  expect(items[2]).toHaveAttribute('aria-current', 'step');
  expect(screen.getByRole('status')).toHaveTextContent('Preparing the project');
});

it('uses the pending-import steps and a generic name fallback', () => {
  render(<WorkspaceBootstrapScreen phase="opening-local-storage" opening={{ name: '', steps: PENDING_OPEN_STEPS, step: 'workspace' }} />);
  expect(screen.getByRole('heading', { name: 'Opening your project' })).toBeVisible();
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('status')).toHaveTextContent('Opening your projects');
});

it('covers the page as an overlay and does not animate under reduced motion', () => {
  const { container } = render(<WorkspaceBootstrapScreen phase="opening-local-storage" overlay
    opening={{ name: 'P', steps: GALLERY_OPEN_STEPS, step: 'editor' }} />);
  expect(container.firstElementChild).toHaveClass('fixed', 'inset-0');
  expect(container.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none');
});

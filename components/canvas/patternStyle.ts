import type { CSSProperties } from 'react';
import type { PatternType } from '../../types';

export const MIN_SCREEN_LINE_PX = 1;
export const MIN_SCREEN_DOT_PX = 1.5;
export const DOT_FEATHER_SCREEN_PX = 0.5;

export interface PatternBackgroundOptions {
  type?: PatternType;
  color: string;
  spacing?: number;
  weight?: number;
  renderScale?: number;
}

const PATTERN_ANGLES: Partial<Record<PatternType, string[]>> = {
  'lines-h': ['180deg'],
  'lines-v': ['90deg'],
  'lines-d': ['135deg'],
  grid: ['180deg', '90deg'],
};

const safeScale = (value: number | undefined) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
);

/**
 * CSS for a pattern fill that lands where the PDF draws it (services/pdfService.ts drawPattern):
 * tiles start at the element's outer edge, under any border (`background-origin: border-box`),
 * and dots sit on the tile corners, where grid lines cross, rather than mid-tile.
 */
export function buildPatternBackgroundStyle({
  type,
  color,
  spacing = 10,
  weight = 1,
  renderScale = 1,
}: PatternBackgroundOptions): CSSProperties {
  const scale = safeScale(renderScale);
  const resolvedSpacing = Number(spacing) || 10;
  const sourceWeight = Number(weight) || 1;
  const angles = type ? PATTERN_ANGLES[type] : undefined;

  if (angles) {
    const effectiveWeight = Math.max(sourceWeight, MIN_SCREEN_LINE_PX / scale);
    return {
      backgroundOrigin: 'border-box',
      backgroundImage: angles
        .map(angle => `repeating-linear-gradient(${angle}, ${color}, ${color} ${effectiveWeight}px, transparent ${effectiveWeight}px, transparent ${resolvedSpacing}px)`)
        .join(', '),
    };
  }

  if (type === 'dots') {
    const diameter = Math.max(sourceWeight, MIN_SCREEN_DOT_PX / scale);
    const radius = diameter / 2;
    const feather = Math.min(radius, DOT_FEATHER_SCREEN_PX / scale);
    const solidRadius = Math.max(0, radius - feather);
    return {
      backgroundOrigin: 'border-box',
      backgroundImage: `radial-gradient(circle, ${color} 0, ${color} ${solidRadius}px, transparent ${radius}px)`,
      backgroundSize: `${resolvedSpacing}px ${resolvedSpacing}px`,
      backgroundPosition: `${-resolvedSpacing / 2}px ${-resolvedSpacing / 2}px`,
    };
  }

  return {};
}

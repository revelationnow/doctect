import { describe, expect, it } from 'vitest';
import {
  buildPatternBackgroundStyle,
  DOT_FEATHER_SCREEN_PX,
  MIN_SCREEN_DOT_PX,
  MIN_SCREEN_LINE_PX,
} from '../../components/canvas/patternStyle';

describe('buildPatternBackgroundStyle', () => {
  it('keeps source line weight when it already exceeds the screen minimum', () => {
    const style = buildPatternBackgroundStyle({
      type: 'lines-h', color: '#123456', spacing: 24, weight: 4, renderScale: 0.5,
    });
    expect(style.backgroundImage).toBe(
      'repeating-linear-gradient(180deg, #123456, #123456 4px, transparent 4px, transparent 24px)',
    );
  });

  it.each([
    ['lines-h', '180deg'],
    ['lines-v', '90deg'],
    ['lines-d', '135deg'],
  ] as const)('clamps %s to one screen pixel', (type, angle) => {
    const scale = 0.125;
    const style = buildPatternBackgroundStyle({
      type, color: '#334155', spacing: 24, weight: 1, renderScale: scale,
    });
    expect(style.backgroundImage).toBe(
      `repeating-linear-gradient(${angle}, #334155, #334155 8px, transparent 8px, transparent 24px)`,
    );
    expect(8 * scale).toBe(MIN_SCREEN_LINE_PX);
  });

  it('layers horizontal and vertical lines for a square grid', () => {
    const style = buildPatternBackgroundStyle({
      type: 'grid', color: '#123456', spacing: 24, weight: 2, renderScale: 1,
    });
    expect(style.backgroundImage).toBe(
      'repeating-linear-gradient(180deg, #123456, #123456 2px, transparent 2px, transparent 24px), '
      + 'repeating-linear-gradient(90deg, #123456, #123456 2px, transparent 2px, transparent 24px)',
    );
  });

  it('clamps both grid directions to one screen pixel', () => {
    const style = buildPatternBackgroundStyle({
      type: 'grid', color: '#334155', spacing: 24, weight: 1, renderScale: 0.125,
    });
    expect(style.backgroundImage).toBe(
      'repeating-linear-gradient(180deg, #334155, #334155 8px, transparent 8px, transparent 24px), '
      + 'repeating-linear-gradient(90deg, #334155, #334155 8px, transparent 8px, transparent 24px)',
    );
  });

  it('clamps dots to 1.5 screen pixels with a 0.5 screen pixel feather', () => {
    const scale = 0.125;
    const style = buildPatternBackgroundStyle({
      type: 'dots', color: '#334155', spacing: 24, weight: 1, renderScale: scale,
    });
    expect(style.backgroundImage).toBe(
      'radial-gradient(circle, #334155 0, #334155 2px, transparent 6px)',
    );
    expect(style.backgroundSize).toBe('24px 24px');
    expect(12 * scale).toBe(MIN_SCREEN_DOT_PX);
    expect(4 * scale).toBe(DOT_FEATHER_SCREEN_PX);
  });

  it('keeps source dot weight above the minimum while preserving spacing and feather', () => {
    const scale = 0.5;
    const sourceWeight = 4;
    const style = buildPatternBackgroundStyle({
      type: 'dots', color: '#123456', spacing: 24, weight: sourceWeight, renderScale: scale,
    });
    const stops = style.backgroundImage?.match(/#123456 ([\d.]+)px, transparent ([\d.]+)px/);
    expect(stops).not.toBeNull();
    const solidRadius = Number(stops![1]);
    const outerRadius = Number(stops![2]);
    expect(outerRadius * 2).toBe(sourceWeight);
    expect(style.backgroundSize).toBe('24px 24px');
    expect((outerRadius - solidRadius) * scale).toBe(DOT_FEATHER_SCREEN_PX);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to scale 1 for invalid scale %s',
    renderScale => {
      const style = buildPatternBackgroundStyle({
        type: 'lines-v', color: '#000000', spacing: 10, weight: 1, renderScale,
      });
      expect(style.backgroundImage).toContain('#000000 1px');
    },
  );

  // The PDF draws every pattern from the element's outer edge, under any border: CSS would start
  // it inside the border (padding-box) and shift every line by the border width.
  it.each(['lines-h', 'lines-v', 'lines-d', 'grid', 'dots'] as const)('starts %s at the outer edge, under the border', type => {
    const style = buildPatternBackgroundStyle({ type, color: '#000000', spacing: 10, weight: 1, renderScale: 1 });
    expect(style.backgroundOrigin).toBe('border-box');
  });

  // The PDF puts a dot one radius in from every tile corner (r, r + spacing, …), where grid lines
  // of the same weight cross; the radial gradient centres its dot in the tile, so the tiles shift
  // back by half a spacing less that radius.
  it('puts dots one radius in from the tile corners, as the PDF does', () => {
    const style = buildPatternBackgroundStyle({ type: 'dots', color: '#000000', spacing: 24, weight: 2, renderScale: 1 });
    expect(style.backgroundPosition).toBe('-11px -11px');
    expect(style.backgroundSize).toBe('24px 24px');
  });

  // Below the zoom where dots are enlarged to stay visible, the inset follows the drawn dot,
  // so the edge row stays whole on screen too.
  it('insets dots by the radius drawn on screen', () => {
    const style = buildPatternBackgroundStyle({ type: 'dots', color: '#000000', spacing: 24, weight: 1, renderScale: 0.125 });
    expect(style.backgroundPosition).toBe('-6px -6px');
  });

  it('returns no background for an absent pattern type', () => {
    expect(buildPatternBackgroundStyle({ color: '#000000' })).toEqual({});
  });
});

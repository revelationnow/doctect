import { describe, expect, it } from 'vitest';
import { reflowTemplates } from '../../services/reflow';
import type { PageTemplate, PatternType } from '../../types';

const templatesWith = (patternType: PatternType): Record<string, PageTemplate> => ({
  page: {
    id: 'page', name: 'Page', width: 100, height: 100,
    layers: [{ id: 'main', name: 'Main', order: 0, visible: true, locked: false }],
    elements: [{
      id: 'fill', type: 'rect', x: 0, y: 0, w: 100, h: 100, rotation: 0,
      fill: '#000000', fillType: 'pattern', patternType, patternSpacing: 10, patternWeight: 1,
      stroke: '', strokeWidth: 0, opacity: 1, layerId: 'main',
    }],
  },
} as Record<string, PageTemplate>);

const reflowedSpacing = (patternType: PatternType) => {
  const result = reflowTemplates(templatesWith(patternType), 200, 400, true);
  return result.page.elements[0].patternSpacing;
};

describe('reflowTemplates pattern spacing', () => {
  it('scales line patterns along the axis their spacing runs on', () => {
    expect(reflowedSpacing('lines-h')).toBe(40);
    expect(reflowedSpacing('lines-v')).toBe(20);
  });

  it('keeps a grid square by scaling its single spacing with the average of both axes', () => {
    expect(reflowedSpacing('grid')).toBe(30);
  });
});

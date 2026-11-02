import { describe, it, expect } from 'vitest';
import { buildSnapTargets } from '../../../services/snapping/targets';
import { snapMove } from '../../../services/snapping/snap';
import type { TemplateElement } from '../../../types';

// CI guard against accidentally slow algorithms: generous limits, not the release budget
// (that is the Playwright benchmark, run on a throttled CPU).
describe('snapping engine speed', () => {
    it('builds 2,000 targets and answers 1,000 moves quickly', () => {
        let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const elements = Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, type: 'rect', x: Math.round(rand() * 2000),
            y: Math.round(rand() * 2800), w: 10 + Math.round(rand() * 80), h: 10 + Math.round(rand() * 40), rotation: 0,
            fill: '', stroke: '', strokeWidth: 0, opacity: 1 }) as TemplateElement);
        const t0 = performance.now();
        const T = buildSnapTargets({ elements, excludeIds: [], page: { w: 2000, h: 2800 }, nodes: {}, currentNodeId: 'root' });
        const built = performance.now() - t0;
        const t1 = performance.now();
        for (let i = 0; i < 1000; i++) snapMove(T, { x: i * 1.7, y: i * 2.3, w: 60, h: 30 }, { grid: 10, guides: true, threshold: 6 });
        const queried = performance.now() - t1;
        expect(built).toBeLessThan(200);
        expect(queried).toBeLessThan(300);
    });
});

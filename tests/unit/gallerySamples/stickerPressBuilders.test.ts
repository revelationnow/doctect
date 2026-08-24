import { describe, expect, it } from 'vitest';
import { loadStickerPressScope, runStickerPressGenerator } from './stickerPressScope';

const scope = loadStickerPressScope(['builders', 'svgMarkup', 'DEVICES']);

const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/;

/**
 * Per-builder argument domains. Each entry is one array per positional argument, listing every
 * value that argument should be swept across: every value for an enum/boolean argument, and
 * min/mid/max for a numeric range. `cartesian()` below expands this into every combination, so
 * a builder's *worst* argument combination is always exercised, not just whichever tuple someone
 * happened to hand-write.
 *
 * Tasks 5-8 extend this file with their own builders: add a domain entry per new builder here
 * rather than hand-listing argument tuples, and the four sweep assertions below cover it for free.
 */
const ARG_DOMAINS: Record<string, unknown[][]> = {
    tab: [['rounded', 'square', 'angled'], [true, false]],
    flag: [['swallow', 'point', 'straight']],
    bookmark: [[true, false]],
    cornerTriangle: [[true, false]],
    dogEar: [[1, 2, 3]], // min/mid/max of the documented 1-3 range
    banner: [[true, false], [true, false]],
    pennant: [[true, false]],
    scroll: [[1, 2]],
    rosette: [[8, 12, 16]], // min/mid/max of the documented 8-16 range
    tape: [[true, false]],
    tag: [[true, false]],
    stickyNote: [['plain', 'lined', 'torn']],
    speechBubble: [['left', 'right', 'none']],
    // Task 5: structural — arrows, markers, stars, dividers.
    arrow: [
        ['straight', 'curved', 'looped', 'elbow', 'uturn'],
        ['line', 'block', 'doodle'],
        ['plain', 'dashed', 'branch'],
    ],
    hand: [['left', 'right', 'up', 'down']],
    checkbox: [['empty', 'checked', 'crossed']],
    bullet: [['dot', 'star', 'arrow', 'diamond', 'square']],
    pip: [[true, false]],
    priorityFlag: [[1, 2, 3]], // min/mid/max of the documented 1-3 range
    // `star` already exists from Task 3 but had no sweep coverage until now (it was never added
    // to ARG_DOMAINS by Task 3 or 4, so it was completely untested by this file). Domain is the
    // two documented sample values used throughout the plan (star(5, 0.5), star(8, 0.4)), swept
    // as a full cross-product rather than only the two literal pairs the plan happened to show.
    star: [[5, 8], [0.4, 0.5]],
    sparkle: [[4, 6, 8]], // min/mid/max of the documented 4-8 range
    burst: [[8, 12, 16], [true, false]], // min/mid/max of the documented 8-16 range
    seal: [[10, 15, 20]], // min/mid/max of the documented 10-20 range
    medal: [[true, false]],
    rule: [['dotted', 'dashed', 'wave', 'zigzag', 'double']],
    flourish: [['left', 'right', 'both']],
    bracket: [['left', 'right']],
    boxFrame: [['square', 'round', 'ornate']],
};

const cartesian = (domains: unknown[][]): unknown[][] =>
    domains.reduce<unknown[][]>(
        (combos, domain) => combos.flatMap(combo => domain.map(value => [...combo, value])),
        [[]],
    );

const BUILDER_CASES: Array<[string, unknown[]]> = Object.entries(ARG_DOMAINS).flatMap(
    ([name, domains]) => cartesian(domains).map((args): [string, unknown[]] => [name, args]),
);

/**
 * Conservative path-data bounding box. The test needs to know whether every point a shape's ink
 * actually touches stays inside 0-24 — scraping every numeric literal out of the path string
 * (the prior approach) misses this for arcs: `A rx ry rot laf sf x y` draws a curve whose extent
 * can reach `rx`/`ry` past its endpoints without either radius or that extent ever appearing as
 * a literal x/y coordinate in the string. A circle built from two `A` commands (as `scroll` and
 * `tag` do) is exactly this case — its top and bottom edge coordinates are never written down.
 *
 * This walks the path the way a renderer would, tracking the current point, and for curves
 * (C, Q, A) expands the box using the curve's control points, not just its final anchor. For C
 * and Q that alone is already a safe over-report — a bezier's true extent is always within its
 * control-point hull, and can be tighter than it, so this can flag a shape that's actually fine
 * but can never miss a shape that's actually out of bounds. For A, see `arcBox` below: the
 * safe-but-tight version needed one more step than "hull of the literals," because arcs don't
 * write their center down at all.
 *
 * Scope: only the commands this project's builders are constrained to use (M L H V C Q A Z, all
 * absolute — see templates.js's geometry contract). Lowercase/relative or S/T commands throw
 * rather than silently mis-measuring; a future builder that needs them should extend this parser
 * to handle them, not remove the guard.
 */
const pathBoundingBox = (d: string) => {
    const tokens = d.match(/[MLHVCQAZ]|-?\d+(?:\.\d+)?/g) ?? [];
    let i = 0;
    const next = () => Number(tokens[i++]);

    let curX = 0;
    let curY = 0;
    let startX = 0;
    let startY = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const expand = (x: number, y: number) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    };
    const expandBox = (cx: number, cy: number, rx: number, ry: number) => {
        minX = Math.min(minX, cx - rx);
        maxX = Math.max(maxX, cx + rx);
        minY = Math.min(minY, cy - ry);
        maxY = Math.max(maxY, cy + ry);
    };
    /**
     * SVG's own endpoint-to-center arc parameterization (spec appendix F.6.5), simplified for
     * this project's arcs: x-axis-rotation is always 0 (every builder emits `A rx ry 0 ...`), so
     * the rotation terms are omitted rather than carried through as dead multiplications by 1/0.
     * The `A` case in the walk below now enforces this (throws if rotation !== 0) rather than
     * silently discarding the token — for a rotated arc this formula's center would be wrong in
     * a way that can UNDER-report the bounding box, the one failure direction this whole guard
     * exists to prevent, so a future rotated arc must not slip past it silently.
     *
     * A first version of this helper expanded the box by rx/ry around *each arc endpoint*
     * instead of around the true center. That is a real bug, not just extra caution: the two
     * endpoints already sit ON the circle, so re-centering a full circle on each one produces a
     * box roughly double the true radius — it flagged `scroll`'s left roll (a genuine circle at
     * (5,12) r=4, true extent x:[1,9] y:[8,16]) as reaching x:-3. Computing the actual center and
     * bounding the full ellipse around *that* point is still safe (the traced arc, however much
     * of the ellipse it actually sweeps, is by construction a subset of that ellipse's points —
     * true regardless of the large-arc/sweep flags) without that false doubling.
     */
    const arcBox = (x1: number, y1: number, rxIn: number, ryIn: number, largeArc: number, sweep: number, x2: number, y2: number) => {
        let rx = Math.abs(rxIn);
        let ry = Math.abs(ryIn);
        const mx = (x1 - x2) / 2;
        const my = (y1 - y2) / 2;
        const lambda = (mx * mx) / (rx * rx) + (my * my) / (ry * ry);
        if (lambda > 1) {
            const s = Math.sqrt(lambda);
            rx *= s; ry *= s;
        }
        const sign = largeArc !== sweep ? 1 : -1;
        const num = rx * rx * ry * ry - rx * rx * my * my - ry * ry * mx * mx;
        const den = rx * rx * my * my + ry * ry * mx * mx;
        const co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den));
        const cxp = (co * rx * my) / ry;
        const cyp = (co * -ry * mx) / rx;
        expandBox(cxp + (x1 + x2) / 2, cyp + (y1 + y2) / 2, rx, ry);
    };

    while (i < tokens.length) {
        const cmd = tokens[i++];
        switch (cmd) {
            case 'M':
                curX = next(); curY = next();
                startX = curX; startY = curY;
                expand(curX, curY);
                break;
            case 'L':
                curX = next(); curY = next();
                expand(curX, curY);
                break;
            case 'H':
                curX = next();
                expand(curX, curY);
                break;
            case 'V':
                curY = next();
                expand(curX, curY);
                break;
            case 'C': {
                const x1 = next(); const y1 = next();
                const x2 = next(); const y2 = next();
                curX = next(); curY = next();
                expand(x1, y1); expand(x2, y2); expand(curX, curY);
                break;
            }
            case 'Q': {
                const x1 = next(); const y1 = next();
                curX = next(); curY = next();
                expand(x1, y1); expand(curX, curY);
                break;
            }
            case 'A': {
                const rx = next(); const ry = next();
                const rotation = next(); // x-axis-rotation -- always 0 in this project's arcs, see arcBox above
                if (rotation !== 0) {
                    throw new Error(`pathBoundingBox: rotated arc (x-axis-rotation=${rotation}) is unsupported in "${d}"`);
                }
                const largeArc = next(); const sweep = next();
                const x = next(); const y = next();
                arcBox(curX, curY, rx, ry, largeArc, sweep, x, y);
                curX = x; curY = y;
                break;
            }
            case 'Z':
                curX = startX; curY = startY;
                break;
            default:
                throw new Error(`pathBoundingBox: unsupported command "${cmd}" in "${d}"`);
        }
    }
    return { minX, maxX, minY, maxY };
};

describe('sticker press structural builders', () => {
    it.each(BUILDER_CASES)('%s produces valid path data', (name, args) => {
        const result = scope.builders[name](...(args as unknown[]));
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toMatch(PATH_DATA);
    });

    it.each(BUILDER_CASES)('%s stays inside the 24x24 viewBox', (name, args) => {
        const result = scope.builders[name](...(args as unknown[]));
        const { minX, maxX, minY, maxY } = pathBoundingBox(result);
        expect(minX).toBeGreaterThanOrEqual(0);
        expect(minY).toBeGreaterThanOrEqual(0);
        expect(maxX).toBeLessThanOrEqual(24);
        expect(maxY).toBeLessThanOrEqual(24);
    });

    it.each(BUILDER_CASES)('%s fits the markup byte budget', (name, args) => {
        const markup = scope.svgMarkup(scope.builders[name](...(args as unknown[])), '#f0c674', '#23292f');
        expect(Buffer.byteLength(markup, 'utf8')).toBeLessThanOrEqual(400);
    });

    it.each(BUILDER_CASES)('%s is deterministic', (name, args) => {
        expect(scope.builders[name](...(args as unknown[])))
            .toBe(scope.builders[name](...(args as unknown[])));
    });
});

import { MARK } from '../lib/page';
import type { TemplateDefinition } from '../lib/project';

export const ISOMETRIC_SPACING_MM = 5;
const DOT_RADIUS_MM = 0.32;

const round = (value: number) => Number(value.toFixed(3));

// A triangular lattice: neighbouring dots 5 mm apart in every direction, alternate rows shifted
// half a step. The `dots` pattern only draws square lattices, so the dots are an SVG in mm units.
export const isometricLattice = (widthMm: number, heightMm: number, spacing = ISOMETRIC_SPACING_MM) => {
    const rowStep = spacing * Math.sqrt(3) / 2;
    const circles: string[] = [];
    for (let row = 0; DOT_RADIUS_MM + row * rowStep <= heightMm - DOT_RADIUS_MM; row++) {
        const y = DOT_RADIUS_MM + row * rowStep;
        for (let x = DOT_RADIUS_MM + (row % 2 ? spacing / 2 : 0); x <= widthMm - DOT_RADIUS_MM; x += spacing) {
            circles.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${DOT_RADIUS_MM}"/>`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(widthMm)} ${round(heightMm)}" `
        + `preserveAspectRatio="none"><g fill="${MARK}">${circles.join('')}</g></svg>`;
};

export const isometricDotPaper: TemplateDefinition = {
    slug: '09-isometric-dot-paper',
    listing: {
        name: 'Isometric Dot Paper',
        description: 'Isometric dot grid for sketching 3D shapes, room layouts, game maps and product ideas: dots 5 mm '
            + 'apart on a triangular grid, so lines at 30°, 90° and 150° connect neatly. Sized for reMarkable Paper Pro, '
            + 'Paper Pro Move, and 10.3″ devices (reMarkable 2, Supernote, Boox).',
        tags: ['template', 'paper', 'isometric', 'dot-grid', 'sketch', 'drawing'],
    },
    draw(p) {
        p.heading('Isometric');
        const b = p.box;
        p.svg('lattice', b.x, b.y, b.w, b.h, isometricLattice(b.w, b.h));
        p.row(ISOMETRIC_SPACING_MM);
    },
};

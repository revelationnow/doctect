// The Sticker Press — templates script.
// Section 1: device profiles.

const OUTLINE = '#23292f';

const DEVICES = [
    { id: 'paper_pro', name: 'Paper Pro', width: 509, height: 679,
      structural: [48, 32, 20], wideStructural: [[192, 24], [128, 16], [80, 10]],
      pictorial: [48, 24], rail: 'full', palette: 'colour' },
    { id: 'move', name: 'Paper Pro Move', width: 260, height: 463,
      structural: [36, 24, 16], wideStructural: [[144, 18], [96, 12], [60, 8]],
      pictorial: [36, 18], rail: 'reduced', palette: 'colour' },
    { id: 'note_air', name: 'Boox Note Air 5C', width: 446, height: 595,
      structural: [42, 28, 18], wideStructural: [[168, 21], [112, 14], [70, 9]],
      pictorial: [42, 21], rail: 'full', palette: 'colour' },
    { id: 'pure', name: 'Paper Pure', width: 447, height: 596,
      structural: [42, 28, 18], wideStructural: [[168, 21], [112, 14], [70, 9]],
      pictorial: [42, 21], rail: 'full', palette: 'ink' },
];

// Section 2: shape builders. Each returns SVG path data for a 24x24 viewBox.

const round1 = n => Math.round(n * 10) / 10;

const builders = {
    // A regular star. points >= 3, innerRatio in (0, 1).
    star(points, innerRatio) {
        const segments = [];
        for (let i = 0; i < points * 2; i += 1) {
            const radius = (i % 2 === 0 ? 11 : 11 * innerRatio);
            const angle = (Math.PI * i) / points - Math.PI / 2;
            segments.push(`${round1(12 + radius * Math.cos(angle))} ${round1(12 + radius * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // A leaf with an optional centre vein.
    leaf(vein) {
        const body = 'M12 2C6 7 4 14 12 22C20 14 18 7 12 2Z';
        return vein ? `${body}M12 5V20` : body;
    },
    // Index tab. Notch cuts a V into the right edge for a filing-tab look.
    tab(style, notch) {
        const right = notch ? 'H20L17 12L20 18' : 'H20V18';
        const lead = style === 'rounded' ? 'M4 6Q4 3 7 3'
            : style === 'angled' ? 'M4 6L7 3'
            : 'M4 3';
        return `${lead}H20V6${right}H4Z`;
    },
    // Page-marker flag. tail shapes the free edge: swallow fork, single point, or a flat cut.
    flag(tail) {
        const right = tail === 'point' ? 'H18L22 12L18 20'
            : tail === 'swallow' ? 'H21L17 12L21 20'
            : 'H20V20';
        return `M3 4${right}H3Z`;
    },
    // Ribbon bookmark. ribbon cuts the classic two-tail notch into the bottom edge.
    bookmark(ribbon) {
        const bottom = ribbon ? 'V22L12 16L6 22' : 'V22H6';
        return `M6 2H18${bottom}Z`;
    },
    // Solid corner triangle. fold adds a crease line near the tip.
    cornerTriangle(fold) {
        const crease = fold ? 'M24 0L14 4' : '';
        return `M24 0V14L10 0Z${crease}`;
    },
    // Turned-down page corner. size scales the fold and its crease line.
    dogEar(size) {
        const d = size * 6;
        const inset = round1(d / 3);
        return `M${24 - d} 0H24V${d}ZM${24 - inset} 0L24 ${inset}`;
    },
    // Ribbon banner. tails add the notched ends, fold adds the underlap.
    banner(tails, fold) {
        const body = 'M2 7H22V17H2Z';
        const tailShapes = tails ? 'M2 7L6 12L2 17ZM22 7L18 12L22 17Z' : '';
        const foldShape = fold ? 'M4 17V20L7 17Z' : '';
        return `${body}${tailShapes}${foldShape}`;
    },
    // Bunting pennant. notch cuts a small V into the hanging edge.
    pennant(notch) {
        const top = notch ? 'M3 3H10L12 6L14 3H21' : 'M3 3H21';
        return `${top}L12 21Z`;
    },
    // Rolled scroll. curls sets whether one or both ends are curled.
    scroll(curls) {
        const roll = cx => `M${cx - 4} 12A4 4 0 1 1 ${cx + 4} 12A4 4 0 1 1 ${cx - 4} 12Z`;
        const bandRight = curls === 2 ? 19 : 20;
        const right = curls === 2 ? roll(19) : '';
        return `M5 10H${bandRight}V14H5Z${roll(5)}${right}`;
    },
    // Award rosette. petals sets the pleat count of the fluted medallion; two ribbon tails hang below.
    // Coordinates are rounded to whole points (not round1) so the 16-petal case stays inside budget.
    rosette(petals) {
        const segments = [];
        for (let i = 0; i < petals * 2; i += 1) {
            const r = i % 2 === 0 ? 8 : 6;
            const angle = (Math.PI * i) / petals - Math.PI / 2;
            segments.push(`${Math.round(12 + r * Math.cos(angle))} ${Math.round(9 + r * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}ZM9 16L7 22L11 17ZM15 16L17 22L13 17Z`;
    },
    // Washi tape strip. torn gives both short edges a jagged cut.
    tape(torn) {
        return torn
            ? 'M2 9H22L20 10L22 11L20 12L22 13L20 14L22 15H2L4 14L2 13L4 12L2 11L4 10Z'
            : 'M2 9H22V15H2Z';
    },
    // Luggage/price tag. hole adds the string grommet near the point.
    tag(hole) {
        const body = 'M4 12L8 4H20V20H8Z';
        return hole ? `${body}M6 12A2 2 0 1 1 10 12A2 2 0 1 1 6 12Z` : body;
    },
    // Sticky note with a folded corner. lined adds rule lines, torn jags the bottom edge.
    stickyNote(style) {
        const flap = 'M17 3L21 7L17 7Z';
        if (style === 'lined') {
            return `M3 3H17L21 7V21H3Z${flap}M6 11H18M6 15H18M6 19H18`;
        }
        if (style === 'torn') {
            return `M3 3H17L21 7V19L18 21L15 19L12 21L9 19L6 21L3 19Z${flap}`;
        }
        return `M3 3H17L21 7V21H3Z${flap}`;
    },
    // Rounded speech bubble. tail points the callout left, right, or omits it.
    speechBubble(tail) {
        const body = 'M6 3H18Q21 3 21 6V12Q21 15 18 15H6Q3 15 3 12V6Q3 3 6 3Z';
        const tailShape = tail === 'left' ? 'M8 15L5 20L13 15Z'
            : tail === 'right' ? 'M11 15L19 20L16 15Z'
            : '';
        return `${body}${tailShape}`;
    },
};

const svgMarkup = (pathData, fill, stroke) =>
    `<svg viewBox="0 0 24 24"><path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;

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
    // Arrow. Shaft geometry, head shape and tail decoration compose freely. Every shaft variant
    // ends at (17, 8) so it always meets headShape's start point — the elbow and uturn shafts
    // originally stopped 4 units short (at y=12), leaving the arrowhead visibly floating apart
    // from the line; the elbow's corner and the uturn's final rise were both lifted to y=8 to
    // close that gap.
    arrow(curve, head, tail) {
        const shaft = curve === 'curved' ? 'M3 18Q12 18 17 8'
            : curve === 'looped' ? 'M3 18Q12 22 14 14Q15 8 17 8'
            : curve === 'elbow' ? 'M3 18V8H17'
            : curve === 'uturn' ? 'M5 20V10Q5 5 11 5Q17 5 17 10V8'
            : 'M3 18L17 8';
        const headShape = head === 'block' ? 'M17 8L21 6L18 12Z'
            : head === 'doodle' ? 'M17 8L21 7M17 8L18 12'
            : 'M17 8L21 7M17 8L18 12';
        const tailShape = tail === 'branch' ? 'M3 18L7 14M3 18L7 22' : '';
        return `${shaft}${headShape}${tailShape}`;
    },
    // Pointing-hand marker. A blocky fist with a single extended finger, aimed by direction.
    hand(direction) {
        if (direction === 'left') return 'M20 6H14V10H5L3 12L5 14H14V18H20Z';
        if (direction === 'up') return 'M6 20V14H10V5L12 3L14 5V14H18V20Z';
        if (direction === 'down') return 'M6 4V10H10V19L12 21L14 19V10H18V4Z';
        return 'M4 6H10V10H19L21 12L19 14H10V18H4Z';
    },
    // Checkbox. A square frame with a true cut-through window (same hole technique as
    // `boxFrame`/`pip` — a solid filled square read as "empty" no differently than any other
    // filled box, so the interior has to actually be open). state adds a tick or a cross inside.
    checkbox(state) {
        const box = 'M4 4H20V20H4ZM7 7V17H17V7Z';
        if (state === 'checked') return `${box}M7 13L11 17L18 8`;
        if (state === 'crossed') return `${box}M7 7L17 17M17 7L7 17`;
        return box;
    },
    // Small list-bullet glyph. shape picks the marker: dot, star, arrow, diamond or square.
    bullet(shape) {
        if (shape === 'star') return 'M12 4L14.4 8.8L19.6 9.5L15.8 13.2L16.7 18.5L12 16L7.3 18.5L8.2 13.2L4.4 9.5L9.6 8.8Z';
        if (shape === 'arrow') return 'M6 5L19 12L6 19Z';
        if (shape === 'diamond') return 'M12 4L20 12L12 20L4 12Z';
        if (shape === 'square') return 'M6 6H18V18H6Z';
        return 'M5 12A7 7 0 1 1 19 12A7 7 0 1 1 5 12Z';
    },
    // Pip (dice/domino dot). filled draws a solid disc; unfilled cuts a true hole through the
    // middle via a smaller concentric circle traced with the opposite winding direction.
    pip(filled) {
        const outer = 'M6 12A6 6 0 1 1 18 12A6 6 0 1 1 6 12Z';
        return filled ? outer : `${outer}M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z`;
    },
    // Priority flag. A pole with `level` stacked pennants (1-3) reading as a signal-strength cue.
    priorityFlag(level) {
        const pole = 'M4 3V22';
        const flag = y => `M4 ${y}L14 ${y + 3}L4 ${y + 6}Z`;
        return `${pole}${[4, 10, 16].slice(0, level).map(flag).join('')}`;
    },
    // Twinkle sparkle. arms thin spikes (4-8) radiating from the centre; a much smaller inner
    // radius than `star` gives the thin twinkle look rather than a regular star polygon.
    sparkle(arms) {
        const segments = [];
        for (let i = 0; i < arms * 2; i += 1) {
            const r = i % 2 === 0 ? 11 : 2;
            const angle = (Math.PI * i) / arms - Math.PI / 2;
            segments.push(`${round1(12 + r * Math.cos(angle))} ${round1(12 + r * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // Impact burst. spikes (8-16) around the centre; jagged shortens every other outer point for
    // an irregular explosion silhouette instead of a clean sunburst. Coordinates rounded to whole
    // points (not round1) so the 16-spike jagged case stays comfortably inside budget (same fix
    // as rosette/seal — more points means more segments, so precision costs add up fast here).
    burst(spikes, jagged) {
        const segments = [];
        for (let i = 0; i < spikes * 2; i += 1) {
            const outer = jagged && i % 4 === 0 ? 9 : 11;
            const r = i % 2 === 0 ? outer : 5;
            const angle = (Math.PI * i) / spikes - Math.PI / 2;
            segments.push(`${Math.round(12 + r * Math.cos(angle))} ${Math.round(12 + r * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // Wax-seal medallion. scallops (10-20) sets the fluted-edge count. Coordinates rounded to
    // whole points (not round1) so the 20-scallop case stays inside budget (same fix as rosette).
    seal(scallops) {
        const segments = [];
        for (let i = 0; i < scallops * 2; i += 1) {
            const r = i % 2 === 0 ? 11 : 9;
            const angle = (Math.PI * i) / scallops - Math.PI / 2;
            segments.push(`${Math.round(12 + r * Math.cos(angle))} ${Math.round(12 + r * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // Award medal. A plain disc; ribbon adds two hanging ribbon-tail triangles below it.
    medal(ribbon) {
        const disc = 'M6 8A6 6 0 1 1 18 8A6 6 0 1 1 6 8Z';
        return ribbon ? `${disc}M9 13L7 21L11 15ZM15 13L17 21L13 15Z` : disc;
    },
    // Horizontal divider rule. style picks the decoration: dots, dashes, a wave, a zigzag or a
    // double line, all drawn as real path geometry (no stroke-dasharray in path data).
    rule(style) {
        if (style === 'dashed') return 'M2 12L6 12M9 12L13 12M16 12L20 12';
        if (style === 'wave') return 'M2 12Q7 4 12 12Q17 20 22 12';
        if (style === 'zigzag') return 'M2 16L6 8L10 16L14 8L18 16L22 8';
        if (style === 'double') return 'M2 9H22M2 15H22';
        return 'M2 12L3 12M6 12L7 12M10 12L11 12M14 12L15 12M18 12L19 12M22 12L23 12';
    },
    // Calligraphic flourish accent. side draws the curling swash on the left, right, or both.
    flourish(side) {
        const left = 'M12 12Q6 12 4 6Q3 3 6 3';
        const right = 'M12 12Q18 12 20 6Q21 3 18 3';
        if (side === 'right') return right;
        if (side === 'both') return `${left}${right}`;
        return left;
    },
    // Thick square bracket. side mirrors it between an opening "[" and a closing "]".
    bracket(side) {
        return side === 'right' ? 'M18 4H8V8H14V16H8V20H18Z' : 'M6 4H16V8H10V16H16V20H6Z';
    },
    // Decorative frame with a true cut-through window (outer boundary plus an inner boundary
    // traced with the opposite winding, same hole technique as `pip`). corners picks the outer
    // edge: sharp square, quarter-round, or bevelled ("ornate") corners.
    boxFrame(corners) {
        const hole = 'M7 7V17H17V7Z';
        if (corners === 'round') return `M3 7Q3 3 7 3H17Q21 3 21 7V17Q21 21 17 21H7Q3 21 3 17Z${hole}`;
        if (corners === 'ornate') return `M3 7L7 3H17L21 7V17L17 21H7L3 17Z${hole}`;
        return `M3 3H21V21H3Z${hole}`;
    },
};

const svgMarkup = (pathData, fill, stroke) =>
    `<svg viewBox="0 0 24 24"><path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;

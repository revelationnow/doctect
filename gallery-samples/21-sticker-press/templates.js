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

    // Task 6: weather builders.
    // Sun with evenly spaced rays. rays (6-12).
    sun(rays) {
        const spokes = [];
        for (let i = 0; i < rays; i += 1) {
            const angle = (Math.PI * 2 * i) / rays;
            spokes.push(`M${round1(12 + 8 * Math.cos(angle))} ${round1(12 + 8 * Math.sin(angle))}`
                + `L${round1(12 + 11 * Math.cos(angle))} ${round1(12 + 11 * Math.sin(angle))}`);
        }
        return `M12 5A7 7 0 1 1 11.9 5Z${spokes.join('')}`;
    },
    // Puffy cloud. A single deep dome carries the silhouette (a shallow multi-arc scallop reads
    // as a flat dash at 18px, not a cloud — an earlier version of this builder made exactly that
    // mistake: consecutive semicircle arcs whose radius is tied to their spacing get shallower
    // as more of them are packed in, and even the 3-puff case was barely a bump). puffs (3-5)
    // instead adds small round bumps riding along the dome's rim for texture; the dome itself is
    // fixed, so the sticker always reads as "cloud" regardless of puffs.
    cloud(puffs) {
        const dome = 'M4 16A8 8 0 1 1 20 16H4Z';
        let bumps = '';
        for (let i = 0; i < puffs; i += 1) {
            const cx = round1(7 + (10 / (puffs - 1 || 1)) * i);
            bumps += `M${round1(cx - 1.6)} 9A1.6 1.6 0 1 1 ${round1(cx + 1.6)} 9A1.6 1.6 0 1 1 ${round1(cx - 1.6)} 9Z`;
        }
        return `${dome}${bumps}`;
    },
    // Small deep-dome cloud (see `cloud`) with drops (2-4) falling below it.
    rain(drops) {
        const cloud = 'M6 10A6 6 0 1 1 18 10H6Z';
        const gap = 14 / (drops + 1);
        let dropShapes = '';
        for (let i = 1; i <= drops; i += 1) {
            const cx = round1(5 + gap * i);
            const topY = 13 + (i % 2) * 2;
            dropShapes += `M${cx} ${topY}Q${round1(cx + 1.6)} ${topY + 3} ${cx} ${topY + 5}`
                + `Q${round1(cx - 1.6)} ${topY + 3} ${cx} ${topY}Z`;
        }
        return `${cloud}${dropShapes}`;
    },
    // Small deep-dome cloud (see `cloud`) with two fixed rain streaks and an optional lightning
    // bolt.
    storm(bolt) {
        const cloud = 'M6 9A6 6 0 1 1 18 9H6Z';
        const rainDrops = 'M8 12Q9.6 15 8 17Q6.4 15 8 12ZM16 12Q17.6 15 16 17Q14.4 15 16 12Z';
        const boltShape = bolt ? 'M13 11L8 17H12L9 22L17 14H13Z' : '';
        return `${cloud}${rainDrops}${boltShape}`;
    },
    // Radial snowflake. arms (4-8), thicker at the base than `sparkle` so it survives
    // downscaling instead of thinning to a smudge.
    snowflake(arms) {
        const segments = [];
        for (let i = 0; i < arms * 2; i += 1) {
            const r = i % 2 === 0 ? 11 : 4;
            const angle = (Math.PI * i) / arms - Math.PI / 2;
            segments.push(`${round1(12 + r * Math.cos(angle))} ${round1(12 + r * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // Moon phase, 0 (thin waxing crescent) through 4 (full) to 7 (thin waning crescent) — the
    // eight classic phases. A two-arc lune: the limb is a fixed semicircle (always the sphere's
    // edge); the terminator's radius and bulge direction vary with phase. phase=0 is nudged off
    // its theoretical rx=9 so the terminator never exactly coincides with the limb — an exact
    // coincidence traces the same curve forward then back, a zero-area sliver that would stroke
    // as a bare arc instead of reading as a moon.
    moon(phase) {
        const waxing = phase <= 4;
        const s = waxing ? phase / 4 : (8 - phase) / 4; // 0 (new) .. 1 (full)
        const sameSide = s < 0.5; // terminator bulges the same side as the limb -> crescent
        const d = Math.abs(s - 0.5) * 2; // 0 at the half-moon point, 1 at either extreme
        const rx = round1(phase === 0 ? 8.5 : 9 * d);
        const limbSweep = waxing ? 1 : 0;
        const termSweep = sameSide ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
        const term = d === 0 ? 'L12 3' : `A${rx} 9 0 0 ${termSweep} 12 3`;
        return `M12 3A9 9 0 0 ${limbSweep} 12 21${term}Z`;
    },
    // Thick arch made of bands (3-6) concentric colour bands — represented as arch thickness
    // rather than literal stripes, since a single fill colour can't show banding directly.
    // outerR is capped at 9 (not a wider, more dramatic arch) because the outer arc is an exact
    // semicircle (chord length == diameter): the bounding-box check conservatively boxes the
    // *whole* implied circle around the arc's center, including the untraced lower half, so a
    // bigger radius here would fail range checks even though the drawn arc never dips below its
    // own baseline.
    rainbow(bands) {
        const thickness = round1(1.5 + bands * 0.9);
        const outerR = 9;
        const innerR = round1(outerR - thickness);
        return `M3 15A${outerR} ${outerR} 0 0 1 21 15L${round1(21 - thickness)} 15`
            + `A${innerR} ${innerR} 0 0 0 ${round1(3 + thickness)} 15Z`;
    },
    // Umbrella. open toggles a domed, scalloped canopy versus a narrow folded wrap; both get a
    // pole and a hook handle.
    umbrella(open) {
        if (!open) return 'M11 2H13V17H11ZM11 17A3 3 0 1 0 8 14Z';
        return 'M3 12A9 9 0 0 1 21 12L18 15L15 12L12 15L9 12L6 15L3 12Z'
            + 'M11 12H13V20H11ZM12 20A3 3 0 1 0 9 17Z';
    },
    // gusts (2-3) tapered swoosh lines of decreasing length, filled rather than stroked so they
    // stay visible at small sizes.
    wind(gusts) {
        const ys = [7, 13, 19];
        const lens = [16, 12, 8];
        const lines = [];
        for (let i = 0; i < gusts; i += 1) {
            const y = ys[i];
            const x0 = 3;
            const x1 = round1(x0 + lens[i]);
            const midX = round1((x0 + x1) / 2);
            lines.push(`M${x0} ${y}Q${midX} ${round1(y - 2.5)} ${x1} ${y}Q${midX} ${round1(y + 2.5)} ${x0} ${y}Z`);
        }
        return lines.join('');
    },

    // Task 6: botanical builders.
    // Fern. fronds (2-4) leaflet pairs branching off a straight stem, alternating sides. Each
    // leaflet is a plain 3-point triangle, not a curve — with up to 8 leaflets per sticker the
    // curved version (two Q commands each) pushed the 4-5 frond cases over the byte cap.
    fern(fronds) {
        const stem = 'M11.5 22L12.5 22L12.1 4L11.9 4Z';
        const leaflet = (x, y, dx, dy) => `M${x} ${y}L${round1(x + dx * 1.6)} ${round1(y + dy)}`
            + `L${round1(x + dx * 0.5)} ${round1(y + dy * 0.6)}Z`;
        const parts = [stem];
        const gap = 16 / (fronds + 1);
        for (let i = 1; i <= fronds; i += 1) {
            const y = round1(20 - gap * i);
            parts.push(leaflet(12, y, -3, -3));
            parts.push(leaflet(12, y, 3, -3));
        }
        return parts.join('');
    },
    // Diagonal branch. leaves (2-4) small leaves alternating along its length.
    branch(leaves) {
        const stem = 'M4.7 20.7L3.3 19.3L19.3 3.3L20.7 4.7Z';
        const leafShape = (x, y, dx, dy) => `M${x} ${y}Q${round1(x + dx)} ${round1(y + dy / 2)} `
            + `${round1(x + dx * 1.8)} ${round1(y + dy)}Q${round1(x + dx * 0.6)} ${round1(y + dy * 0.8)} ${x} ${y}Z`;
        const parts = [stem];
        const gap = 1 / (leaves + 1);
        for (let i = 1; i <= leaves; i += 1) {
            const t = gap * i;
            const x = round1(4 + 16 * t);
            const y = round1(20 - 16 * t);
            const side = i % 2 === 0 ? 1 : -1;
            parts.push(leafShape(x, y, side * 2.2, -4));
        }
        return parts.join('');
    },
    // Flower. petals >= 4; centre adds the seed circle.
    flower(petals, centre) {
        const shapes = [];
        for (let i = 0; i < petals; i += 1) {
            const angle = (Math.PI * 2 * i) / petals - Math.PI / 2;
            const cx = round1(12 + 6 * Math.cos(angle));
            const cy = round1(12 + 6 * Math.sin(angle));
            shapes.push(`M${cx} ${cy}A3 3 0 1 1 ${round1(cx - 0.1)} ${cy}Z`);
        }
        return `${shapes.join('')}${centre ? 'M12 9A3 3 0 1 1 11.9 9Z' : ''}`;
    },
    // Sprig. berries (2-4) fixed leaves plus a small radial cluster of round berries.
    sprig(berries) {
        const stem = 'M11.5 21L12.5 21L12.2 8L11.8 8Z';
        const leafL = 'M12 12Q7 12 6 8Q5.5 6 8 6Q10 8 12 12Z';
        const leafR = 'M12 10Q17 10 18 6Q18.5 4 16 4Q14 6 12 10Z';
        const parts = [stem, leafL, leafR];
        for (let i = 0; i < berries; i += 1) {
            const angle = (Math.PI * 2 * i) / berries;
            const cx = round1(12 + 3 * Math.cos(angle));
            const cy = round1(5 + 1.8 * Math.sin(angle));
            parts.push(`M${cx} ${round1(cy - 1.3)}A1.3 1.3 0 1 1 ${round1(cx - 0.1)} ${round1(cy - 1.3)}Z`);
        }
        return parts.join('');
    },
    // Mushroom. spots (0-4) true cut-through holes in the cap (same hole technique as `pip`).
    mushroom(spots) {
        const cap = 'M3 13A9 7 0 0 1 21 13H3Z';
        const stem = 'M10 13H14V21H10Z';
        const positions = [[8, 9], [16, 9], [12, 6], [9, 11], [15, 11]];
        const holes = positions.slice(0, spots)
            .map(([x, y]) => `M${x} ${round1(y - 1)}A1 1 0 1 0 ${round1(x - 0.1)} ${round1(y - 1)}Z`)
            .join('');
        return `${cap}${stem}${holes}`;
    },
    // Acorn. cap toggles a few ridge ticks across the cap for texture.
    acorn(cap) {
        const capShape = 'M6 10A6 4 0 0 1 18 10Z';
        const ridges = cap ? 'M9 8L9.5 6L10.4 8ZM12 7L12 5L13 7ZM15 8L14.5 6L13.6 8Z' : '';
        const body = 'M8 10C8 16 9.5 20 12 21C14.5 20 16 16 16 10Z';
        return `${capShape}${ridges}${body}`;
    },
    // Saguaro cactus. arms (0-2) rounded side bumps.
    cactus(arms) {
        const trunk = 'M9 21V9A3 3 0 1 1 15 9V21Z';
        const rightArm = 'M15 16H17A2 2 0 1 0 17 12H15Z';
        const leftArm = 'M9 16H7A2 2 0 1 1 7 12H9Z';
        if (arms === 0) return trunk;
        if (arms === 1) return `${trunk}${rightArm}`;
        return `${trunk}${rightArm}${leftArm}`;
    },
    // Rosette succulent. rings (1-3) sets the point count of a single pointed-leaf rosette —
    // thicker at the base than `star`/`sparkle` to read as fleshy leaves rather than spikes.
    succulent(rings) {
        const points = 4 + rings * 2;
        const segments = [];
        for (let i = 0; i < points * 2; i += 1) {
            const r = i % 2 === 0 ? 9 : 3.5;
            const angle = (Math.PI * i) / points - Math.PI / 2;
            segments.push(`${round1(12 + r * Math.cos(angle))} ${round1(12 + r * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // Tree. shape picks a round canopy, a stacked pine silhouette, or a leaning palm with fanned
    // fronds.
    tree(shape) {
        if (shape === 'pine') return 'M11 21V17H13V21ZM5 17L19 17L12 10ZM7 11L17 11L12 4Z';
        if (shape === 'palm') {
            const trunk = 'M11 21L13.5 8L15.5 8.3L13 21Z';
            const frond = (angle) => {
                const dx = round1(7 * Math.cos(angle));
                const dy = round1(7 * Math.sin(angle));
                const x = 14; const y = 8;
                const tx = round1(x + dx); const ty = round1(y + dy);
                const c1x = round1(x + dx * 0.4); const c1y = round1(y + dy * 0.4 - 1);
                const c2x = round1(x + dx * 0.4); const c2y = round1(y + dy * 0.4 + 1);
                return `M${x} ${y}Q${c1x} ${c1y} ${tx} ${ty}Q${c2x} ${c2y} ${x} ${y}Z`;
            };
            const angles = [-2.79, -2.09, -1.57, -1.05, -0.35];
            return `${trunk}${angles.map(frond).join('')}`;
        }
        return 'M11 21V15H13V21ZM12 3A6 6 0 1 1 11.9 3Z';
    },

    // Task 6: animal builders. Faces/bodies favour filled silhouettes with true cut-through
    // holes for eyes/spots (same technique as `pip`) over drawn outlines, so they read at 18px.
    // Cat face. pose picks open round eyes (holes) or closed sleepy eyes (thin filled lids).
    cat(pose) {
        const head = 'M5 13A7 7 0 1 1 19 13A7 7 0 1 1 5 13Z';
        const ears = 'M7 7L5 1L11 6ZM17 7L19 1L13 6Z';
        const nose = 'M11 14L13 14L12 15.5Z';
        const eyes = pose === 'sleepy'
            ? 'M8.7 12A1.3 0.4 0 1 1 10.3 12A1.3 0.4 0 1 1 8.7 12ZM13.7 12A1.3 0.4 0 1 1 15.3 12A1.3 0.4 0 1 1 13.7 12Z'
            : 'M9.5 11A1 1 0 1 0 9.4 11ZM14.5 11A1 1 0 1 0 14.4 11Z';
        return `${head}${ears}${eyes}${nose}`;
    },
    // Dog face. ears picks floppy droop-eared or pointy prick-eared.
    dog(ears) {
        const head = 'M5 13A7 7 0 1 1 19 13A7 7 0 1 1 5 13Z';
        const snout = 'M9 17A3 2.2 0 1 1 15 17A3 2.2 0 1 1 9 17Z';
        const nose = 'M11.6 17.3A0.6 0.6 0 1 1 11.5 17.3Z';
        const eyes = 'M9.5 11A1 1 0 1 0 9.4 11ZM14.5 11A1 1 0 1 0 14.4 11Z';
        const earShape = ears === 'floppy'
            ? 'M5 9Q2 10 2.5 14Q3 18 6 17Q5 13 5 9ZM19 9Q22 10 21.5 14Q21 18 18 17Q19 13 19 9Z'
            : 'M8 7L6 2L11 6ZM16 7L18 2L13 6Z';
        return `${head}${earShape}${snout}${eyes}${nose}`;
    },
    // Bird. wings picks a raised flight wing or a folded resting wing.
    bird(wings) {
        const body = 'M4 15A7 5 0 1 1 18 15A7 5 0 1 1 4 15Z';
        const head = 'M17 6.5A3.5 3.5 0 1 1 16.9 6.5Z';
        const beak = 'M20 9L23 10L20 11Z';
        const tail = 'M5 14L1 11L5 18Z';
        const eye = 'M18 9A0.7 0.7 0 1 0 17.9 9Z';
        const wing = wings === 'up' ? 'M8 13Q11 5 15 9Q12 12 8 13Z' : 'M6 13Q10 11 15 14Q10 17 6 15Z';
        return `${body}${head}${beak}${tail}${eye}${wing}`;
    },
    // Butterfly. pattern adds a pair of true cut-through spots on the upper wings.
    butterfly(pattern) {
        const body = 'M10.8 12A1.2 7 0 1 1 13.2 12A1.2 7 0 1 1 10.8 12Z';
        const antennae = 'M11 6L9.3 1.5L10.5 5.5ZM13 6L14.7 1.5L13.5 5.5Z';
        const wing = (x, y, dx, dy) => `M${x} ${y}Q${round1(x + dx * 0.3)} ${round1(y + dy * 1.3)} `
            + `${round1(x + dx)} ${round1(y + dy)}Q${round1(x + dx * 1.3)} ${round1(y + dy * 0.3)} ${x} ${y}Z`;
        const wingShapes = [wing(11, 10, -7, -5), wing(13, 10, 7, -5), wing(11, 14, -5, 4), wing(13, 14, 5, 4)].join('');
        const dots = pattern === 'dotted' ? 'M7 6.2A0.8 0.8 0 1 0 6.9 6.2ZM17 6.2A0.8 0.8 0 1 0 16.9 6.2Z' : '';
        return `${body}${antennae}${wingShapes}${dots}`;
    },
    // Bee. stripes (2-3) true cut-through bands across the body.
    bee(stripes) {
        const body = 'M6 13A6 4 0 1 1 18 13A6 4 0 1 1 6 13Z';
        const head = 'M20 13A2 2 0 1 1 19.9 13Z';
        const antenna = 'M20.5 11L22 8L21 11.5Z';
        const wing = 'M12 8.2A3 1.8 0 1 1 11.9 8.2Z';
        const gap = 8 / (stripes + 1);
        let bands = '';
        for (let i = 1; i <= stripes; i += 1) {
            const x = round1(8 + gap * i);
            bands += `M${x} 10L${x} 16L${round1(x + 0.9)} 16L${round1(x + 0.9)} 10Z`;
        }
        return `${body}${head}${antenna}${wing}${bands}`;
    },
    // Ladybug. spots (2-6) true cut-through spots on the dome.
    ladybug(spots) {
        const body = 'M5 13A7 6 0 1 1 19 13A7 6 0 1 1 5 13Z';
        const head = 'M9 7A3 3 0 1 1 8.9 7Z';
        const spine = 'M11.7 10H12.3V19H11.7Z';
        const positions = [[9, 12], [15, 12], [9, 16], [15, 16], [8, 14.5], [16, 14.5]];
        const dots = positions.slice(0, spots)
            .map(([x, y]) => `M${x} ${round1(y - 1)}A1 1 0 1 0 ${round1(x - 0.1)} ${round1(y - 1)}Z`)
            .join('');
        return `${body}${head}${spine}${dots}`;
    },
    // Snail. swirls (1-3) sets the size/offset of a single cut-through hole suggesting the
    // shell's coil, rather than a literal multi-turn spiral path.
    snail(swirls) {
        const shell = 'M9 9A6 6 0 1 1 21 9A6 6 0 1 1 9 9Z';
        const r = round1(3.5 - swirls * 0.5);
        const cx = round1(15 + swirls * 0.3);
        const hole = `M${cx} ${round1(9 - r)}A${r} ${r} 0 1 0 ${round1(cx - 0.1)} ${round1(9 - r)}Z`;
        const body = 'M9 15Q3 15 2 19Q1.5 22 5 21Q4 18 9 15Z';
        const antennae = 'M4 17L2 13L5 16ZM6 16L5 12L7 15Z';
        return `${shell}${hole}${body}${antennae}`;
    },
    // Sitting fox bust. tail toggles a bushy curled tail behind the body. Ears are deliberately
    // bigger/wider than `cat`'s and the snout is a wider wedge — at 18px the same head circle
    // with cat-sized ears and a thin snout was visually indistinguishable from `cat`/
    // `dog('pointy')`; oversizing the two features that make a fox a fox (ears, muzzle) is what
    // actually separates it at small size.
    fox(tail) {
        const head = 'M5 13A7 7 0 1 1 19 13A7 7 0 1 1 5 13Z';
        const snout = 'M8.5 16L15.5 16L12 22Z';
        const ears = 'M5 8L1 0L11 5ZM19 8L23 0L13 5Z';
        const eyes = 'M9.5 11A1 1 0 1 0 9.4 11ZM14.5 11A1 1 0 1 0 14.4 11Z';
        const body = 'M6 20A6 3 0 0 0 18 20Z';
        const tailShape = tail ? 'M17 19Q23 18 22 12Q21.5 9 18 10Q20.5 13 19 16Q18 18 17 19Z' : '';
        return `${head}${snout}${ears}${eyes}${body}${tailShape}`;
    },
    // Bear face. ears picks big cub-sized or small ears.
    bear(ears) {
        const head = 'M5 13A7 7 0 1 1 19 13A7 7 0 1 1 5 13Z';
        const r = ears === 'big' ? 3 : 2;
        const earL = `M${round1(7 - r)} 5A${r} ${r} 0 1 1 ${round1(7 + r)} 5A${r} ${r} 0 1 1 ${round1(7 - r)} 5Z`;
        const earR = `M${round1(17 - r)} 5A${r} ${r} 0 1 1 ${round1(17 + r)} 5A${r} ${r} 0 1 1 ${round1(17 - r)} 5Z`;
        const snout = 'M9 16A3 2.4 0 1 1 15 16A3 2.4 0 1 1 9 16Z';
        const nose = 'M11.6 16.2A0.6 0.6 0 1 1 11.5 16.2Z';
        const eyes = 'M9.3 11A0.9 0.9 0 1 0 9.2 11ZM14.7 11A0.9 0.9 0 1 0 14.6 11Z';
        return `${head}${earL}${earR}${snout}${eyes}${nose}`;
    },
    // Rabbit face. ears picks tall upright ears or lop-eared droop.
    rabbit(ears) {
        const head = 'M6 15A6 6 0 1 1 18 15A6 6 0 1 1 6 15Z';
        const nose = 'M11.5 17.3A0.6 0.6 0 1 1 11.4 17.3Z';
        const eyes = 'M9.3 13A0.9 0.9 0 1 0 9.2 13ZM14.7 13A0.9 0.9 0 1 0 14.6 13Z';
        const earShape = ears === 'droopy'
            ? 'M9 8Q4 9 3 14Q2.5 17 6 16Q7 12 9 8ZM15 8Q20 9 21 14Q21.5 17 18 16Q17 12 15 8Z'
            : 'M8 7A1.5 6 0 1 1 11 7A1.5 6 0 1 1 8 7ZM13 7A1.5 6 0 1 1 16 7A1.5 6 0 1 1 13 7Z';
        return `${head}${earShape}${eyes}${nose}`;
    },
    // Whale. spout toggles a couple of water droplets above the blowhole.
    whale(spout) {
        const body = 'M5 14A8 4.5 0 1 1 21 14A8 4.5 0 1 1 5 14Z';
        const flukeTop = 'M6 12L1 9L7 13Z';
        const flukeBottom = 'M6 16L1 19L7 15Z';
        const eye = 'M18 12A1 1 0 1 0 17.9 12Z';
        const spoutShape = spout ? 'M17 6Q18.5 8 17 10Q15.5 8 17 6ZM20 4Q21 5.5 20 7Q19 5.5 20 4Z' : '';
        return `${body}${flukeTop}${flukeBottom}${eye}${spoutShape}`;
    },
    // Fish. fins (1-3) small dorsal fins along the top.
    fish(fins) {
        const body = 'M4 13A7 5 0 1 1 18 13A7 5 0 1 1 4 13Z';
        const tail = 'M5 10L1 13L5 16Z';
        const eye = 'M15 11A1 1 0 1 0 14.9 11Z';
        const gap = 8 / (fins + 1);
        let dorsal = '';
        for (let i = 1; i <= fins; i += 1) {
            const x = round1(7 + gap * i);
            dorsal += `M${x} 8L${round1(x - 1.5)} 4L${round1(x + 1.5)} 6Z`;
        }
        return `${body}${tail}${eye}${dorsal}`;
    },
    // Owl. tufts toggles two pointed ear tufts; eyes are true cut-through discs with a solid
    // pupil re-filled inside (a hole nested inside a hole, back to solid — verified by shoelace,
    // not by intuition about sweep flags, per the hole-punching pitfall this project has hit
    // before).
    owl(tufts) {
        const body = 'M5 13A7 8 0 1 1 19 13A7 8 0 1 1 5 13Z';
        const eyeHoles = 'M9 8A3 3 0 1 0 8.9 8ZM15 8A3 3 0 1 0 14.9 8Z';
        const pupils = 'M9 10A1 1 0 1 1 8.9 10ZM15 10A1 1 0 1 1 14.9 10Z';
        const beak = 'M11 13L13 13L12 15Z';
        const tuftShape = tufts ? 'M8 6L6.5 1L10.5 4.5ZM16 6L17.5 1L13.5 4.5Z' : '';
        return `${body}${eyeHoles}${pupils}${beak}${tuftShape}`;
    },
};

const svgMarkup = (pathData, fill, stroke) =>
    `<svg viewBox="0 0 24 24"><path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;

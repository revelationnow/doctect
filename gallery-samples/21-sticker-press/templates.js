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
};

const svgMarkup = (pathData, fill, stroke) =>
    `<svg viewBox="0 0 24 24"><path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;

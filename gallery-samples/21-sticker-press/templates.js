// The Sticker Press — templates script.
// Section 1: device profiles.

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

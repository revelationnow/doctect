import type { SnapTargets } from './targets';
import type { Axis, Box, EdgeSide } from './types';
import type { Win } from './core';

export function spacingWin(_T: SnapTargets, _b: Box, _a: Axis, _threshold: number): Win | null { return null; }
export function sizeWin(_T: SnapTargets, _b: Box, _a: Axis, _edge: EdgeSide, _threshold: number): Win | null { return null; }

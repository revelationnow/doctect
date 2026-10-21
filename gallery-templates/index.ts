import type { TemplateDefinition } from './lib/project';
import { cornellNotes } from './templates/01-cornell-notes';
import { meetingNotes } from './templates/02-meeting-notes';
import { dailyPage } from './templates/03-daily-page';
import { weekOnOnePage } from './templates/04-week-on-one-page';
import { monthlyHabitTracker } from './templates/05-monthly-habit-tracker';
import { familyWeekBoard } from './templates/06-family-week-board';
import { mealPlanGroceryList } from './templates/07-meal-plan-grocery-list';
import { storyboard } from './templates/08-storyboard';
import { isometricDotPaper } from './templates/09-isometric-dot-paper';
import { chessScoreSheet } from './templates/10-chess-score-sheet';
import { cycleTracker } from './templates/11-cycle-tracker';

export const TEMPLATES: TemplateDefinition[] = [
    cornellNotes, meetingNotes, dailyPage, weekOnOnePage, monthlyHabitTracker, familyWeekBoard,
    mealPlanGroceryList, storyboard, isometricDotPaper, chessScoreSheet, cycleTracker,
];

import { createContext, useContext } from 'react';

/**
 * Provided by a host that shows `CloudMenu` and `AccountMenu` as plain rows (the phone ⋯ sheet)
 * instead of as a trigger with a popover (the page header on desktop and tablet). One component
 * serves both renderings, so every action keeps its handler. Outside a host the menus render
 * exactly as they always have.
 *
 * `onDismiss` closes the host once a one-shot action has completed (a cloud save) or a link is
 * followed, like the sheet's own rows. Actions that open a modal leave the host open: the menu
 * renders that modal itself, so closing the host would unmount the modal with it.
 */
export interface MenuListHost { onDismiss: () => void }

export const MenuListContext = createContext<MenuListHost | null>(null);
export const useMenuListHost = (): MenuListHost | null => useContext(MenuListContext);

/**
 * Row layout shared by the sheet's own items and the menus' list rendering (44px tall, 16px text),
 * with no text colour: for rows that set their own, since Tailwind resolves two text colours on
 * one element by its stylesheet order, not the class order, so an override next to `text-slate-700`
 * would not apply.
 */
export const MENU_ROW_BASE_CLASS = 'flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm';
/** The default row: the base layout in the sheet's text colour. */
export const MENU_ROW_CLASS = `${MENU_ROW_BASE_CLASS} text-slate-700`;

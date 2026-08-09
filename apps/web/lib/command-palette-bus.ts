/**
 * Lets anything open the search palette without the palette's `open` state
 * having to be lifted into the shell.
 *
 * The palette is mounted once, in `DashboardShell`. The trigger in the top bar
 * is a sibling, not a parent, so the alternative to this is hoisting `open`
 * into the shell and threading a setter down - which makes the shell hold
 * state it has no interest in, and makes any future opener (an empty state's
 * "search for it" link, say) another prop drilled through the tree.
 *
 * A window event is the smaller seam: the sender needs to know nothing except
 * that search exists.
 */

export const OPEN_SEARCH_EVENT = 'cos:open-search';

export function openSearchPalette(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

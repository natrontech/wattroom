/**
 * Scroll Home's "your rooms" section into view and put the cursor in the
 * name field. A plain `href="#rooms"` cannot do this: SvelteKit's hash
 * navigation scrolls the WINDOW, and ADR-0020's shell is a fixed-height
 * frame whose page column scrolls instead — so the window had nothing to
 * move and the click did nothing (#1199). `scrollIntoView` scrolls the
 * nearest scrollable ancestor, which is the column.
 */
export function revealRooms(): void {
	document.getElementById('rooms')?.scrollIntoView({ block: 'start' });
	(document.getElementById('open-room-name') as HTMLInputElement | null)?.focus(
		{
			preventScroll: true,
		},
	);
}

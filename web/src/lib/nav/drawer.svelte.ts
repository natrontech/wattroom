/**
 * Whether the navigation drawer is open (#1625). The root layout owns the
 * drawer; the voice channel's shell needs to know so its own Escape — which
 * clears the followed rider — stands down while the layout's Escape closes it.
 */
export const navDrawer = $state({ open: false });

const HIDDEN = 'wattroom.sidebar-hidden.v1';

function readHidden(): boolean {
	try {
		return localStorage.getItem(HIDDEN) === '1';
	} catch {
		return false;
	}
}

/**
 * Whether the rider tucked the sidebar away on a desk (md and up), remembered
 * per device. Below md the sidebar is the drawer above and this changes
 * nothing: the rider's width is not theirs to choose there.
 */
export const navFold = $state({ hidden: readHidden() });

export function hideSidebar(hidden: boolean): void {
	navFold.hidden = hidden;
	try {
		localStorage.setItem(HIDDEN, hidden ? '1' : '0');
	} catch {
		/* fine: it is open again next time, the safe way to fail */
	}
}

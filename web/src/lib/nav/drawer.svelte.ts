/**
 * Whether the navigation drawer is open (#1625). The root layout owns the
 * drawer; the room's shell needs to know so its own Escape — which clears
 * the followed rider — stands down while the layout's Escape closes it.
 */
export const navDrawer = $state({ open: false });

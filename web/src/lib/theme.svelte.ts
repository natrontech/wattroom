import { syncAppearance } from './appearance';
import { palette } from './palette.svelte';

/**
 * The scheme toggle (#113, rider-requested): auto follows the OS, dark and
 * light force it via data-theme + color-scheme — every light-dark() token
 * flips at once. The cave ignores all of this (app.css forces it dark).
 * The choice follows the account (#326); the local key is the pre-sign-in
 * fallback and what app.html paints before the bundle.
 */
const KEY = 'wattroom.theme.v1';
export type ThemeChoice = 'auto' | 'dark' | 'light';

const ORDER: ThemeChoice[] = ['auto', 'dark', 'light'];

let current = $state<ThemeChoice>('auto');
try {
	const saved = localStorage.getItem(KEY);
	if (saved === 'dark' || saved === 'light') current = saved;
} catch {
	/* storage unavailable: auto */
}

function apply() {
	const root = document.documentElement;
	if (current === 'auto') delete root.dataset.theme;
	else root.dataset.theme = current;
	palette.refresh();
}
apply();

function remember() {
	try {
		if (current === 'auto') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, current);
	} catch {
		/* fine — the choice just won't survive a reload */
	}
}

/** What the account stores: "" for auto, so "chosen" and "never chosen" differ. */
function stored(): string {
	return current === 'auto' ? '' : current;
}

export const theme = {
	get current() {
		return current;
	},
	set(next: ThemeChoice) {
		if (next === current) return;
		current = next;
		remember();
		apply();
		syncAppearance({ colorScheme: stored() });
	},
	cycle() {
		theme.set(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
	},
	/**
	 * The account's choice arrived (#326). A string wins over this device;
	 * null means no device has chosen yet, so this one's choice goes up.
	 */
	adopt(choice: string | null | undefined) {
		if (choice === null || choice === undefined) {
			if (stored()) syncAppearance({ colorScheme: stored() });
			return;
		}
		const next: ThemeChoice =
			choice === 'dark' || choice === 'light' ? choice : 'auto';
		if (next === current) return;
		current = next;
		remember();
		apply();
	},
};

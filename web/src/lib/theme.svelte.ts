import { palette } from './palette.svelte';

/**
 * The scheme toggle (#113, rider-requested): auto follows the OS, dark and
 * light force it via data-theme + color-scheme — every light-dark() token
 * flips at once. The cave ignores all of this (app.css forces it dark).
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

export const theme = {
	get current() {
		return current;
	},
	cycle() {
		current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
		try {
			if (current === 'auto') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, current);
		} catch {
			/* fine — the choice just won't survive a reload */
		}
		apply();
	},
};

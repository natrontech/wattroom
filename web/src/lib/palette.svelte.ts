/**
 * The rider's accent choice (#292), applied by overriding the two @theme
 * tokens on :root. Mirrors theme.svelte.ts deliberately — module-level state,
 * localStorage, applied on import — because ssr is off everywhere, so the
 * document exists by the time this runs.
 */
import {
	DEFAULT_CHOICE,
	DEFAULT_ID,
	parseChoice,
	resolve,
	tokenValue,
	type PaletteChoice,
} from './palette';

const KEY = 'wattroom.palette.v1';

let choice = $state<PaletteChoice>(DEFAULT_CHOICE);
try {
	choice = parseChoice(localStorage.getItem(KEY));
} catch {
	/* storage unavailable: the shipped palette */
}

function apply() {
	const root = document.documentElement;
	const active = resolve(choice);
	// Outrun is what app.css already defines: drop the overrides rather than
	// restate them, so the shipped palette can never drift from a copy here.
	if (active.id === DEFAULT_ID) {
		root.style.removeProperty('--color-watt');
		root.style.removeProperty('--color-neon');
		return;
	}
	root.style.setProperty('--color-watt', tokenValue(active.watt));
	root.style.setProperty('--color-neon', tokenValue(active.neon));
}
apply();

export const palette = {
	get choice() {
		return choice;
	},
	get active() {
		return resolve(choice);
	},
	select(next: PaletteChoice) {
		choice = next;
		try {
			if (next.kind === 'preset' && next.id === DEFAULT_ID) {
				localStorage.removeItem(KEY);
			} else {
				localStorage.setItem(KEY, JSON.stringify(next));
			}
		} catch {
			/* fine — the choice just won't survive a reload */
		}
		apply();
	},
};

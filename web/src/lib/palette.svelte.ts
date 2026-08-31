/**
 * The rider's theme (#331), applied to the document. Everything a theme owns
 * is a custom property, so applying one is writing two rule blocks: `:root`
 * for the app, and `.cave` for the ride — which stays dark whatever the rider
 * picked, because ride legibility was designed against black (ADR-0005,
 * amended in #113).
 *
 * The stored choice is an identity, never a family. Which family renders is
 * whatever the scheme setting resolves to right now, so `auto` keeps meaning
 * "follow the OS" and the choice survives the flip.
 */
import { TOKENS, type Theme, type ThemeFamily } from './palette';
import {
	DEFAULT_CHOICE,
	parseChoice,
	resolveTheme,
	themeFor,
	type ThemeChoice,
} from './themes';

const KEY = 'wattroom.palette.v1';
const STYLE_ID = 'wattroom-theme';

let choice = $state<ThemeChoice>(DEFAULT_CHOICE);
try {
	choice = parseChoice(localStorage.getItem(KEY));
} catch {
	/* storage unavailable: the default identity */
}

/** Light only when the rider asked for it, or the OS did and they did not. */
function activeFamily(): ThemeFamily {
	const forced = document.documentElement.dataset.theme;
	if (forced === 'light') return 'white';
	if (forced === 'dark') return 'dark';
	return window.matchMedia?.('(prefers-color-scheme: light)').matches
		? 'white'
		: 'dark';
}

let family = $state<ThemeFamily>(activeFamily());

function block(selector: string, theme: Theme): string {
	const body = TOKENS.map((t) => `--color-${t}: ${theme.tokens[t]};`).join('');
	return `${selector}{${body}}`;
}

function apply() {
	family = activeFamily();
	const active = resolveTheme(choice, family);
	// The cave takes the dark half of whatever identity is showing. For a dark
	// theme that is the same tokens, which costs nothing and keeps one path.
	const cave =
		active.identity === 'custom'
			? resolveTheme(choice, 'dark')
			: themeFor(active.identity, 'dark');

	let style = document.getElementById(STYLE_ID);
	if (!style) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		document.head.append(style);
	}
	style.textContent = `${block(':root', active)}${block('.cave', cave)}`;
}
apply();

// The OS can flip while `auto` is in force, and that changes which family
// renders — the stored identity does not change, the tokens under it do.
window
	.matchMedia?.('(prefers-color-scheme: light)')
	.addEventListener?.('change', apply);

export const palette = {
	get choice() {
		return choice;
	},
	get family() {
		return family;
	},
	get active() {
		return resolveTheme(choice, family);
	},
	/** Re-render under the current scheme — the toggle calls this after flipping. */
	refresh: apply,
	select(next: ThemeChoice) {
		choice = next;
		try {
			if (next.kind === 'preset' && next.identity === 'outrun') {
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

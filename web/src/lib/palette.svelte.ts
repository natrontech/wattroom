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
import { syncAppearance } from './appearance';
import { tokenDeclarations, type Theme, type ThemeFamily } from './palette';
import {
	DEFAULT_CHOICE,
	DEFAULT_IDENTITY,
	parseChoice,
	resolveTheme,
	serializeChoice,
	themeFor,
	type ThemeChoice,
} from './themes';

const KEY = 'wattroom.palette.v1';
/** The last token block applied — app.html paints it before the bundle (#398). */
const CSS_KEY = 'wattroom.palette.css.v1';
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
	return `${selector}{${tokenDeclarations(theme)}}`;
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
	const css = `${block(':root', active)}${block('.cave', cave)}`;
	style.textContent = css;
	// Last in <head>, so it wins over the stylesheet: in dev, Vite injects
	// app.css after the boot script's copy of this element.
	document.head.append(style);
	try {
		if (choice.kind === 'preset' && choice.identity === DEFAULT_IDENTITY)
			localStorage.removeItem(CSS_KEY);
		else localStorage.setItem(CSS_KEY, css);
	} catch {
		/* fine — the next load flashes the default once */
	}
}
apply();

// The OS can flip while `auto` is in force, and that changes which family
// renders — the stored identity does not change, the tokens under it do.
window
	.matchMedia?.('(prefers-color-scheme: light)')
	.addEventListener?.('change', apply);

function remember(next: ThemeChoice) {
	try {
		if (next.kind === 'preset' && next.identity === DEFAULT_IDENTITY) {
			localStorage.removeItem(KEY);
		} else {
			localStorage.setItem(KEY, JSON.stringify(next));
		}
	} catch {
		/* fine — the choice just won't survive a reload */
	}
}

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
		remember(next);
		apply();
		syncAppearance({ accentPalette: serializeChoice(next) });
	},
	/**
	 * The account's choice arrived (#326). A string — "" for the default —
	 * wins over this device; null means no device has chosen yet, so this
	 * one's choice goes up instead of being dropped.
	 */
	adopt(stored: string | null | undefined) {
		if (stored === null || stored === undefined) {
			if (serializeChoice(choice))
				syncAppearance({ accentPalette: serializeChoice(choice) });
			return;
		}
		const next = parseChoice(stored || null);
		if (serializeChoice(next) === serializeChoice(choice)) return;
		choice = next;
		remember(next);
		apply();
	},
};

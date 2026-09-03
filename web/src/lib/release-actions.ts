/**
 * What a release can offer a rider in one tap (#631). The what's-new notice is
 * the one moment somebody is thinking about what changed, so a release that
 * shipped something tryable hangs it here instead of hoping they go looking
 * for it on the profile page.
 *
 * `version` is the release that introduced the action, and `actionsFor` shows
 * it while that release is still news — the one being announced, or one the
 * rider skipped past. Nothing prunes this list: an action whose release is
 * behind every rider simply stops being selected, so entries can stay as the
 * record of what each release offered.
 */
import { palette } from './palette.svelte';
import { themeFor } from './themes';

export interface ReleaseAction {
	id: string;
	/** The release that introduced it. */
	version: string;
	/** One line: what the rider gets, in their words. */
	note: string;
	/** What the button says. A function — it can depend on the live scheme. */
	label: () => string;
	/** What it says once tapped; the button stays, disabled, rather than vanishing. */
	done: () => string;
	/** False when the action would be a no-op, and the notice leaves it out. */
	available: () => boolean;
	run: () => void;
}

const MONOKAI = 'monokai';

export const RELEASE_ACTIONS: ReleaseAction[] = [
	{
		id: 'monokai',
		version: '2026.09.25',
		note: 'A theme you may not have met: editor-gray with magenta on the numbers at night, warm paper by day.',
		// The stored choice is an identity, never a family (palette.svelte.ts),
		// so one button serves both settings and one tap survives the rider
		// flipping light/dark later. It only has to *name* the half their
		// scheme renders right now.
		label: () => `Try ${themeFor(MONOKAI, palette.family).name}`,
		done: () => `${themeFor(MONOKAI, palette.family).name} is on`,
		available: () =>
			!(
				palette.choice.kind === 'preset' && palette.choice.identity === MONOKAI
			),
		run: () => palette.select({ kind: 'preset', identity: MONOKAI }),
	},
];

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
import { scanSource, stale, type Allowlist } from './source-scan.test-helper';

/**
 * `.panel` owns its padding (#613). One component was drawn at eighteen
 * distinct padding combinations, which is what "the spacing varies panel to
 * panel" meant once it was counted; the app.css block now carries the four
 * densities and a call site picks one by name. The rule below is what stops a
 * nineteenth appearing: a class list that says `panel` does not also say
 * `p-*`, unless this file records why.
 *
 * An entry here is the justification, not an exemption — it has to say what
 * about that surface the four densities do not cover.
 */
const ALLOWLIST: Allowlist = {
	'*.css':
		'the stylesheet is where the four densities are defined, not a call site',
	'lib/components/ContextMenuHost.svelte':
		'a menu: its items carry the padding, and p-1 is the inset that keeps a highlighted item off the border',
	'lib/messages/Composer.svelte':
		'the emoji menu, taking ContextMenuHost’s inset for the same reason',
	'routes/home/+page.svelte':
		'the room switcher is a menu (py-1, inset as above); the friends-online row is pills at text-xs, which the card density would draw at twice their height',
	'routes/u/[id]/+page.svelte':
		'medals and rooms-in-common are two-column pills at text-xs/text-sm — tighter than a card, deliberately',
	'routes/dev/profile/+page.svelte':
		'the gallery mock of /u/[id], drawn at that page’s sizes',
	'routes/ramp/+page.svelte':
		'the ramp test is read from the saddle at arm’s length (ux.md), so its instruction cards keep p-8; the one with a control at the bottom also clears the phone’s browser chrome',
	'routes/ramp/RampResult.svelte':
		'the ramp result, read from the saddle — p-8 for the same reason',
	'routes/c/[code]/+page.svelte':
		'the invite door: a single centred card on an otherwise empty page, where py-10 is what keeps it from reading as a dropped fragment',
};

const PANEL = String.raw`(?<![-\w])panel(?![-\w])`;
/** `p-4`, `px-2.5`, `sm:pb-8` — not `pointer-events-none`, not `panel-lg`. */
const PAD = String.raw`(?<![-\w])(?:[a-z0-9-]+:)*p[xytbse]?-\d+(?:\.\d+)?(?![-\w])`;
/** A quoted class list holding both `panel` and a padding utility, either order. */
const PANEL_WITH_PADDING = new RegExp(
	`(["'\`])(?=[^"'\`]*${PANEL})(?=[^"'\`]*${PAD})[^"'\`]*\\1`,
	'gs',
);

describe('one panel, four densities (#613)', () => {
	it('never lets a call site spell its own padding', () => {
		const { offenders } = scanSource(PANEL_WITH_PADDING, ALLOWLIST);
		expect(
			offenders,
			`panels choosing their own density:\n${offenders.join('\n')}\n` +
				'Drop the padding for the default, or say panel-lg / panel-xl / ' +
				'panel-flush (app.css). If none of the four fits, add this file to ' +
				'ALLOWLIST with the reason.',
		).toEqual([]);
	});

	it('keeps no allowlist entry that excuses nothing', () => {
		const dead = stale(
			ALLOWLIST,
			scanSource(PANEL_WITH_PADDING, ALLOWLIST).used,
		);
		expect(
			dead,
			`ALLOWLIST entries with nothing left to excuse — delete them:\n  ${dead.join('\n  ')}`,
		).toEqual([]);
	});
});

/**
 * The kit's size variants (`panel-lg`, `btn-xs`, `input-xs`) beat their base
 * purely by emitting later in the utilities layer — app.css says so and
 * nothing held it. A Tailwind upgrade that reorders the layer would not error:
 * every roomy panel would quietly redraw at the default density, which is the
 * kind of regression that ships. So compile the real stylesheet and read the
 * order out of it.
 */
const require = createRequire(import.meta.url);
const SRC = resolve(import.meta.dirname, '..');

async function emissionOrder(candidates: string[]): Promise<string> {
	const compiled = await compile(readFileSync(join(SRC, 'app.css'), 'utf8'), {
		base: SRC,
		loadStylesheet: async (id, base) => {
			const file = require.resolve(
				id === 'tailwindcss' ? 'tailwindcss/index.css' : id,
				{ paths: [base] },
			);
			return {
				base: dirname(file),
				path: file,
				content: readFileSync(file, 'utf8'),
			};
		},
	});
	return compiled.build(candidates);
}

describe('a size variant emits after the base it overrides', () => {
	it('puts every panel density after .panel, and a one-off after both', async () => {
		const css = await emissionOrder([
			'panel',
			'panel-lg',
			'panel-xl',
			'panel-flush',
			'btn',
			'btn-xs',
			'btn-lg',
			'input',
			'input-xs',
			'p-1',
			'p-8',
			'px-6',
			'py-10',
		]);
		const at = (selector: string) => {
			const i = css.indexOf(`${selector} {`);
			expect(i, `${selector} is not in the built stylesheet`).toBeGreaterThan(
				-1,
			);
			return i;
		};
		// Later in the file wins at equal specificity: each of these has to
		// sit after the rule it is meant to override.
		for (const variant of ['.panel-lg', '.panel-xl', '.panel-flush']) {
			expect(at(variant), `${variant} must emit after .panel`).toBeGreaterThan(
				at('.panel'),
			);
		}
		for (const [base, variant] of [
			['.btn', '.btn-xs'],
			['.btn', '.btn-lg'],
			['.input', '.input-xs'],
		]) {
			expect(at(variant), `${variant} must emit after ${base}`).toBeGreaterThan(
				at(base),
			);
		}
		// A call site that keeps its own padding (the ALLOWLIST above) still
		// has to beat the density .panel now carries.
		for (const one of ['.p-1', '.p-8', '.px-6', '.py-10']) {
			expect(at(one), `${one} must emit after .panel`).toBeGreaterThan(
				at('.panel'),
			);
		}
	});
});

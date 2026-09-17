/**
 * The theme gate (ADR-0023) as data, not assertions. palette.test.ts enforces
 * every one of these in CI; this module holds the actual formulas so the
 * editor (routes/dev/theme-editor) can show the same pass/fail live, against
 * a draft that has never been near a test run. One set of rules, two callers
 * — a floor changed here changes both at once, which is the point (#402).
 *
 * Every contrast check also carries its APCA Lc and, where that Lc falls under
 * APCA's absolute floor, a warning. Both are **reported** (ADR-0023 §3, #621):
 * nothing here reads `lc` or `warning` to decide `passes`, because enforcing an
 * absolute would fail Outrun's own Z1 and move ADR-0005's palette sideways.
 */
import {
	apca,
	contrast,
	dichromatDistance,
	hexToOklch,
	hueDistance,
	perceptualDistance,
	type ColourVision,
} from './color';
import {
	CONTRAST,
	DANGER_HUE,
	DARK_SURFACE_MAX_L,
	WHITE_SURFACE_MIN_L,
	type Theme,
	type TokenName,
} from './palette';

export const ZONES: TokenName[] = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'];

/** Worst contrast this token scores against the theme's own two surfaces. */
export function worst(theme: Theme, token: TokenName): number {
	return Math.min(
		contrast(theme.tokens[token], theme.tokens.surface),
		contrast(theme.tokens[token], theme.tokens['surface-raised']),
	);
}

/**
 * The worst APCA Lc this token scores against the theme's own two surfaces —
 * the same question `worst` asks, under the other formula. Reported beside the
 * WCAG figure, never compared to a floor that decides anything (ADR-0023 §3).
 */
export function worstLc(theme: Theme, token: TokenName): number {
	return Math.min(
		apca(theme.tokens[token], theme.tokens.surface),
		apca(theme.tokens[token], theme.tokens['surface-raised']),
	);
}

/**
 * APCA's absolute floor for a non-text element to be discernible at all.
 * Reported as a warning and nothing more (#621): `zoneFloor` scales to the
 * family's own reference, so a zone can clear its floor while sitting under
 * this — Outrun's dark Z1 does, at Lc 9.23. Enforcing the number would fail
 * the reference identity's own ramp and change ADR-0005's palette as a side
 * effect of a tooling change, which is a decision a person makes with the
 * number in front of them, not something a gate does on their behalf.
 */
export const APCA_MIN_LC = 15;

/**
 * The identity every other theme is measured against (ADR-0023). Takes the
 * catalogue rather than importing themes.ts directly — themes.ts already
 * imports this module's ZONES-adjacent neighbours, and the editor supplies
 * its own draft theme through the same shape, so the reference lookup stays
 * a plain function argument instead of a second entry point into the
 * catalogue.
 */
export function reference(family: Theme['family'], catalogue: Theme[]): Theme {
	return catalogue.find((t) => t.identity === 'outrun' && t.family === family)!;
}

/**
 * Zones are graphical objects, so 3:1 — except where the reference is
 * deliberately lower. Outrun's Z1 sits at 1.9 because recovery is meant to
 * recede, and a gate that fails the design known to work at three metres is
 * the wrong gate (ADR-0023 §3).
 */
export function zoneFloor(token: TokenName, ref: Theme): number {
	return Math.min(CONTRAST.accent, worst(ref, token) * 0.95);
}

/**
 * Adjacent-zone separation is held to the reference pair at the same
 * position, not to a number someone picked. Outrun's own Z6→Z7 gap is the
 * tightest in the ramp; a floor invented above it would fail the design
 * ADR-0005 shipped.
 */
export function adjacentFloor(
	ref: Theme,
	index: number,
	measure: (a: string, b: string) => number,
): number {
	return measure(ref.tokens[ZONES[index]], ref.tokens[ZONES[index + 1]]) * 0.9;
}

export interface GateCheck {
	id: string;
	label: string;
	value: number;
	floor: number;
	passes: boolean;
	unit: string;
	/** Set when a known exception waives this failure — never blank the reason out. */
	exempt?: string;
	/**
	 * APCA Lc for the same pair, where the check is a contrast one. Reported
	 * only: it is on the object beside `value`, and nothing reads it to decide
	 * `passes` (ADR-0023 §3).
	 */
	lc?: number;
	/** A reported observation that deliberately does not fail the check (#621). */
	warning?: string;
}

function check(
	id: string,
	label: string,
	value: number,
	floor: number,
	passes: boolean,
	unit = ':1',
	lc?: number,
): GateCheck {
	const c: GateCheck = { id, label, value, floor, passes, unit };
	if (lc !== undefined) {
		c.lc = lc;
		// "issue 621", not "#621": no-raw-hex.test.ts cannot tell a three-digit
		// hex from an issue number, and it scans strings after stripping comments.
		if (lc < APCA_MIN_LC)
			c.warning = `Lc ${lc.toFixed(2)} is under APCA's Lc ${APCA_MIN_LC}, the floor below which an element stops being discernible at all. Reported, not enforced — see issue 621.`;
	}
	return c;
}

/**
 * A named, on-record departure from the gate — a decision, not code nobody
 * looked at. Add an entry here only after checking the failure is the kind
 * that genuinely can't be resolved by moving a colour (#620): the surface
 * pair itself is the point of the theme, and the shared white-family zone
 * ramp can't separate against it without erasing that. See #621 for the
 * standing question of whether the gate itself should change instead.
 */
export const EXCEPTIONS: {
	themeId: string;
	checkId: string;
	reason: string;
}[] = [
	{
		themeId: 'monokai-day',
		checkId: 'z3',
		reason:
			"surface-raised is close in lightness to surface by design — the shared ramp's z3 falls to 2.72:1 against it, short of the 3:1 floor.",
	},
	{
		themeId: 'monokai-day',
		checkId: 'z4',
		reason:
			'same trade-off as z3 above — the ramp loses contrast headroom overall.',
	},
	{
		themeId: 'monokai-day',
		checkId: 'z6',
		reason:
			'same trade-off as z3 above — the ramp loses contrast headroom overall.',
	},
	{
		themeId: 'monokai-day',
		checkId: 'z4-z5-deuteranopia',
		reason:
			'same trade-off as z3 above — the ramp loses separation, not this specific pair.',
	},
	{
		themeId: 'monokai-day',
		checkId: 'z5-z6-deuteranopia',
		reason:
			'same trade-off as z3 above — the ramp loses separation, not this specific pair.',
	},
	{
		themeId: 'monokai-day',
		checkId: 'z5-z6-protanopia',
		reason:
			'same trade-off as z3 above — the ramp loses separation, not this specific pair.',
	},
];

export function exemption(
	themeId: string,
	checkId: string,
): string | undefined {
	return EXCEPTIONS.find((e) => e.themeId === themeId && e.checkId === checkId)
		?.reason;
}

/**
 * Every check palette.test.ts runs against a theme, as data instead of
 * assertions — `catalogue` supplies the reference identity a theme is
 * measured against (THEMES for a catalogue entry, or THEMES plus the draft
 * itself for the editor, since a draft theme isn't in THEMES yet).
 */
export function gateChecks(theme: Theme, catalogue: Theme[]): GateCheck[] {
	const ref = reference(theme.family, catalogue);
	const checks: GateCheck[] = [];

	for (const token of ['ink', 'muted', 'muted-dim'] as const) {
		const value = worst(theme, token);
		checks.push(
			check(
				token,
				`${token} · text`,
				value,
				CONTRAST.text,
				value >= CONTRAST.text,
				':1',
				worstLc(theme, token),
			),
		);
	}
	for (const token of ['watt', 'neon', 'danger'] as const) {
		const value = worst(theme, token);
		checks.push(
			check(
				token,
				`${token} · accent`,
				value,
				CONTRAST.accent,
				value >= CONTRAST.accent,
				':1',
				worstLc(theme, token),
			),
		);
	}
	for (const token of ZONES) {
		const value = worst(theme, token);
		const floor = zoneFloor(token, ref);
		checks.push(
			check(
				token,
				`${token} · zone contrast`,
				value,
				floor,
				value >= floor,
				':1',
				worstLc(theme, token),
			),
		);
	}
	for (const token of ZONES) {
		const value = hexToOklch(theme.tokens[token]).c;
		const floor = hexToOklch(ref.tokens[token]).c * 0.8;
		checks.push(
			check(
				`${token}-chroma`,
				`${token} · chroma floor`,
				value,
				floor,
				value >= floor,
				'',
			),
		);
	}
	{
		const value = contrast(theme.tokens.paper, theme.tokens.ink);
		checks.push(
			check(
				'paper-ink',
				'paper on ink',
				value,
				CONTRAST.text,
				value >= CONTRAST.text,
				':1',
				apca(theme.tokens.paper, theme.tokens.ink),
			),
		);
	}
	{
		const value = contrast(theme.tokens.paper, theme.tokens.danger);
		checks.push(
			check(
				'paper-danger',
				'paper on danger',
				value,
				CONTRAST.text,
				value >= CONTRAST.text,
				':1',
				apca(theme.tokens.paper, theme.tokens.danger),
			),
		);
	}
	{
		const value = hueDistance(hexToOklch(theme.tokens.danger).h, DANGER_HUE);
		checks.push(
			check('danger-hue', 'danger stays on-hue', value, 15, value <= 15, '°'),
		);
	}
	{
		const l = hexToOklch(theme.tokens.surface).l;
		const floor =
			theme.family === 'dark' ? DARK_SURFACE_MAX_L : WHITE_SURFACE_MIN_L;
		const passes = theme.family === 'dark' ? l <= floor : l >= floor;
		checks.push(
			check(
				'surface-lightness',
				`surface stays ${theme.family}`,
				l,
				floor,
				passes,
				' L',
			),
		);
	}
	{
		const value = hueDistance(
			hexToOklch(theme.tokens.watt).h,
			hexToOklch(theme.tokens.neon).h,
		);
		checks.push(
			check(
				'accent-separation',
				'watt/neon hue separation',
				value,
				30,
				value >= 30,
				'°',
			),
		);
	}
	for (let i = 0; i < ZONES.length - 1; i++) {
		const value = perceptualDistance(
			theme.tokens[ZONES[i]],
			theme.tokens[ZONES[i + 1]],
		);
		const floor = adjacentFloor(ref, i, perceptualDistance);
		checks.push(
			check(
				`${ZONES[i]}-${ZONES[i + 1]}-delta`,
				`${ZONES[i]}→${ZONES[i + 1]} · perceptual gap`,
				value,
				floor,
				value >= floor,
				'',
			),
		);
	}
	for (const kind of ['deuteranopia', 'protanopia'] as ColourVision[]) {
		for (let i = 0; i < ZONES.length - 1; i++) {
			const measure = (a: string, b: string) => dichromatDistance(a, b, kind);
			const value = measure(theme.tokens[ZONES[i]], theme.tokens[ZONES[i + 1]]);
			const floor = adjacentFloor(ref, i, measure);
			checks.push(
				check(
					`${ZONES[i]}-${ZONES[i + 1]}-${kind}`,
					`${ZONES[i]}→${ZONES[i + 1]} · ${kind}`,
					value,
					floor,
					value >= floor,
					'',
				),
			);
		}
	}
	for (const c of checks) {
		const reason = exemption(theme.id, c.id);
		if (reason) c.exempt = reason;
	}
	return checks;
}

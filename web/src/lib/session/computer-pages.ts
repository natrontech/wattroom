import { hrZoneOf } from '$lib/components/zones';
import { wkg } from '$lib/format';
import { formatSplit } from '$lib/road/ghost';
import { ordinal, type RaceReadout } from '$lib/race/race-view';
import { isTyping } from '$lib/keys';
import type { LiveStats } from '$lib/ride/live-stats.svelte';

/**
 * The bike computer's page table (ADR-0071, docs/SPEC.md "The bike
 * computer"): which numbers each page of slot 3 shows, and nothing a rider
 * picks. RIDE is where every ride starts. CLIMB and MAP arrive with the
 * climb card (#3089); RACE shows while you race (#3174).
 */
export const PAGES = ['ride', 'power', 'race'] as const;
export type ComputerPage = (typeof PAGES)[number];

export const PAGE_NAMES: Record<ComputerPage, string> = {
	ride: 'RIDE',
	power: 'POWER',
	race: 'RACE',
};

/** Everything a page may read. Absent means this ride has no such number. */
export interface ComputerContext {
	/** This second's watts: what RIDE shows before the 3 s average exists. */
	watts: number;
	cadence: number;
	hr: number;
	kg: number;
	/** Your own LTHR, for your own bpm's zone (ADR-0014). */
	lthr?: number;
	/** Nothing is being measured (#2851): the last numbers are not live. */
	stale: boolean;
	/** Your live score, where nothing else on the surface ranks it (ADR-0046). 0–1. */
	execution?: number;
	/** The gear field's words, "Gear 15" or "+3" (ADR-0084). */
	gear?: string;
	/** The slope the trainer rides, percent. */
	grade?: number;
	/** The dot on a road — never the trainer's own speed (ADR-0084). */
	road?: { speedKph: number; km: number; ofKm: number };
	/** Behind (+) or ahead (−) of your ghost, seconds (#3615, ADR-0068). */
	split?: { seconds: number; best: boolean };
	/** The block's target watts, while one is asked. */
	target?: number;
	/** This rider's live numbers (#3068); absent where this screen has none. */
	stats?: LiveStats;
	/** Your race, while you race one (#3174). */
	race?: RaceReadout;
	/**
	 * The surface draws the 3 s power above the computer already, so RIDE
	 * leaves it out: one number, one home (TARGETS D17, #3667).
	 */
	head?: boolean;
	/**
	 * The computer draws its own head (#3668): the 3 s power with W/kg
	 * beside it and the zone under it. RIDE then leaves out Power and W/kg,
	 * POWER its 3 s field, and Execution moves to POWER — the one-home table.
	 */
	ownHead?: boolean;
	/** Slot 1 carries the road line (km x of y, grade), so RIDE leaves them out. */
	roadLine?: boolean;
}

export interface Field {
	key: string;
	label: string;
	value: string;
	unit?: string;
	/** Live data in the watt accent, glowing: the 3 s power, and only it. */
	glow?: boolean;
	/** Rider state in neon, never the watt accent (ADR-0005): the gear, and a race model's outputs (#3174). */
	neon?: boolean;
	/** The heart-rate zone, as a dot beside the label. */
	zone?: number;
}

/**
 * A road's numbers for RIDE (#3628): the dot's speed — never the trainer's
 * own (ADR-0084) — the road's own grade, and how far along it the dot is.
 */
export function roadContext(road: {
	virtualMps: number;
	m: number;
	length: number;
	roadPct: number;
}): Pick<ComputerContext, 'road' | 'grade'> {
	return {
		road: {
			speedKph: road.virtualMps * 3.6,
			km: road.m / 1000,
			ofKm: road.length / 1000,
		},
		grade: road.roadPct,
	};
}

/** POWER reads the live numbers, so a screen without them has RIDE alone; RACE is there while you race. */
export function pagesFor(
	stats: LiveStats | undefined,
	race?: RaceReadout,
): ComputerPage[] {
	return PAGES.filter(
		(p) => p === 'ride' || (p === 'power' ? !!stats : !!race),
	);
}

/** The page a turn lands on, wrapping at both ends. */
export function turned(
	pages: readonly ComputerPage[],
	page: ComputerPage,
	dir: 1 | -1,
): ComputerPage {
	const at = Math.max(0, pages.indexOf(page));
	return pages[(at + dir + pages.length) % pages.length];
}

export function fieldsFor(page: ComputerPage, ctx: ComputerContext): Field[] {
	const measured = (value: string) => (ctx.stale ? '—' : value);
	const stats = ctx.stats?.seconds ? ctx.stats : undefined;
	if (page === 'race') return raceFields(ctx);
	if (page === 'power') {
		const s = ctx.stats;
		if (!s) return [];
		const block = ctx.target
			? { label: 'Block', value: `${s.blockAverage}/${ctx.target}` }
			: { label: 'Average', value: `${s.blockAverage}` };
		const fields: Field[] = [
			{
				key: 'power3',
				label: '3 s',
				value: measured(`${s.power3}`),
				unit: 'W',
				glow: !ctx.stale,
			},
			{
				key: 'power10',
				label: '10 s',
				value: measured(`${s.power10}`),
				unit: 'W',
			},
			{
				key: 'power30',
				label: '30 s',
				value: measured(`${s.power30}`),
				unit: 'W',
			},
			{ key: 'block', ...block, unit: 'W' },
			{ key: 'norm', label: 'NormPower', value: `${s.normPower}`, unit: 'W' },
			{ key: 'intensity', label: 'Intensity', value: s.intensity.toFixed(2) },
			// 1 kJ = 1 XP (docs/SPEC.md "Stats formulas").
			{ key: 'xp', label: 'Work', value: `+${s.kj}`, unit: 'XP' },
			{ key: 'load', label: 'Load', value: `${Math.round(s.load)}` },
		];
		if (!ctx.ownHead) return fields;
		const rest = fields.filter((f) => f.key !== 'power3');
		const execution = executionField(ctx);
		return execution ? [execution, ...rest] : rest;
	}
	const fields: Field[] =
		ctx.head || ctx.ownHead
			? []
			: [
					{
						key: 'power',
						label: 'Power',
						value: measured(`${stats ? stats.power3 : Math.round(ctx.watts)}`),
						unit: 'W',
						glow: !ctx.stale,
					},
				];
	if (ctx.road)
		fields.push({
			key: 'speed',
			label: 'Speed',
			value: ctx.road.speedKph.toFixed(1),
			unit: 'km/h',
		});
	if (ctx.grade !== undefined && !ctx.roadLine)
		fields.push({
			key: 'grade',
			label: 'Grade',
			value: ctx.grade.toFixed(1),
			unit: '%',
		});
	if (ctx.road && !ctx.roadLine)
		fields.push({
			key: 'distance',
			label: 'Distance',
			value: `${ctx.road.km.toFixed(1)} of ${ctx.road.ofKm.toFixed(1)}`,
			unit: 'km',
		});
	fields.push({
		key: 'cadence',
		label: 'Cadence',
		value: measured(`${ctx.cadence}`),
		unit: 'rpm',
	});
	// Only with something reporting it: a permanent "0 bpm" reads as a broken
	// strap rather than as no strap (#1057).
	if (ctx.hr > 0)
		fields.push({
			key: 'hr',
			label: 'Heart',
			value: measured(`${ctx.hr}`),
			unit: 'bpm',
			zone: ctx.lthr && !ctx.stale ? hrZoneOf(ctx.hr, ctx.lthr) : 0,
		});
	if (!ctx.ownHead) {
		fields.push({
			key: 'wkg',
			label: 'W/kg',
			value: measured(wkg(ctx.watts, ctx.kg)),
		});
		const execution = executionField(ctx);
		if (execution) fields.push(execution);
	}
	if (ctx.gear)
		fields.push({
			key: 'gear',
			label: 'Gear',
			value: ctx.gear.replace(/^Gear /, ''),
			neon: true,
		});
	// After the sensors and the gear, as the one-home table orders RIDE.
	if (ctx.split)
		// A ghost is a memory, not live data: no watt, no glow (ADR-0068).
		fields.push({
			key: 'split',
			label: ctx.split.best ? 'vs best' : 'vs last',
			value: formatSplit(ctx.split.seconds),
		});
	return fields;
}

/** Your live score, where nothing else on the surface ranks it (ADR-0046). */
function executionField(ctx: ComputerContext): Field | null {
	return ctx.execution === undefined
		? null
		: {
				key: 'execution',
				label: 'Execution',
				value: `${Math.round(ctx.execution * 100)}`,
				unit: '%',
			};
}

/**
 * RACE (#3174): the gap to your Category's par, then your place in your
 * Category — the race model's, so neon and never watt; only your live power
 * is. The gap leads at the computer's number size, and W/kg stays in its one
 * home beside the 3 s power: the 3 s power is the largest number on the
 * surface, and no number shows twice (docs/design/TARGETS.md "One home per
 * number").
 */
function raceFields(ctx: ComputerContext): Field[] {
	const race = ctx.race;
	if (!race) return [];
	return [
		{
			key: 'par',
			label: 'vs par',
			// Ahead is +, behind is −; nothing to measure before km 0.
			value: race.par === null ? '—' : formatSplit(race.par),
			neon: true,
		},
		{
			key: 'place',
			label: `in ${race.category}`,
			value: `${ordinal(race.place)} of ${race.of}`,
			neon: true,
		},
	];
}

// Events a computer has already turned a page with: one key press turns
// every computer on the page (the desk's and the TV's) the same way, and the
// preventDefault the first one made is not a neighbour's claim to the next.
const claimed = new WeakSet<Event>();

/**
 * The page turn a key asks for — ← or → only (ADR-0071) — claimed so the
 * page does not also scroll. Never while typing, never with a modifier, and
 * never an event something else already handled: the pane divider and the
 * interval graph's edit keys take their arrows first and say so with
 * preventDefault. PgUp/PgDn, the shift keys and Space are not page keys.
 */
export function claimPageTurn(event: KeyboardEvent): 1 | -1 | null {
	if (event.defaultPrevented && !claimed.has(event)) return null;
	if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
		return null;
	if (isTyping(event)) return null;
	const dir =
		event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : null;
	if (dir === null) return null;
	claimed.add(event);
	event.preventDefault();
	return dir;
}

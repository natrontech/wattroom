import { hrZoneOf } from '$lib/components/zones';
import { formatClock, wkg } from '$lib/format';
import type { ClimbView } from '$lib/ride/climb-view';
import { formatSplit } from '$lib/road/ghost';
import { isTyping } from '$lib/keys';
import type { LiveStats } from '$lib/ride/live-stats.svelte';

/**
 * The bike computer's page table (ADR-0071, docs/SPEC.md "The bike
 * computer"): which numbers each page of slot 3 shows, and nothing a rider
 * picks. RIDE is where every ride starts. CLIMB and MAP arrive with the
 * climb card (#3089), RACE with #3174.
 */
export const PAGES = ['ride', 'climb', 'power'] as const;
export type ComputerPage = (typeof PAGES)[number];

export const PAGE_NAMES: Record<ComputerPage, string> = {
	ride: 'RIDE',
	climb: 'CLIMB',
	power: 'POWER',
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
	/** The climb card while a classed climb is near (#3645). */
	climb?: ClimbView | null;
}

export interface Field {
	key: string;
	label: string;
	value: string;
	unit?: string;
	/** Live data in the watt accent, glowing: the 3 s power, and only it. */
	glow?: boolean;
	/** Rider state in neon, never the watt accent (ADR-0005): the gear. */
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

/**
 * The pages this ride has now: RIDE always, CLIMB while a classed climb is
 * near (#3645), and POWER where the screen has its own live numbers.
 */
export function pagesFor(
	ctx: Pick<ComputerContext, 'stats' | 'climb'>,
): ComputerPage[] {
	return PAGES.filter(
		(page) =>
			page === 'ride' ||
			(page === 'climb' && !!ctx.climb) ||
			(page === 'power' && !!ctx.stats),
	);
}

/** A distance on the card: metres to the hundred below a kilometre, then km. */
const distance = (m: number) =>
	m < 1000
		? { value: `${Math.round(m / 100) * 100}`, unit: 'm' }
		: { value: (m / 1000).toFixed(1), unit: 'km' };

/** The CLIMB page's header (#3089): "CLIMB 3 of 4 · I · next climb in 4.8 km". */
export function climbHeader(view: ClimbView): string {
	const { n, of, cls, nextInM } = view.card;
	const next =
		nextInM !== undefined
			? ` · next climb in ${(nextInM / 1000).toFixed(1)} km`
			: '';
	return `CLIMB ${n} of ${of} · ${cls}${next}`;
}

/** The chip on another page, for a rider who paged away (#3089). */
export function climbChip(view: ClimbView): string {
	if (view.toFootM > 0) {
		const to = distance(view.toFootM);
		return `Climb ${view.card.cls} in ${to.value} ${to.unit} · → to view`;
	}
	const top = distance(view.card.toTopM);
	return `Climb ${view.card.cls} · ${top.value} ${top.unit} to the top · → to view`;
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
	if (page === 'climb') {
		const climb = ctx.climb;
		if (!climb) return [];
		const top = distance(climb.card.toTopM);
		return [
			{ key: 'toTop', label: 'To the top', ...top },
			{
				key: 'ascentLeft',
				label: 'Ascent left',
				value: `${Math.round(climb.card.ascentLeftM)}`,
				unit: 'm',
			},
			{
				key: 'avgLeft',
				label: 'Average left',
				value: climb.card.avgLeftPct.toFixed(1),
				unit: '%',
			},
			{
				key: 'gradeNow',
				label: 'Grade',
				value: climb.card.grade.toFixed(1),
				unit: '%',
			},
			{
				key: 'timeToTop',
				label: 'Time to top',
				value:
					climb.secondsToTop === null ? '—' : formatClock(climb.secondsToTop),
			},
		];
	}
	if (page === 'power') {
		const s = ctx.stats;
		if (!s) return [];
		const block = ctx.target
			? { label: 'Block', value: `${s.blockAverage}/${ctx.target}` }
			: { label: 'Average', value: `${s.blockAverage}` };
		return [
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
	}
	const fields: Field[] = [
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
	if (ctx.grade !== undefined)
		fields.push({
			key: 'grade',
			label: 'Grade',
			value: ctx.grade.toFixed(1),
			unit: '%',
		});
	if (ctx.split)
		// A ghost is a memory, not live data: no watt, no glow (ADR-0068).
		fields.push({
			key: 'split',
			label: ctx.split.best ? 'vs best' : 'vs last',
			value: formatSplit(ctx.split.seconds),
		});
	if (ctx.road)
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
	fields.push({
		key: 'wkg',
		label: 'W/kg',
		value: measured(wkg(ctx.watts, ctx.kg)),
	});
	if (ctx.execution !== undefined)
		fields.push({
			key: 'execution',
			label: 'Execution',
			value: `${Math.round(ctx.execution * 100)}`,
			unit: '%',
		});
	if (ctx.gear)
		fields.push({
			key: 'gear',
			label: 'Gear',
			value: ctx.gear.replace(/^Gear /, ''),
			neon: true,
		});
	return fields;
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

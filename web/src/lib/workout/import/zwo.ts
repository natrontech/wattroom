import { formatClock } from '$lib/format';
import type { SteadyStep, Workout, WorkoutStep } from '../types';
import { LIMITS } from '../validate';
import type { ImportOutcome } from './types';

/**
 * Zwift's `.zwo` into the docs/SPEC.md workout JSON (#2327).
 *
 * A converter, not a second format: WATTROOM.md:48 locks our JSON as the
 * workout model, so what comes out is an ordinary WattRoom workout the same
 * engine rides. Nothing here teaches the engine to run ZWO.
 *
 * The file is untrusted, and the parse is the browser's own: DOMParser in
 * `application/xml` mode resolves no external entities and refuses a DTD's
 * internal ones outright, so neither XXE nor entity expansion is reachable
 * from this path. Everything past the parse is bounded by `validateWorkout`,
 * the gate the editor and the server already share — this module invents no
 * bound of its own.
 */

/** Attributes, lower-cased: exporters disagree about `Duration` vs `duration`. */
function attrs(el: Element): Record<string, string> {
	const out: Record<string, string> = {};
	for (const attr of Array.from(el.attributes))
		out[attr.name.toLowerCase()] = attr.value;
	return out;
}

/** The first of `keys` that is present and a real number. */
function num(
	map: Record<string, string>,
	...keys: string[]
): number | undefined {
	for (const key of keys) {
		if (!(key in map)) continue;
		const value = Number(map[key]);
		if (Number.isFinite(value)) return value;
	}
	return undefined;
}

function text(root: Element, tag: string): string {
	return (root.getElementsByTagName(tag)[0]?.textContent ?? '').trim();
}

/**
 * What the file said and the conversion could not keep, counted rather than
 * repeated: a 30-block file with a cadence on every block would otherwise
 * bury the one note that matters under thirty copies of the same sentence.
 */
interface Lost {
	freeRideBlocks: number;
	freeRideSeconds: number;
	textEvents: number;
	exactCadence: number;
	unusableCadence: number;
	maxEfforts: number;
	unknown: Map<string, number>;
	description: boolean;
	nameTrimmed: boolean;
}

function plural(n: number, one: string, many: string): string {
	return n === 1 ? one : `${n} ${many}`;
}

function notesFrom(lost: Lost): string[] {
	const notes: string[] = [];
	if (lost.freeRideBlocks > 0) {
		notes.push(
			`${plural(lost.freeRideBlocks, 'One free-ride block', 'free-ride blocks')} could not be carried — WattRoom has no free-ride step — so the workout is ${formatClock(lost.freeRideSeconds)} shorter than the file.`,
		);
	}
	if (lost.maxEfforts > 0) {
		notes.push(
			`${plural(lost.maxEfforts, 'One max-effort block', 'max-effort blocks')} became ${lost.maxEfforts === 1 ? 'a sprint moment' : 'sprint moments'}: the trainer drops out of ERG for the window and you ride it all out.`,
		);
	}
	if (lost.exactCadence > 0) {
		notes.push(
			`${plural(lost.exactCadence, 'One block asks', 'blocks ask')} for one exact cadence. WattRoom shows a cadence range, not a single number, so ${lost.exactCadence === 1 ? 'it was' : 'they were'} left off.`,
		);
	}
	if (lost.unusableCadence > 0) {
		notes.push(
			`${plural(lost.unusableCadence, 'One cadence range', 'cadence ranges')} could not be shown and ${lost.unusableCadence === 1 ? 'was' : 'were'} left off: a range runs ${LIMITS.minCadence}–${LIMITS.maxCadence} rpm the right way up, and its floor has to clear the spiral guard's ${LIMITS.guardTripCadence} rpm trip.`,
		);
	}
	if (lost.textEvents > 0) {
		notes.push(
			`${plural(lost.textEvents, 'One ride instruction', 'ride instructions')} (text the file shows mid-ride) ${lost.textEvents === 1 ? 'was' : 'were'} left out — WattRoom has nowhere to show them.`,
		);
	}
	for (const [tag, count] of lost.unknown) {
		notes.push(
			`${plural(count, `One “${tag}” block`, `“${tag}” blocks`)} ${count === 1 ? 'is' : 'are'} not something WattRoom rides, so ${count === 1 ? 'it was' : 'they were'} left out.`,
		);
	}
	if (lost.description)
		notes.push(
			'The file’s description was left out — a WattRoom workout has a name and its steps, nothing else.',
		);
	if (lost.nameTrimmed)
		notes.push(
			`The name was longer than ${LIMITS.nameLength} characters and was cut to fit.`,
		);
	return notes;
}

/** A cadence range we can show, or nothing plus a tally of why not. */
function cadenceOf(
	map: Record<string, string>,
	lost: Lost,
): Partial<SteadyStep> {
	const low = num(map, 'cadencelow');
	const high = num(map, 'cadencehigh');
	if (low === undefined && high === undefined) {
		if (num(map, 'cadence') !== undefined) lost.exactCadence++;
		return {};
	}
	// Exactly validateWorkout's rule, not a stricter one: both ends inside the
	// rpm bounds, right way up, and the FLOOR clear of the spiral guard's trip
	// — a ceiling under it is a grinder drill the guard never fights.
	const inside = (v: number | undefined) =>
		v === undefined || (v >= LIMITS.minCadence && v <= LIMITS.maxCadence);
	if (
		!inside(low) ||
		!inside(high) ||
		(low !== undefined && low <= LIMITS.guardTripCadence) ||
		(low !== undefined && high !== undefined && low > high)
	) {
		lost.unusableCadence++;
		return {};
	}
	const band: Partial<SteadyStep> = {};
	if (low !== undefined) band.cadenceLow = Math.round(low);
	if (high !== undefined) band.cadenceHigh = Math.round(high);
	return band;
}

/** `Duration` in whole seconds, or the sentence naming the block that lacks it. */
function seconds(
	map: Record<string, string>,
	where: string,
	...keys: string[]
): number | string {
	const value = num(map, ...keys);
	if (value === undefined)
		return `${where}: the file does not say how long this block lasts.`;
	return Math.round(value);
}

function power(
	map: Record<string, string>,
	where: string,
	...keys: string[]
): number | string {
	const value = num(map, ...keys);
	if (value === undefined)
		return `${where}: the file does not say what power to hold here.`;
	return value;
}

function isMessage(value: number | string): value is string {
	return typeof value === 'string';
}

/**
 * Case-insensitively, because XML is not: `getElementsByTagName('textevent')`
 * alone walks straight past the `<TextEvent>` some exporters write, and a
 * prompt nobody counted is a prompt dropped in silence.
 */
function textEventsIn(el: Element): number {
	return Array.from(el.getElementsByTagName('*')).filter(
		(child) => child.tagName.toLowerCase() === 'textevent',
	).length;
}

/**
 * One ZWO element to zero or one WattRoom steps. A `null` step is a block
 * that was counted into `lost` instead — it is gone from the workout, and the
 * note says so. A string is the refusal that stops the whole import.
 */
function convert(
	el: Element,
	index: number,
	lost: Lost,
): WorkoutStep | null | string {
	const tag = el.tagName.toLowerCase();
	const map = attrs(el);
	const where = `Block ${index} (${el.tagName})`;
	lost.textEvents += textEventsIn(el);

	switch (tag) {
		case 'warmup':
		case 'cooldown':
		case 'ramp':
		case 'rampup':
		case 'rampdown': {
			const secs = seconds(map, where, 'duration');
			if (isMessage(secs)) return secs;
			// A `Power` with no low/high is a flat block written with a ramp's
			// name — keep the name, so the step stays unscored the way the file
			// meant it, and ramp from the one value to itself.
			const low = power(map, where, 'powerlow', 'power');
			if (isMessage(low)) return low;
			const high = num(map, 'powerhigh') ?? low;
			const type = tag === 'warmup' || tag === 'cooldown' ? tag : 'ramp';
			return { type, seconds: secs, from: low, to: high };
		}

		case 'steadystate':
		case 'solidstate': {
			const secs = seconds(map, where, 'duration');
			if (isMessage(secs)) return secs;
			const target = power(map, where, 'power', 'powerlow');
			if (isMessage(target)) return target;
			return { type: 'steady', seconds: secs, target, ...cadenceOf(map, lost) };
		}

		case 'intervalst': {
			const on = seconds(map, where, 'onduration');
			if (isMessage(on)) return on;
			const off = seconds(map, where, 'offduration');
			if (isMessage(off)) return off;
			const onPower = power(map, where, 'onpower', 'poweronhigh');
			if (isMessage(onPower)) return onPower;
			const offPower = power(map, where, 'offpower', 'powerofflow');
			if (isMessage(offPower)) return offPower;
			const times = num(map, 'repeat');
			if (times === undefined)
				return `${where}: the file does not say how many times to repeat.`;
			if (num(map, 'cadence') !== undefined) lost.exactCadence++;
			if (num(map, 'cadenceresting') !== undefined) lost.exactCadence++;
			return {
				type: 'repeat',
				times: Math.round(times),
				steps: [
					{ type: 'steady', seconds: on, target: onPower },
					{ type: 'steady', seconds: off, target: offPower },
				],
			};
		}

		case 'maxeffort': {
			const secs = seconds(map, where, 'duration');
			if (isMessage(secs)) return secs;
			lost.maxEfforts++;
			return { type: 'sprint', seconds: secs };
		}

		case 'freeride': {
			const secs = seconds(map, where, 'duration');
			lost.freeRideBlocks++;
			if (!isMessage(secs)) lost.freeRideSeconds += secs;
			return null;
		}

		default:
			lost.unknown.set(el.tagName, (lost.unknown.get(el.tagName) ?? 0) + 1);
			return null;
	}
}

/**
 * `fallbackName` is the file's own name, used when the ZWO carries none —
 * a workout without a name is refused downstream, and "Untitled" tells the
 * rider less than the file they just picked.
 */
export function parseZwo(source: string, fallbackName: string): ImportOutcome {
	if (typeof DOMParser === 'undefined')
		return { ok: false, error: 'This browser cannot read XML files.' };
	const doc = new DOMParser().parseFromString(source, 'application/xml');
	if (doc.getElementsByTagName('parsererror').length > 0)
		return {
			ok: false,
			error:
				'That file is not valid XML, so it cannot be a Zwift workout. Open it in a text editor — a .zwo starts with a <workout_file> tag.',
		};

	const root = doc.getElementsByTagName('workout_file')[0];
	if (!root)
		return {
			ok: false,
			error:
				'That XML file has no <workout_file> tag, so it is not a Zwift workout.',
		};
	const blocks = root.getElementsByTagName('workout')[0];
	if (!blocks)
		return {
			ok: false,
			error: 'That .zwo has no <workout> section, so there is nothing to ride.',
		};

	const lost: Lost = {
		freeRideBlocks: 0,
		freeRideSeconds: 0,
		textEvents: 0,
		exactCadence: 0,
		unusableCadence: 0,
		maxEfforts: 0,
		unknown: new Map(),
		description: text(root, 'description') !== '',
		nameTrimmed: false,
	};

	const steps: WorkoutStep[] = [];
	const children = Array.from(blocks.children);
	for (const [i, el] of children.entries()) {
		const step = convert(el, i + 1, lost);
		if (typeof step === 'string') return { ok: false, error: step };
		if (step) steps.push(step);
	}
	if (steps.length === 0)
		return {
			ok: false,
			error:
				children.length === 0
					? 'That .zwo has no blocks in it.'
					: 'Nothing in that .zwo is a block WattRoom can ride.',
		};

	const named = text(root, 'name') || fallbackName;
	if (named.length > LIMITS.nameLength) lost.nameTrimmed = true;
	const workout: Workout = {
		name: named.slice(0, LIMITS.nameLength),
		steps,
	};
	const author = text(root, 'author');
	if (author) workout.author = author.slice(0, LIMITS.nameLength);

	return { ok: true, imported: { workout, notes: notesFrom(lost) } };
}

import { DUR, HOLD_ANNOUNCE } from '$lib/motion/tokens';

/**
 * The moments queue (#3210, ADR-0079): one celebration on the stage at a
 * time, and a two-line ticker for the small things. A summit strip, a PR chip,
 * a sprint result and a finish each come from their own feature; nothing
 * stopped two landing at once, or one covering the next interval's target.
 *
 * Pure, on an injected clock: the consumer calls `tick()` from its own loop —
 * the world's frame, the Skyline's interval, the narrator's — and draws the
 * events it gets back. Zone changes are never staged; they are live data.
 */

/** Lower is more important (#3210). A higher moment cuts a lower one short. */
const PRIORITY = { finish: 1, result: 2, summit: 3, pr: 4 } as const;

/** Same-kind moments this close together are one moment (#3210). */
export const MERGE_MS = 1500;
/** A moment waits rather than land this close before an interval change (#3210). */
export const DEFER_MS = 5000;
/** The ticker never shows more lines than this (#3210). */
export const TICKER_LINES = 2;

export type Moment<P = unknown> =
	| { kind: 'finish'; payload: P }
	/** A race, sprint or Prime result — `won` is this rider's. */
	| {
			kind: 'result';
			of: 'race' | 'sprint' | 'prime';
			won: boolean;
			payload: P;
	  }
	/** A summit, or a KOM on one — `category` is the climb's. */
	| {
			kind: 'summit';
			category: 'HC' | '1' | '2' | '3' | '4' | null;
			payload: P;
	  }
	| { kind: 'pr'; payload: P };

export type MomentKind = Moment['kind'];

export interface MomentEvent<P = unknown> {
	kind: MomentKind;
	/** Every payload merged into this moment, oldest first. */
	payloads: P[];
	stage: 'enter' | 'hold' | 'exit';
	/** Whether this moment spends the confetti budget. */
	confetti: boolean;
}

export interface TickerLine {
	who: string;
	verb: string;
	/** "Anna ×3": how many times this rider did this since the line appeared. */
	count: number;
}

/**
 * The confetti budget (#3210): a finish, an HC or category I summit and a
 * race win, and nothing else — confetti on every PR is confetti on nothing.
 */
export function confetti(moment: Moment): boolean {
	switch (moment.kind) {
		case 'finish':
			return true;
		case 'summit':
			return moment.category === 'HC' || moment.category === '1';
		case 'result':
			return moment.of === 'race' && moment.won;
		default:
			return false;
	}
}

export interface MomentsDeps {
	now(): number;
	/** When the workout's next interval starts, if one is coming. */
	nextInterval?(): number | undefined;
	/** When another rider's open sprint window closes, while one is open. */
	sprintWindowEnd?(): number | undefined;
}

interface Staged<P> {
	moment: Moment<P>;
	payloads: P[];
	/** When the last same-kind moment merged in — the merge window runs from here. */
	lastAt: number;
	/** Arrival order, so equal priorities play first come, first served. */
	seq: number;
}

interface Showing<P> extends Staged<P> {
	stage: MomentEvent['stage'];
	since: number;
}

const LENGTH: Record<MomentEvent['stage'], number> = {
	enter: DUR.stage,
	hold: HOLD_ANNOUNCE,
	exit: DUR.quick,
};

export function createMoments<P = unknown>(deps: MomentsDeps) {
	const waiting: Staged<P>[] = [];
	const ticker: (TickerLine & { until: number })[] = [];
	let showing: Showing<P> | null = null;
	let seq = 0;
	let out: MomentEvent<P>[] = [];

	const rank = (s: Staged<P>) => PRIORITY[s.moment.kind];
	const say = (s: Showing<P>) =>
		out.push({
			kind: s.moment.kind,
			payloads: [...s.payloads],
			stage: s.stage,
			confetti: confetti(s.moment),
		});
	const to = (stage: MomentEvent['stage'], now: number) => {
		if (!showing) return;
		showing = { ...showing, stage, since: now };
		say(showing);
	};

	/** Nothing lands over the next target, or over someone else's sprint. */
	function blocked(now: number): boolean {
		const change = deps.nextInterval?.();
		if (change !== undefined && change > now && change - now <= DEFER_MS)
			return true;
		const sprint = deps.sprintWindowEnd?.();
		return sprint !== undefined && sprint > now;
	}

	return {
		/** A moment for the stage. */
		stage(moment: Moment<P>): void {
			const now = deps.now();
			const same = [showing, ...waiting].find(
				(s) =>
					s &&
					s.moment.kind === moment.kind &&
					now - s.lastAt <= MERGE_MS &&
					!(s === showing && showing.stage === 'exit'),
			);
			if (same) {
				same.payloads.push(moment.payload);
				same.lastAt = now;
				// On stage already: it holds again, whole, with the newcomer in it —
				// never a second entrance.
				if (same === showing) to('hold', now);
				return;
			}
			waiting.push({
				moment,
				payloads: [moment.payload],
				lastAt: now,
				seq: seq++,
			});
		},

		/** A line for the ticker lane: "Anna rang the bell". */
		ticker(who: string, verb: string): void {
			const until = deps.now() + HOLD_ANNOUNCE;
			const line = ticker.find((l) => l.who === who && l.verb === verb);
			if (line) {
				line.count += 1;
				line.until = until;
				return;
			}
			ticker.push({ who, verb, count: 1, until });
			while (ticker.length > TICKER_LINES) ticker.shift();
		},

		/** The ticker as it reads right now, oldest first. */
		tickerLines(): TickerLine[] {
			const now = deps.now();
			return ticker
				.filter((l) => l.until > now)
				.map(({ who, verb, count }) => ({ who, verb, count }));
		},

		/** Move the stage to `now` and hand back what changed since the last tick. */
		tick(): MomentEvent<P>[] {
			const now = deps.now();
			for (let i = ticker.length - 1; i >= 0; i--)
				if (ticker[i].until <= now) ticker.splice(i, 1);
			waiting.sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);

			for (let guard = 0; guard < 16; guard++) {
				if (showing) {
					const done = now - showing.since >= LENGTH[showing.stage];
					const outranked =
						showing.stage !== 'exit' &&
						waiting.length > 0 &&
						rank(waiting[0]) < rank(showing);
					if (outranked) to('exit', now);
					else if (!done) break;
					else if (showing.stage === 'enter')
						to('hold', showing.since + LENGTH.enter);
					else if (showing.stage === 'hold')
						to('exit', showing.since + LENGTH.hold);
					else showing = null;
					continue;
				}
				if (waiting.length === 0 || blocked(now)) break;
				showing = { ...waiting.shift()!, stage: 'enter', since: now };
				say(showing);
			}

			const events = out;
			out = [];
			return events;
		},
	};
}

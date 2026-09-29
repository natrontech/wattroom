/**
 * One shifter behind every shift input (#3326): the keys, the on-screen
 * pair, and later the phone and a Bluetooth controller. One state machine,
 * so a bouncing switch or a flood of presses cannot sweep the cassette, and
 * a held control does something.
 *
 * Pure, with time injected. It emits gear moves only: no countdown, no
 * auto-shift, no easing between gears and no resistance event of its own
 * (ADR-0084). Whether a move is possible is the drivetrain's to say.
 */

/** Harder is +1, easier −1. */
export type ShiftDir = 1 | -1;

/** A gear to move, or a press at an end of the cassette: nothing moves, one `block` cue plays. */
export interface ShiftEvent {
	kind: 'shift' | 'end';
	dir: ShiftDir;
	at: number;
}

/** docs/SPEC.md "The shifter" (defaults — tune in alpha). */
export const SHIFTER = {
	/** Presses from one source closer than this to its last edge are a bounce. */
	debounceMs: 40,
	/** At most one shift this often. */
	minGapMs: 100,
	/** Presses that wait behind the rate; opposite presses cancel out. */
	queue: 3,
	/** A held control repeats after this long… */
	holdMs: 400,
	/** …then this often. */
	repeatMs: 200,
} as const;

interface Held {
	dir: ShiftDir;
	nextRepeat: number;
}

export function createShifter(atEnd: (dir: ShiftDir) => boolean) {
	/** Each source's last accepted edge, press or release, for the debounce. */
	const lastEdge = new Map<string, number>();
	const held = new Map<string, Held>();
	/** Presses waiting behind the rate, oldest first; a repeat plays no end cue. */
	const queued: { dir: ShiftDir; repeat: boolean }[] = [];
	let lastShift = -Infinity;

	/** One move, or its end cue; false when the rate says wait. */
	function attempt(
		dir: ShiftDir,
		repeat: boolean,
		at: number,
		out: ShiftEvent[],
	): boolean {
		if (at - lastShift < SHIFTER.minGapMs) return false;
		if (atEnd(dir)) {
			if (!repeat) out.push({ kind: 'end', dir, at });
		} else {
			lastShift = at;
			out.push({ kind: 'shift', dir, at });
		}
		return true;
	}

	/** At most one queued press, if the rate allows it now. */
	function drain(at: number, out: ShiftEvent[]) {
		const next = queued[0];
		if (next && attempt(next.dir, next.repeat, at, out)) queued.shift();
	}

	function enter(
		dir: ShiftDir,
		repeat: boolean,
		at: number,
		out: ShiftEvent[],
	) {
		drain(at, out);
		const last = queued.at(-1);
		if (last && last.dir !== dir) {
			queued.pop();
			return;
		}
		if (
			queued.length === 0 &&
			out.length === 0 &&
			attempt(dir, repeat, at, out)
		)
			return;
		if (queued.length < SHIFTER.queue) queued.push({ dir, repeat });
	}

	return {
		/** A control went down. */
		press(dir: ShiftDir, at: number, source: string): ShiftEvent[] {
			const out: ShiftEvent[] = [];
			const edge = lastEdge.get(source);
			if (edge !== undefined && at - edge < SHIFTER.debounceMs) return out;
			lastEdge.set(source, at);
			held.set(source, { dir, nextRepeat: at + SHIFTER.holdMs });
			enter(dir, false, at, out);
			return out;
		},
		/** A control came up. */
		release(source: string, at: number) {
			lastEdge.set(source, at);
			held.delete(source);
		},
		/**
		 * A source that disconnected — a controller, the phone, a window that
		 * lost focus — releases whatever it held.
		 */
		drop(source: string) {
			held.delete(source);
			lastEdge.delete(source);
		},
		/** Time passing: queued presses, and a held control's repeats. */
		tick(at: number): ShiftEvent[] {
			const out: ShiftEvent[] = [];
			drain(at, out);
			for (const hold of held.values()) {
				if (at < hold.nextRepeat) continue;
				hold.nextRepeat = at + SHIFTER.repeatMs;
				enter(hold.dir, true, at, out);
			}
			return out;
		},
	};
}

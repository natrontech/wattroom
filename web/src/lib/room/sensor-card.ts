import type { PairState } from '$lib/room/sensor-status';

/**
 * What one sensor card says and offers, for a given state.
 *
 * Split out of the component (#1000) because one card now draws four
 * surfaces in two layouts — the grid on /settings/equipment, /ride, /ramp and the Training
 * place, the strip in a running session's header — and the seven states have
 * to read identically in both. It is also the only way to test the mapping
 * without a component-rendering dependency the repo does not have.
 */
export interface CardView {
	/** 'live' draws the device name, its reading and any fault hint. */
	shape: 'live' | 'note';
	/** The one line a rider reads when the card is not live. */
	note: string;
	tone: 'muted' | 'danger';
	/** Absent when there is nothing safe to press (ux.md). */
	button?: {
		label: string;
		variant: 'primary' | 'secondary' | 'forget';
	};
	/** Why there is no button — never a dead control, always a reason. */
	instead?: string;
}

export function cardView(args: {
	state: PairState;
	/** Web Bluetooth exists in this browser at all. */
	supported: boolean;
	/** The phrase for another of the rider's screens holding it (#610). */
	elsewhere?: string;
	/** Set while the trainer is paired but not reporting (#520). */
	hint?: string;
	/**
	 * The line naming the screen that writes the trainer's control point,
	 * when it is not this one (#2075) — `trainerTargetsNote`. Trainer-only:
	 * the three read-only sensors have no targets to come from anywhere, and
	 * a claim on one of those means something else entirely.
	 */
	targetsNote?: string;
}): CardView {
	// Live beats held: a card showing watts is this screen's, whatever another
	// screen also claims.
	//
	// It is still this screen's card when another screen drives (ADR-0025,
	// amended): the link, the watts and Forget all stay. Only the targets are
	// somewhere else, and that is the one thing the card used to leave out —
	// the `elsewhere` branch below is unreachable from here, so a
	// refused-but-connected trainer could say nothing at all (#2075).
	//
	// A fault outranks the note. A trainer that is silent AND driven from
	// elsewhere is still silent, and "no watts yet — turn the cranks" is the
	// line a rider can act on; where the targets come from can wait.
	if (args.state === 'connected')
		return {
			shape: 'live',
			note: args.hint ?? args.targetsNote ?? '',
			// Another screen driving is not a fault (errors.md): the ride is
			// fine, and only a real hint earns the danger tone.
			tone: args.hint ? 'danger' : 'muted',
			button: { label: 'Forget', variant: 'forget' },
		};

	// A link we are actively retrying is this screen's, whatever another
	// screen claims — and the way out has to be on the card (#1716). Left to
	// 'Connecting…' with no button, a strap whose battery died sat there
	// retrying every thirty seconds with nothing a rider could press.
	if (args.state === 'reconnecting')
		return {
			shape: 'note',
			note: 'Reconnecting…',
			tone: 'danger',
			button: { label: 'Forget', variant: 'forget' },
		};

	if (args.elsewhere)
		return {
			shape: 'note',
			note: `Paired ${args.elsewhere}`,
			tone: 'muted',
			instead: 'Forget it there to move it',
		};

	if (!args.supported)
		return {
			shape: 'note',
			note: 'Not connected',
			tone: 'muted',
			instead: 'Needs Chrome or Edge',
		};

	if (args.state === 'connecting')
		return { shape: 'note', note: 'Connecting…', tone: 'muted' };

	if (args.state === 'failed')
		return {
			shape: 'note',
			note: "Couldn't connect",
			tone: 'danger',
			button: { label: 'Retry', variant: 'secondary' },
		};

	return {
		shape: 'note',
		note: 'Not connected',
		tone: 'muted',
		button: { label: 'Pair', variant: 'primary' },
	};
}

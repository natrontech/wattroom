import { account } from '#lib/account.svelte.ts';
import { createHistoryStore, summarise } from '#lib/history.svelte.ts';
import type { RideBatzen } from '#lib/ride/batzen.ts';
import type { BufferedSample, RideBuffer } from '#lib/ride/buffer.ts';
import { outbox } from '#lib/ride/outbox.svelte.ts';
import { recordingUpload, toastSaved, uploadRide } from '#lib/ride/save.ts';
import { toasts } from '#lib/toast.svelte.ts';
import type { createRideSession } from '#lib/workout/session.svelte.ts';

type Session = ReturnType<typeof createRideSession>;

/** Where a save's answers land: the summary while it is this ride's, else a toast. */
export type SaveAnswers = {
	/** The summary still shows this ride. */
	current(): boolean;
	/** A page draws the summary now. */
	seen(): boolean;
	/** In flight, or answered; in flight, there is no retry to offer. */
	saving(on: boolean): void;
	/** Persistent status (errors.md), with the same upload again when it may go through. */
	status(text: string | null, retry: (() => void) | null): void;
	/**
	 * Whether this device holds every second of the unsaved ride, checked
	 * (#4600). False: the summary is the only copy, and the page says so
	 * before it lets go.
	 */
	kept?(on: boolean): void;
	saved(id: string | null, xp: number | undefined, batzen?: RideBatzen): void;
};

/**
 * A finished ride alone, kept (#110): on the account, with the device store
 * as the fallback when the server is unreachable, and the crash buffer kept
 * until the account has it (#794). Answers go to the summary while it shows
 * this ride, and to a toast when no page draws it (#1544).
 */
export function saveRideAlone(
	current: Session,
	ride: { buffer: RideBuffer | undefined; borrowed: boolean; ftp: number },
	answers: SaveAnswers,
): void {
	// Read now, not at the first ride: Rides may have cleared or saved what
	// this device kept since.
	const history = createHistoryStore(() => account.me?.id);
	const summary = summarise(current.recording);
	const ended = ride.buffer;
	if (summary.seconds === 0) {
		ended?.end();
		// Not a summary of zeros with an export that 400s (#1544).
		answers.status('Nothing was recorded — no watts reached the app.', null);
		return;
	}
	const id = `${current.startedAt.getTime()}`;
	// Every workout it rode, under all their names (#4257).
	const ridden = current.ridden;
	const upload = recordingUpload(ridden, current.startedAt, current.recording, {
		borrowed: ride.borrowed,
	});
	const attempt = () => {
		if (answers.current()) answers.saving(true);
		void uploadRide(upload).then(async (outcome) => {
			// Another ride has the summary now: this answer is a toast.
			const mine = answers.current();
			const seen = mine && answers.seen();
			if (mine) answers.saving(false);
			if ('saved' in outcome) {
				// The ride is on the account: NOW it stops being a ride to recover.
				ended?.end();
				// A retry that went through leaves one copy, on the account.
				history.remove(id);
				if (mine) {
					answers.kept?.(true);
					answers.status(outcome.saved.roadLeftOff ?? null, null);
					answers.saved(
						outcome.saved.id || null,
						outcome.saved.xp,
						outcome.saved.batzen,
					);
				}
				if (!seen) toastSaved(outcome.saved);
				return;
			}
			const { failure } = outcome;
			// A refusal the server will repeat (under a minute) is not a ride to
			// recover: offering it back would refuse it again on every reload.
			let kept = true;
			if (failure.final) ended?.end();
			else {
				// Every second onto the device before anything says it is kept
				// (#4600): the appends may have stopped reaching a store mid-ride.
				kept = !!ended && (await ended.keep(buffered(current)));
				// Not saved and no longer recorded: a ride to offer back (#2617),
				// and to send again on its own once the server answers (#4600).
				ended?.release();
				if (kept) outbox.kick();
			}
			if (mine) answers.kept?.(kept);
			// The local summary is the second copy, not the only one: one of it,
			// however many tries failed.
			history.remove(id);
			const localFailure = history.add({
				id,
				workoutName: ridden.name,
				startedAt: current.startedAt.toISOString(),
				execution: current.execution,
				executionScored: current.scored,
				ftp: ride.ftp,
				...summary,
			});
			const status =
				localFailure ??
				(failure.final
					? `${failure.message} Its summary stays on this device.`
					: kept
						? `${failure.message} The ride is kept on this device and saves on its own once the server answers.`
						: `${failure.message} This browser could not keep a copy of it, so keep this page open and press Try again.`);
			if (mine) answers.status(status, failure.final ? null : attempt);
			// No page shows the summary: the one surface left is a toast (errors.md).
			if (!seen) toasts.push(status, { tone: 'error' });
		});
	};
	attempt();
}

/** The ride's seconds as the crash buffer holds them, every one (#4600). */
function buffered(current: Session): BufferedSample[] {
	const start = current.startedAt.getTime();
	return current.recording.map(({ virtualMps: _, ...sample }) => ({
		...sample,
		seq: sample.second + 1,
		at: start + sample.second * 1000,
	}));
}

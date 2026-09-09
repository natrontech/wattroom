import { api } from '$lib/api';
import type { Medal } from '$lib/components/MedalCard.svelte';
import { MEDAL_META } from '$lib/medals';
import type { createRecording } from '$lib/room/recording.svelte';

/** A session is worth a summary once it has a minute of your riding in it. */
export const SUMMARY_MIN_SAMPLES = 60;

/**
 * Session close (#39's summary design): my own samples this session become
 * the summary, and my medal — if the room awarded one — comes back with the
 * refreshed room payload a moment after the pipeline commits. Lifted out of
 * RoomShell; behaviour unchanged.
 */
export function createSummary(deps: {
	slug: () => string;
	recording: ReturnType<typeof createRecording>;
	phase: () => string | undefined;
	myName: () => string | undefined;
	myExecution: () => number;
}) {
	let dismissed = $state(false);
	let medal = $state<Medal | undefined>(undefined);
	let fetched = false;
	// The ride the room saved for me (#1331): the saver writes it a moment
	// after the close and nothing on the tick names it, so it is found as the
	// newest room ride on the account — asked once the pipeline has had its
	// tick or two, and once more if it has not landed yet.
	let rideId = $state<string | null>(null);
	let sessionStart = 0;
	function findMyRide(attempt: number) {
		void api<{ rides?: { id: string; startedAt: string; room?: boolean }[] }>(
			'/api/rides',
		).then((res) => {
			if (!res.ok) return;
			const mine = (res.data.rides ?? []).find(
				(r) => r.room && Date.parse(r.startedAt) >= sessionStart - 60_000,
			);
			if (mine) rideId = mine.id;
			else if (attempt < 2) setTimeout(() => findMyRide(attempt + 1), 3000);
		});
	}

	$effect(() => {
		const phase = deps.phase();
		if (phase === 'running') {
			dismissed = false;
			fetched = false;
			medal = undefined;
			rideId = null;
			sessionStart = Date.now();
		}
		if (
			phase !== 'done' ||
			fetched ||
			deps.recording.samples.length < SUMMARY_MIN_SAMPLES
		)
			return;
		fetched = true;
		// The pipeline commits within a tick or two of the close.
		setTimeout(() => {
			findMyRide(0);
			void api<{
				medals?: { kind: string; rider: string; awardedAt: string }[];
			}>(`/api/rooms/${deps.slug()}`).then((res) => {
				if (!res.ok) return;
				const today = new Date().toISOString().slice(0, 10);
				const mine = (res.data.medals ?? []).find(
					(entry) => entry.rider === deps.myName() && entry.awardedAt === today,
				);
				if (!mine) return;
				const meta = MEDAL_META[mine.kind];
				const kjTotal = Math.round(
					deps.recording.samples.reduce((sum, s) => sum + s.watts, 0) / 1000,
				);
				medal = {
					name: meta?.name ?? mine.kind,
					criterion: meta?.criterion ?? '',
					rider: deps.myName() ?? 'You',
					value: String(Math.round(deps.myExecution() * 100)),
					unit: '%',
					kj: kjTotal,
					xp: 0,
				};
			});
		}, 2500);
	});

	return {
		get medal() {
			return medal;
		},
		get dismissed() {
			return dismissed;
		},
		/** The ride's own page, once the room has saved it. */
		get rideId() {
			return rideId;
		},
		dismiss() {
			dismissed = true;
		},
		/** Enough riding to be worth showing. */
		get ready() {
			return deps.recording.samples.length >= SUMMARY_MIN_SAMPLES;
		},
	};
}

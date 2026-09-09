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
	myId: () => string | undefined;
	myExecution: () => number;
}) {
	let dismissed = $state(false);
	let medalBase = $state<Omit<Medal, 'xp'> | undefined>(undefined);
	// The pipeline's XP for the ride the room saved (#1411): the card said
	// "0 XP" to everyone. Shown once the ride is found, never as a placeholder.
	let rideXp = $state<number | null>(null);
	const medal = $derived<Medal | undefined>(
		medalBase
			? rideXp === null
				? medalBase
				: { ...medalBase, xp: rideXp }
			: undefined,
	);
	let fetched = false;
	// The ride the room saved for me (#1331): the saver writes it a moment
	// after the close and nothing on the tick names it, so it is found as the
	// newest room ride on the account — asked once the pipeline has had its
	// tick or two, and once more if it has not landed yet.
	let rideId = $state<string | null>(null);
	let sessionStart = 0;
	function findMyRide(attempt: number) {
		void api<{
			rides?: { id: string; startedAt: string; room?: boolean; xp?: number }[];
		}>('/api/rides').then((res) => {
			if (!res.ok) return;
			const mine = (res.data.rides ?? []).find(
				(r) => r.room && Date.parse(r.startedAt) >= sessionStart - 60_000,
			);
			if (mine) {
				rideId = mine.id;
				rideXp = mine.xp ?? null;
			} else if (attempt < 2) setTimeout(() => findMyRide(attempt + 1), 3000);
		});
	}

	$effect(() => {
		const phase = deps.phase();
		if (phase === 'running') {
			dismissed = false;
			fetched = false;
			medalBase = undefined;
			rideXp = null;
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
				medals?: { kind: string; riderId?: string; awardedAtMs?: number }[];
			}>(`/api/rooms/${deps.slug()}`).then((res) => {
				if (!res.ok) return;
				// Mine by id, and from this session by the server's clock — a
				// display name is not unique and a UTC date missed anything
				// awarded after local midnight (#1411).
				const mine = (res.data.medals ?? []).find(
					(entry) =>
						entry.riderId === deps.myId() &&
						(entry.awardedAtMs ?? 0) >= sessionStart - 60_000,
				);
				if (!mine) return;
				const meta = MEDAL_META[mine.kind];
				const kjTotal = Math.round(
					deps.recording.samples.reduce((sum, s) => sum + s.watts, 0) / 1000,
				);
				medalBase = {
					name: meta?.name ?? mine.kind,
					criterion: meta?.criterion ?? '',
					rider: deps.myName() ?? 'You',
					value: String(Math.round(deps.myExecution() * 100)),
					unit: '%',
					kj: kjTotal,
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

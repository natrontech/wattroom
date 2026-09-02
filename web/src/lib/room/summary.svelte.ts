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

	$effect(() => {
		const phase = deps.phase();
		if (phase === 'running') {
			dismissed = false;
			fetched = false;
			medal = undefined;
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
		dismiss() {
			dismissed = true;
		},
		/** Enough riding to be worth showing. */
		get ready() {
			return deps.recording.samples.length >= SUMMARY_MIN_SAMPLES;
		},
	};
}

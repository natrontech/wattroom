<script lang="ts">
	// A ride that never ended is a crash to offer back, not to silently keep
	// (#1057, split out of the ride screen). Self-contained: it reads its own
	// rides out of the buffer and hands failures up, because a ride-critical
	// error is the page's persistent status and never this card's own toast
	// (.claude/rules/errors.md — the rider is on a bike).
	import { apiBlob } from '$lib/api';
	import { downloadBlob } from '$lib/download';
	import { discardRide, unfinishedRides } from '$lib/ride/buffer';
	import {
		confirmDiscard,
		exportFilename,
		exportPayload,
		recordedMinutes,
		uploadPayload,
		type RecoveredRide,
	} from '$lib/ride/recovered';
	import { uploadRide } from '$lib/ride/save';
	import { toasts } from '$lib/toast.svelte';

	let {
		onError,
		onSaved,
	}: {
		onError: (message: string | null) => void;
		/** The ride is on the account now — the page drops its device copy. */
		onSaved?: (ride: RecoveredRide) => void;
	} = $props();

	let rides = $state<RecoveredRide[]>([]);
	let busy = $state(false);
	void unfinishedRides().then((found) => (rides = found));

	// `forget` is also how a saved or exported ride leaves the card, so the ask
	// belongs on the Discard button and not in here (errors.md, #1493): by the
	// time download() and save() call it, the samples exist somewhere else.
	const forget = async (rideId: string) => {
		await discardRide(rideId);
		rides = rides.filter((r) => r.rideId !== rideId);
	};

	async function discard(ride: RecoveredRide) {
		if (!(await confirmDiscard(ride))) return;
		await forget(ride.rideId);
	}

	async function download(ride: RecoveredRide) {
		busy = true;
		onError(null);
		try {
			const res = await apiBlob('/api/rides/export', {
				method: 'POST',
				json: exportPayload(ride),
			});
			if (!res.ok) throw new Error(res.error.message);
			downloadBlob(res.data.blob, exportFilename(ride));
			await forget(ride.rideId);
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			busy = false;
		}
	}

	async function save(ride: RecoveredRide) {
		const payload = uploadPayload(ride);
		if (!payload) return;
		busy = true;
		onError(null);
		const outcome = await uploadRide(payload);
		busy = false;
		if ('failure' in outcome) {
			onError(outcome.failure.message);
			// A refusal the server will repeat is not worth a second card:
			// the samples go, the sentence stays.
			if (outcome.failure.final) await forget(ride.rideId);
			return;
		}
		await forget(ride.rideId);
		onSaved?.(ride);
		toasts.push('Ride saved to your history.', {
			href: `/history/${outcome.saved.id}`,
		});
	}
</script>

{#each rides as ride (ride.rideId)}
	<div
		class="border-z4/40 bg-z4/10 mt-6 rounded-lg border px-4 py-3 text-left text-sm"
	>
		<p>
			Recovered an unfinished ride — {ride.workoutName},
			{new Date(ride.startedAt).toLocaleString()},
			{recordedMinutes(ride)} min recorded.
		</p>
		<div class="mt-2 flex gap-2">
			{#if ride.workoutJson}
				<button
					onclick={() => save(ride)}
					disabled={busy}
					class="btn btn-primary btn-xs">Save to your account</button
				>
			{/if}
			<button
				onclick={() => download(ride)}
				disabled={busy}
				class="btn {ride.workoutJson ? 'btn-secondary' : 'btn-primary'} btn-xs"
				>Download .fit</button
			>
			<button onclick={() => discard(ride)} class="btn btn-secondary btn-xs"
				>Discard</button
			>
		</div>
	</div>
{/each}

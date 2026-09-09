<script lang="ts">
	/**
	 * The ⚑ in a room (#1631, ADR-0046's parity rule): every rider can report
	 * what just happened, not only a rider riding alone.
	 *
	 * The solo screen has carried this since #52 and the room never had it,
	 * which is why every rider report in the repo so far describes a solo ride
	 * — the surface with a hub clock, a roster and a shared timeline could not
	 * be reported on at all.
	 *
	 * One difference from solo, and it is deliberate: solo collects flags and
	 * sends them from the summary, where a rider off the bike can type a note.
	 * A room ride is left by walking away, so the tap sends. That is what the
	 * button says before it is pressed, and what the line under it says after.
	 */
	import Flag from '@lucide/svelte/icons/flag';
	import { createFlightRecorder } from '$lib/ride/flightrecorder.svelte';
	import { useRoom } from '$lib/room/context';

	const room = useRoom();
	const recorder = createFlightRecorder();

	// The ring, fed by the room's own tick — the same four fields solo records,
	// and heart rate deliberately not among them (ADR-0008: a report becomes a
	// public issue).
	//
	// One tick per ridden second, not per change: watts, cadence and target
	// land in separate updates, and recording each of them tripled the ring
	// with samples that had not moved. Plain let, not $state — an effect that
	// reads its own state invalidates itself.
	let recordedSecond = -1;
	$effect(() => {
		const second = room.shared?.elapsed ?? 0;
		if (second === recordedSecond) return;
		recordedSecond = second;
		recorder.tick({
			watts: room.you.watts,
			cadence: room.you.cadence,
			target: room.you.target,
			state: room.shared?.phase ?? room.phase,
		});
	});

	let sending = $state(false);
	let sent = $state(false);
	let error = $state<string | null>(null);

	async function flag() {
		if (sending) return;
		sending = true;
		error = null;
		recorder.event('room', `${room.slug} · ${room.shared?.workoutName ?? ''}`);
		recorder.flag();
		const report = recorder.flags[recorder.flags.length - 1];
		const result = await recorder.submit(report, {
			route: `/r/${room.slug}/training`,
			trainer: room.trainerName || 'none',
		});
		sending = false;
		if (result.ok) {
			sent = true;
			setTimeout(() => (sent = false), 6000);
		} else {
			// Mid-ride failures are persistent status, never a toast (errors.md):
			// the rider is on a bike and the tap has to be answerable.
			error = result.error.message;
		}
	}
</script>

<button
	onclick={() => void flag()}
	disabled={sending}
	title="Something wrong? One tap sends your last two minutes of ride data and logs to the developers. Only yours, nobody else's."
	class="border-neon/40 text-neon hover:bg-neon/10 grid h-11 w-14 shrink-0 place-items-center rounded border disabled:opacity-40"
	aria-label="Flag a problem"><Flag size={18} /></button
>

{#if sent || error}
	<p class="text-muted w-full text-xs {error ? 'text-danger' : ''}">
		{#if error}
			{error} Nothing was sent — tap again when you can.
		{:else}
			Flagged — your last two minutes went to the developers. Only yours, nobody
			else's.
		{/if}
	</p>
{/if}

<script lang="ts">
	/**
	 * The ⚑ in a session (#1631, ADR-0046's parity rule): every rider can report
	 * what just happened, not only a rider riding alone.
	 *
	 * The solo screen has carried this since #52 and the group ride never had
	 * it, which is why every rider report in the repo so far describes a solo ride
	 * — the surface with a hub clock, a roster and a shared timeline could not
	 * be reported on at all.
	 *
	 * One difference from solo, and it is deliberate: solo collects flags and
	 * sends them from the summary, where a rider off the bike can type a note.
	 * A session is left by walking away, so the tap sends. That is what the
	 * button says before it is pressed, and what the line under it says after.
	 */
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import { FLAG_SAID } from '$lib/ride/flag';
	import { useChannel } from '$lib/channel/context';

	const channel = useChannel();
	// The ride's ring, not this component's (#2657): it ticks from pairing on,
	// so a report tapped 20 s into a session still holds the minutes before it.
	const recorder = channel.recorder;

	let sending = $state(false);
	let sent = $state(false);
	let error = $state<string | null>(null);

	async function flag() {
		if (sending) return;
		sending = true;
		error = null;
		// The workout, not the place: the buffer is published as it is, and the
		// route below is the one field the server strips of who was where.
		recorder.event('session', channel.shared?.workoutName ?? '');
		recorder.flag();
		const report = recorder.flags[recorder.flags.length - 1];
		const result = await recorder.submit(report, {
			route: channel.address.training,
			trainer: channel.trainerName || 'none',
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

<FlagButton onflag={() => void flag()} sends="now" disabled={sending} />

{#if sent || error}
	<p class="text-muted w-full text-xs {error ? 'text-danger' : ''}">
		{#if error}
			{error} Nothing was sent — tap again when you can.
		{:else}
			{FLAG_SAID.now}
		{/if}
	</p>
{/if}

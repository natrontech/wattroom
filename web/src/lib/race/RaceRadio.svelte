<script lang="ts">
	/**
	 * The team-car radio's line in slot 1 (#3174): the last call, until the
	 * next. Read out politely, never over the rider; a call is a closed
	 * phrase at most once per 20 s (radio.ts).
	 */
	import { createRadio, type RadioCall } from './radio';
	import type { RaceReadout } from './race-view';

	let { race }: { race: RaceReadout } = $props();

	const radio = createRadio();
	let call = $state<RadioCall | null>(null);
	// Guarded by the tick it last heard: an effect that writes state runs
	// again on its own write (Svelte 5.57), and would hear one tick twice.
	let heard = NaN;
	$effect(() => {
		if (race.at === heard) return;
		heard = race.at;
		const next = radio.hear(race, race.at / 1000);
		if (next) call = next;
	});
</script>

{#if call}
	<p
		data-testid="race-radio"
		role="status"
		class="flex flex-wrap items-baseline gap-x-3 pt-2 text-2xl"
	>
		<!-- A word on a riding surface: SPEC's 24 px, never the 10 px eyebrow. -->
		<span class="text-muted tracking-[0.2em] uppercase">Team-car radio</span>
		<span class="text-ink">{call.text}</span>
	</p>
{/if}

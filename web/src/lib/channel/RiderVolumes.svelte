<script lang="ts">
	// A rider's volume lives in their right-click menu (#874), anywhere they
	// appear. Here so it is never ONLY in a menu (ux.md), and so the riders
	// you have moved are in one list to undo: the first few, the rest folded,
	// and one Reset all (#4170).
	import { people } from '$lib/people.svelte';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	import FaderRow from '$lib/channel/FaderRow.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { RIDER_FADER } from '$lib/sound/fader';

	let {
		onRiderGain,
	}: {
		/** Through av, so a rider still in voice hears the change. */
		onRiderGain?: (id: string, gain: number) => void;
	} = $props();

	const setRider = (id: string, gain: number) =>
		onRiderGain ? onRiderGain(id, gain) : mixer.setRiderGain(id, gain);

	// Taken once, on purpose: unity forgets a rider (mixer.svelte.ts), so a
	// live list would delete the row under the thumb the moment a drag passed
	// 100 %. The levels below still read live.
	const listed = mixer.mixedRiders;
	const FIRST = 3;
	let everyone = $state(false);
	const shown = $derived(everyone ? listed : listed.slice(0, FIRST));
	const allAtUnity = $derived(
		listed.every((rider) => mixer.riderGain(rider.id) === 1),
	);
</script>

<!-- The button hangs into the margin, so this label sits level with its
     neighbours' and the rows start where theirs do. -->
<div class="flex items-center gap-3">
	<h3 class="eyebrow">riders, yours only</h3>
	{#if listed.length > 0}
		<button
			onclick={() => listed.forEach((rider) => setRider(rider.id, 1))}
			disabled={allAtUnity}
			class="btn btn-ghost btn-xs -my-2 -mr-3 ml-auto">Reset all</button
		>
	{/if}
</div>
{#if listed.length > 0}
	<ul class="mt-2">
		{#each shown as rider (rider.id)}
			{@const gain = mixer.riderGain(rider.id)}
			<li>
				<FaderRow
					name={rider.name}
					shown="{Math.round(gain * 100)}%"
					travel={RIDER_FADER}
					value={Math.round(gain * 100)}
					onvalue={(v) => setRider(rider.id, v / 100)}
					aria="{rider.name}'s volume"
				>
					{#snippet mark()}
						<StatusMark line={people.face(rider.id)?.statusLine} size={11} />
					{/snippet}
				</FaderRow>
			</li>
		{/each}
	</ul>
	{#if listed.length > FIRST}
		<button
			onclick={() => (everyone = !everyone)}
			aria-expanded={everyone}
			class="btn btn-ghost btn-xs -ml-3"
			>{everyone ? 'Fewer' : `${listed.length - FIRST} more`}</button
		>
	{/if}
{:else}
	<p class="text-muted-dim mt-1 text-xs">
		Everyone at 100%. Right-click a rider to set theirs.
	</p>
{/if}

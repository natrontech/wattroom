<script lang="ts">
	// Every level in one place (#179): the music ceiling, the cues, and how far
	// both dip under a voice. Ducking happens on top of the music level — it
	// never fights these faders.
	//
	// Rendered by both homes of the mix (#477): the room's quick panel and
	// /profile's Voice & audio page. One set of faders, two surfaces.
	import { mixer } from '$lib/sound/mixer.svelte';
	import { play } from '$lib/sound/cues';
	import { MUSIC_FADER, RIDER_FADER, UNIT_FADER } from '$lib/sound/fader';

	let {
		onRiderGain,
	}: {
		/** Resets go through av, so a rider still in voice hears the change. */
		onRiderGain?: (id: string, gain: number) => void;
	} = $props();

	// Through av when there is one, so a rider still in voice is heard at the
	// new level the moment it moves.
	const setRider = (id: string, gain: number) =>
		onRiderGain ? onRiderGain(id, gain) : mixer.setRiderGain(id, gain);

	// Taken once, on purpose: unity forgets a rider (mixer.svelte.ts), so a
	// live list would delete the row under the thumb the moment a drag passed
	// 100 %. The levels below still read live.
	const listed = mixer.mixedRiders;
</script>

{#if mixer.muted}
	<!-- The faders keep their values while away (#875), so say why nothing is
	     coming out rather than showing every slider dragged to zero. -->
	<p class="text-muted mb-2 text-xs">Muted while you are away.</p>
{/if}
<label class="block text-xs">
	<span class="text-muted"
		>music · <span class="font-display tabular-nums">{mixer.music}%</span></span
	>
	<input
		type="range"
		{...MUSIC_FADER}
		value={mixer.music}
		oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
		class="mt-0.5 w-full"
	/>
</label>
<label class="mt-2 block text-xs">
	<span class="text-muted"
		>cues · <span class="font-display tabular-nums"
			>{Math.round(mixer.cues * 100)}%</span
		></span
	>
	<input
		type="range"
		{...UNIT_FADER}
		value={mixer.cues}
		oninput={(e) => mixer.setCues(Number(e.currentTarget.value))}
		onchange={() => play('block')}
		class="mt-0.5 w-full"
	/>
</label>
<label class="mt-2 block text-xs">
	<span class="text-muted"
		>duck under voice · {mixer.duck === 1
			? 'off'
			: `−${Math.round((1 - mixer.duck) * 100)}%`}</span
	>
	<input
		type="range"
		{...UNIT_FADER}
		value={mixer.duck}
		oninput={(e) => mixer.setDuck(Number(e.currentTarget.value))}
		onchange={() => play('block')}
		class="mt-0.5 w-full"
		aria-label="how far music and cues dip under a voice"
	/>
</label>
<!-- The fader above says how far; this says whose voice counts. Off, and the
     room only dips for other people — which is what it has always done. -->
<label class="mt-2 flex items-start gap-2">
	<input
		type="checkbox"
		checked={mixer.duckSelf}
		onchange={(e) => mixer.setDuckSelf(e.currentTarget.checked)}
		class="mt-0.5"
	/>
	<span class="text-xs">
		My voice ducks it too
		<span class="text-muted block text-[11px]">
			Off, music and cues dip only when someone else speaks.
		</span>
	</span>
</label>
<!-- A rider's volume lives in their right-click menu now (#874), anywhere
     they appear. Here so it is never ONLY in a menu (ux.md), and so the
     riders you have moved are in one list to undo. -->
<div class="mt-3">
	<span class="text-muted text-xs">riders</span>
	{#if listed.length > 0}
		<ul class="mt-1 space-y-2">
			{#each listed as rider (rider.id)}
				{@const pct = Math.round(mixer.riderGain(rider.id) * 100)}
				<li class="text-xs">
					<span class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate">{rider.name}</span>
						<span class="font-display shrink-0 tabular-nums">{pct}%</span>
						<button
							onclick={() => setRider(rider.id, 1)}
							disabled={pct === 100}
							class="btn btn-ghost btn-xs shrink-0"
							aria-label="reset {rider.name}'s volume">Reset</button
						>
					</span>
					<input
						type="range"
						{...RIDER_FADER}
						value={pct}
						oninput={(e) =>
							setRider(rider.id, Number(e.currentTarget.value) / 100)}
						aria-label="{rider.name}'s volume"
						class="mt-0.5 w-full"
					/>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted/70 mt-0.5 text-[11px] leading-snug">
			Everyone at 100 %. Each rider in voice has a volume of their own —
			right-click them, in the people column or on their tile.
		</p>
	{/if}
</div>

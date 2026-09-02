<script lang="ts">
	// Every level in one place (#179): the music ceiling, the cues, and how far
	// both dip under a voice. Ducking happens on top of the music level — it
	// never fights these faders.
	//
	// Rendered by both homes of the mix (#477): the room's quick panel and
	// /profile's Voice & audio page. One set of faders, two surfaces.
	import { mixer } from '$lib/sound/mixer.svelte';
	import { play } from '$lib/sound/cues';
	import { MUSIC_FADER, UNIT_FADER } from '$lib/sound/fader';

	let {
		onRiderGain,
	}: {
		/** Resets go through av, so a rider still in voice hears the change. */
		onRiderGain?: (id: string, gain: number) => void;
	} = $props();

	// Back to unity — through av when there is one, so a rider still in
	// voice is heard at 100 % the moment you press it.
	const resetRider = (id: string) =>
		onRiderGain ? onRiderGain(id, 1) : mixer.setRiderGain(id, 1);
</script>

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
<!-- Riders are mixed from their own row (#463) — the speaker in the people
     column or on Members. This lists what you have set, to undo. -->
<div class="mt-3">
	<span class="text-muted text-xs">riders</span>
	{#if mixer.mixedRiders.length > 0}
		<ul class="mt-1 space-y-1">
			{#each mixer.mixedRiders as rider (rider.id)}
				<li class="flex items-center gap-2 text-xs">
					<span class="min-w-0 flex-1 truncate">{rider.name}</span>
					<span class="font-display shrink-0 tabular-nums"
						>{Math.round(rider.gain * 100)}%</span
					>
					<button
						onclick={() => resetRider(rider.id)}
						class="btn btn-ghost btn-xs shrink-0"
						aria-label="reset {rider.name}'s volume">Reset</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted/70 mt-0.5 text-[11px] leading-snug">
			Everyone at 100 %. Each rider in voice has a volume of their own — the
			speaker on their row in the people column.
		</p>
	{/if}
</div>

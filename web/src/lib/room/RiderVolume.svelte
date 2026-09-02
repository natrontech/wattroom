<script lang="ts">
	// A volume for one rider in voice (#463): the quiet teammate up, the loud
	// one down. The fader is the mixer's per-rider gain — per device, kept
	// across rooms — and av ramps their GainNode as it moves. This is only
	// the control, rendered on whichever row the rider has.
	//
	// Two root nodes on purpose: the speaker sits at the row's end, and the
	// slider it opens takes a full line under the row (`basis-full` in the
	// row's wrapping flex), so the name stays readable while you drag.
	import { Volume1, Volume2, VolumeX } from '@lucide/svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	let { id, name }: { id: string; name: string } = $props();

	let open = $state(false);
	const pct = $derived(Math.round(mixer.riderGain(id) * 100));
	const Icon = $derived(pct === 0 ? VolumeX : pct < 100 ? Volume1 : Volume2);
	// A fader off unity shows as set — neon is chrome, so it does not glow.
	const tone = $derived(pct === 100 ? 'text-muted' : 'text-neon');

	function set(percent: number) {
		const gain = percent / 100;
		const av = roomConnection.current?.av;
		if (av) av.setRiderGain(id, gain, name);
		else mixer.setRiderGain(id, gain, name);
	}
</script>

<!-- 44 px tall on a row that is at least that: a bike-side target. -->
<button
	onclick={() => (open = !open)}
	aria-expanded={open}
	aria-label="volume for {name}, {pct}%"
	title="{name}'s volume — {pct}%"
	class="hover:text-ink -my-1 flex h-11 w-9 shrink-0 items-center justify-center rounded {tone}"
	><Icon size={14} /></button
>
{#if open}
	<label class="flex basis-full items-center gap-2 pb-1">
		<input
			type="range"
			min="0"
			max="200"
			step="5"
			value={pct}
			oninput={(e) => set(Number(e.currentTarget.value))}
			aria-label="{name}'s volume"
			class="min-w-0 flex-1"
		/>
		<span class="font-display w-10 shrink-0 text-right text-[11px] tabular-nums"
			>{pct}%</span
		>
	</label>
{/if}

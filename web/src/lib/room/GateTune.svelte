<script lang="ts">
	// Level and gate on one axis (#289): the slider's track IS the meter, so
	// tuning is "drag the mark under my voice". The hint under it says what
	// the gate is doing right now, because a closed gate looks identical to a
	// dead mic.
	//
	// Rendered by both homes of the gate (#477): the room's quick panel and
	// /profile's Voice & audio page.
	import GateMeter from '$lib/room/GateMeter.svelte';

	let {
		micOn = false,
		micLevel = 0,
		transmitting = false,
		voiceMode = 'gate',
		gateThreshold = 0.02,
		effectiveThreshold = 0,
		onGateThreshold,
		micTesting = false,
	}: {
		micOn?: boolean;
		micLevel?: number;
		transmitting?: boolean;
		voiceMode?: 'gate' | 'ptt';
		gateThreshold?: number;
		effectiveThreshold?: number;
		onGateThreshold?: (threshold: number) => void;
		micTesting?: boolean;
	} = $props();

	const gateNow = $derived(effectiveThreshold || gateThreshold);
	const metering = $derived(micOn || micTesting);
</script>

<span class="eyebrow"
	>{voiceMode === 'gate' ? 'your level & gate threshold' : 'your level'}</span
>
<GateMeter
	level={micLevel}
	effective={gateNow}
	setting={gateThreshold}
	{transmitting}
	onThreshold={voiceMode === 'gate' ? onGateThreshold : undefined}
	class="mt-1.5"
/>
<p class="text-muted mt-1 text-xs leading-snug">
	{#if !metering}
		Join voice — or test your mic — to see your level here.
	{:else if voiceMode === 'ptt'}
		{transmitting
			? 'transmitting — the room hears you'
			: 'closed until you hold to talk'}
	{:else if transmitting}
		<span class="text-z4">gate open</span> — the room hears you
	{:else}
		gate closed — speak up, or drag the gate left
	{/if}
</p>
{#if voiceMode === 'gate' && gateNow !== gateThreshold}
	<!-- SPEC doubles the gate under music; the mark shows where it actually
	     sits, or the panel would be lying. -->
	<p class="text-muted/70 mt-0.5 text-xs leading-snug">
		Music is playing — the gate is held at the mark, above where you set it.
	</p>
{/if}

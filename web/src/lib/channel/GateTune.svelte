<script lang="ts">
	// Level and gate on one axis (#289): the slider's track IS the meter, so
	// tuning is "drag the mark under my voice". The hint under it says what
	// the gate is doing right now, because a closed gate looks identical to a
	// dead mic.
	//
	// Rendered by both homes of the gate (#477): the Sound panel and
	// /settings/voice.
	import GateMeter from '$lib/channel/GateMeter.svelte';

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

<span class="eyebrow">{voiceMode === 'gate' ? 'level & gate' : 'level'}</span>
<GateMeter
	level={micLevel}
	effective={gateNow}
	setting={gateThreshold}
	{transmitting}
	onThreshold={voiceMode === 'gate' ? onGateThreshold : undefined}
	class="mt-1.5"
/>
<!-- One status line (#4170). SPEC doubles the gate under music; the mark
     shows where it actually sits, and the line says why it moved. -->
<p class="text-muted mt-1 text-xs leading-snug">
	{#if !metering}
		Join voice or test your mic to see your level.
	{:else if voiceMode === 'ptt'}
		{transmitting ? 'transmitting' : 'hold Space to talk'}
	{:else}
		{#if transmitting}<span class="text-ok">gate open</span>{:else}gate closed{/if}
		·
		{gateNow !== gateThreshold
			? 'held higher under music'
			: transmitting
				? 'the call hears you'
				: 'speak up or drag the mark left'}
	{/if}
</p>

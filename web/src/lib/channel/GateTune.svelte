<script lang="ts">
	// Level and gate on one axis (#289): the slider's track IS the meter, so
	// tuning is "drag the mark under my voice". The hint under it says what
	// the gate is doing right now, because a closed gate looks identical to a
	// dead mic.
	//
	// Rendered by both homes of the gate (#477): the Sound panel and
	// /settings/equipment.
	import GateMeter from '#lib/channel/GateMeter.svelte';

	let {
		micOn = false,
		micLevel = 0,
		transmitting = false,
		voiceMode = 'gate',
		gateThreshold = 0.02,
		effectiveThreshold = 0,
		onGateThreshold,
		micTesting = false,
		gateAuto = true,
		onGateAuto,
		noiseSuppression = true,
		onNoiseSuppression,
		noiseFault = false,
	}: {
		micOn?: boolean;
		micLevel?: number;
		transmitting?: boolean;
		voiceMode?: 'gate' | 'ptt';
		gateThreshold?: number;
		effectiveThreshold?: number;
		onGateThreshold?: (threshold: number) => void;
		micTesting?: boolean;
		/** The gate sets its own mark from the room (SPEC); dragging it sets it by hand. */
		gateAuto?: boolean;
		onGateAuto?: (on: boolean) => void;
		noiseSuppression?: boolean;
		onNoiseSuppression?: (on: boolean) => void;
		noiseFault?: boolean;
	} = $props();

	const gateNow = $derived(effectiveThreshold || gateThreshold);
	const metering = $derived(micOn || micTesting);
</script>

<span class="eyebrow">{voiceMode === 'gate' ? 'level & gate' : 'level'}</span>
<GateMeter
	level={micLevel}
	effective={gateNow}
	setting={gateAuto ? gateNow : gateThreshold}
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
		{gateAuto
			? transmitting
				? 'the call hears you'
				: 'set by your room'
			: gateNow !== gateThreshold
				? 'held higher under music'
				: transmitting
					? 'the call hears you'
					: 'speak up or drag the mark left'}
	{/if}
</p>
{#if onNoiseSuppression}
	<!-- The defaults are right for nearly every rider; these stay folded. -->
	<details class="mt-2 text-xs">
		<summary class="text-muted cursor-pointer">Advanced</summary>
		{#if voiceMode === 'gate' && onGateAuto}
			<label class="mt-2 flex items-start gap-2">
				<input
					type="checkbox"
					checked={gateAuto}
					onchange={(e) => onGateAuto(e.currentTarget.checked)}
				/>
				<span
					>Automatic gate
					<span class="text-muted block"
						>follows the noise in your room; dragging the mark sets it by hand</span
					></span
				>
			</label>
		{/if}
		<label class="mt-2 flex items-start gap-2">
			<input
				type="checkbox"
				checked={noiseSuppression}
				onchange={(e) => onNoiseSuppression(e.currentTarget.checked)}
			/>
			<span
				>Noise cancellation
				<span class="text-muted block"
					>{noiseFault
						? 'not running on this machine, so the gate works alone'
						: 'takes fan, drivetrain and breathing out from under your voice'}</span
				></span
			>
		</label>
	</details>
{/if}

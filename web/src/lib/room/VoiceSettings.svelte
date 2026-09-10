<script lang="ts">
	// The full Voice & audio page: devices, how you transmit, the gate and the
	// mixer. /settings/voice keeps all of it — the room's quick panel (`QuickAudio`)
	// is the shortcut to the parts you reach for while riding (ADR-0020's
	// amendment, #477), never the only way to them, and it renders the same
	// `GateTune` and `MixFaders` this page does.
	import GateTune from '$lib/room/GateTune.svelte';
	import MixFaders from '$lib/room/MixFaders.svelte';
	import DevicePickers from '$lib/room/DevicePickers.svelte';

	let {
		micOn = false,
		micLevel = 0,
		transmitting = false,
		voiceMode = 'gate',
		gateThreshold = 0.02,
		effectiveThreshold = 0,
		onVoiceMode,
		onGateThreshold,
		micTesting = false,
		onMicTest,
		onRiderGain,
		onShareGain,
		devices = { mics: [], cams: [], outs: [] },
		micId = '',
		camId = '',
		outId = '',
		canPickOutput = false,
		onDevice,
	}: {
		micOn?: boolean;
		micLevel?: number;
		transmitting?: boolean;
		voiceMode?: 'gate' | 'ptt';
		gateThreshold?: number;
		effectiveThreshold?: number;
		onVoiceMode?: (mode: 'gate' | 'ptt') => void;
		onGateThreshold?: (threshold: number) => void;
		micTesting?: boolean;
		onMicTest?: () => void;
		/** Resets go through av, so a rider still in voice hears the change. */
		onRiderGain?: (id: string, gain: number) => void;
		onShareGain?: (gain: number) => void;
		devices?: {
			mics: { deviceId: string; label: string }[];
			cams: { deviceId: string; label: string }[];
			outs: { deviceId: string; label: string }[];
		};
		micId?: string;
		camId?: string;
		outId?: string;
		canPickOutput?: boolean;
		onDevice?: (kind: 'mic' | 'cam' | 'out', id: string) => void;
	} = $props();
</script>

<DevicePickers {devices} {micId} {camId} {outId} {canPickOutput} {onDevice} />

<div class="border-ink/5 mt-5 border-t pt-4">
	<span class="eyebrow">how you transmit</span>
	<label class="mt-2 flex items-center gap-2 text-sm">
		<input
			type="radio"
			checked={voiceMode === 'gate'}
			onchange={() => onVoiceMode?.('gate')}
		/>
		Voice activation
	</label>
	<label class="mt-1.5 flex items-start gap-2 text-sm">
		<input
			type="radio"
			checked={voiceMode === 'ptt'}
			onchange={() => onVoiceMode?.('ptt')}
		/>
		<span
			>Push to talk
			<span class="text-muted block text-xs">for spectating from a desk</span
			></span
		>
	</label>
	{#if onMicTest && !micOn}
		<button
			onclick={onMicTest}
			class="btn btn-secondary btn-xs mt-3 {micTesting ? 'border-z4/60' : ''}"
			>{micTesting
				? 'testing — you hear yourself · stop'
				: 'test my mic'}</button
		>
	{/if}

	<div class="mt-3">
		<span id="gate"></span>
		<GateTune
			{micOn}
			{micLevel}
			{transmitting}
			{voiceMode}
			{gateThreshold}
			{effectiveThreshold}
			{onGateThreshold}
			{micTesting}
		/>
	</div>
</div>

<div class="border-ink/5 mt-5 border-t pt-4">
	<span class="eyebrow">mixer</span>
	<div class="mt-2">
		<span id="mixer"></span>
		<MixFaders {onRiderGain} {onShareGain} />
	</div>
</div>

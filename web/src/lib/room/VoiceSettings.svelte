<script lang="ts">
	// Devices, voice mode, the gate and the mixer — lifted out of the rail's
	// popover (ADR-0020). These are set once at a desk, not reached for
	// mid-interval, and they were living in a 208 px strip you also navigate
	// rooms with. The rail keeps mic, camera and a cog that points here.
	import GateMeter from '$lib/room/GateMeter.svelte';
	import Select from '$lib/components/Select.svelte';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { play } from '$lib/sound/cues';

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

	const gateNow = $derived(effectiveThreshold || gateThreshold);
	// Back to unity — through av when there is one, so a rider still in
	// voice is heard at 100 % the moment you press it.
	const resetRider = (id: string) =>
		onRiderGain ? onRiderGain(id, 1) : mixer.setRiderGain(id, 1);
	const metering = $derived(micOn || micTesting);
	const deviceOptions = (
		list: { deviceId: string; label: string }[],
		kind: string,
	) => [
		{ value: '', label: 'System default' },
		...list
			.filter((d) => d.deviceId && d.deviceId !== 'default')
			.map((d, i) => ({
				value: d.deviceId,
				label: d.label || `${kind} ${i + 1}`,
			})),
	];
</script>

<div class="grid gap-4 sm:grid-cols-3">
	<label class="block">
		<span class="eyebrow">microphone</span>
		<div class="mt-1">
			<Select
				label="Microphone"
				value={micId}
				options={deviceOptions(devices.mics, 'Microphone')}
				onchange={(id) => onDevice?.('mic', id)}
			/>
		</div>
	</label>
	<label class="block">
		<span class="eyebrow">camera</span>
		<div class="mt-1">
			<Select
				label="Camera"
				value={camId}
				options={deviceOptions(devices.cams, 'Camera')}
				onchange={(id) => onDevice?.('cam', id)}
			/>
		</div>
	</label>
	{#if canPickOutput}
		<label class="block">
			<span class="eyebrow">speakers · voice only</span>
			<div class="mt-1">
				<Select
					label="Speakers"
					value={outId}
					options={deviceOptions(devices.outs, 'Speakers')}
					onchange={(id) => onDevice?.('out', id)}
				/>
			</div>
		</label>
	{/if}
</div>
{#if devices.mics.length > 0 && !devices.mics.some((d) => d.label)}
	<p class="text-muted/70 mt-2 text-[11px]">
		Names appear after the first voice join grants mic access.
	</p>
{/if}

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

	<!-- Level and gate on one axis (#289): the slider's track IS the meter, so
	     tuning is "drag the mark under my voice". -->
	<div class="mt-3">
		<span class="eyebrow"
			>{voiceMode === 'gate'
				? 'your level & gate threshold'
				: 'your level'}</span
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
			<!-- SPEC doubles the gate under music; the mark shows where it
			     actually sits, or the panel would be lying. -->
			<p class="text-muted/70 mt-0.5 text-xs leading-snug">
				Music is playing — the gate is held at the mark, above where you set it.
			</p>
		{/if}
	</div>
</div>

<!-- The mixer (#179): every level in one place. Ducking dips under the music
     ceiling; it never fights these faders. -->
<div class="border-ink/5 mt-5 border-t pt-4">
	<span class="eyebrow">mixer</span>
	<label class="mt-2 block text-xs">
		<span class="text-muted">music</span>
		<input
			type="range"
			min="0"
			max="100"
			step="5"
			value={mixer.music}
			oninput={(e) => mixer.setMusic(Number(e.currentTarget.value))}
			class="mt-0.5 w-full"
		/>
	</label>
	<label class="mt-2 block text-xs">
		<span class="text-muted">cues</span>
		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
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
			min="0"
			max="1"
			step="0.05"
			value={mixer.duck}
			oninput={(e) => mixer.setDuck(Number(e.currentTarget.value))}
			onchange={() => play('block')}
			class="mt-0.5 w-full"
			aria-label="how far music and cues dip under a voice"
		/>
	</label>
	<!-- Riders are mixed from their own row (#463) — the speaker in the
	     people column or on Members. This lists what you have set, to undo. -->
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
</div>

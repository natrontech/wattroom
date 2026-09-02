<script lang="ts">
	// The mix and the gate, reachable from inside the room (#477). ADR-0020
	// sent these behind the cog as "set once at a desk"; riders reported the
	// opposite — you only find out the mix is wrong when someone is talking
	// over music you cannot hear them through, which is mid-interval, and the
	// cog is a navigation out of the room onto a page that also holds FTP.
	//
	// A shortcut, never the only way (ux.md): /profile keeps the full page,
	// with the camera picker, push-to-talk's explanation and the rest. A modal
	// rather than a popover because the targets have to survive being tapped
	// from a bike, and `Modal` already keeps the jukebox dock clear of it.
	import { Sliders } from '@lucide/svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Select from '$lib/components/Select.svelte';
	import GateTune from '$lib/room/GateTune.svelte';
	import MixFaders from '$lib/room/MixFaders.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	let open = $state(false);
	const av = $derived(roomConnection.current?.av);

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

{#if av}
	<button
		onclick={() => (open = true)}
		aria-expanded={open}
		class="btn btn-secondary btn-xs"
		title="the mix, the gate and your devices"
		><Sliders size={13} /> Sound</button
	>
{/if}

{#if open && av}
	{@const voice = av}
	<Modal label="Sound — the mix and your gate" onclose={() => (open = false)}>
		<h2 class="font-display font-bold">Sound</h2>
		<p class="text-muted mt-1 text-xs">
			The levels you reach for mid-ride. Everything else lives on <a
				href="/profile"
				class="underline">Voice &amp; audio</a
			>.
		</p>

		<div class="border-ink/5 mt-4 border-t pt-4">
			<span class="eyebrow">how you transmit</span>
			<!-- Two big targets, not radios: this is tapped at 160 bpm (ux.md). -->
			<div class="mt-1.5 flex gap-2">
				<button
					onclick={() => voice.setMode('gate')}
					aria-pressed={voice.mode === 'gate'}
					class="btn flex-1 {voice.mode === 'gate'
						? 'btn-primary'
						: 'btn-secondary'}">Voice activation</button
				>
				<button
					onclick={() => voice.setMode('ptt')}
					aria-pressed={voice.mode === 'ptt'}
					class="btn flex-1 {voice.mode === 'ptt'
						? 'btn-primary'
						: 'btn-secondary'}">Push to talk</button
				>
			</div>
			<div class="mt-3">
				<GateTune
					micOn={voice.micOn}
					micLevel={voice.micLevel}
					transmitting={voice.transmitting}
					voiceMode={voice.mode}
					gateThreshold={voice.gateThreshold}
					effectiveThreshold={voice.effectiveGateThreshold}
					onGateThreshold={(t) => voice.setGateThreshold(t)}
					micTesting={voice.micTesting}
				/>
			</div>
			{#if !voice.micOn}
				<button
					onclick={() => void voice.toggleMicTest()}
					class="btn btn-secondary btn-xs mt-3 {voice.micTesting
						? 'border-z4/60'
						: ''}"
					>{voice.micTesting
						? 'testing — you hear yourself · stop'
						: 'test my mic'}</button
				>
			{/if}
		</div>

		<div class="border-ink/5 mt-4 border-t pt-4">
			<span class="eyebrow">mixer</span>
			<div class="mt-2">
				<MixFaders onRiderGain={(id, gain) => voice.setRiderGain(id, gain)} />
			</div>
		</div>

		<div class="border-ink/5 mt-4 border-t pt-4">
			<div class="grid gap-3 {voice.canPickOutput ? 'sm:grid-cols-2' : ''}">
				<label class="block">
					<span class="eyebrow">microphone</span>
					<div class="mt-1">
						<Select
							label="Microphone"
							value={voice.micId}
							options={deviceOptions(voice.mics, 'Microphone')}
							onchange={(id) => void voice.setMic(id)}
						/>
					</div>
				</label>
				{#if voice.canPickOutput}
					<label class="block">
						<span class="eyebrow">speakers · voice only</span>
						<div class="mt-1">
							<Select
								label="Speakers"
								value={voice.outId}
								options={deviceOptions(voice.outs, 'Speakers')}
								onchange={(id) => voice.setOut(id)}
							/>
						</div>
					</label>
				{/if}
			</div>
		</div>

		<div class="mt-5 flex justify-end">
			<button onclick={() => (open = false)} class="btn btn-secondary"
				>Done</button
			>
		</div>
	</Modal>
{/if}

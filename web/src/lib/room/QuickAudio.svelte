<script lang="ts">
	// The mix and the gate, reachable from inside the room (#477). ADR-0020
	// sent these behind the cog as "set once at a desk"; riders reported the
	// opposite — you only find out the mix is wrong when someone is talking
	// over music you cannot hear them through, which is mid-interval, and the
	// cog is a navigation out of the room onto a page that also holds FTP.
	//
	// A shortcut, never the only way (ux.md): /settings/voice keeps the full page,
	// with push-to-talk's explanation and the rest. A modal
	// rather than a popover because the targets have to survive being tapped
	// from a bike, and `Modal` already keeps the jukebox dock clear of it.
	import Sliders from '@lucide/svelte/icons/sliders';
	import Modal from '$lib/components/Modal.svelte';
	import DevicePickers from '$lib/room/DevicePickers.svelte';
	import GateTune from '$lib/room/GateTune.svelte';
	import MixFaders from '$lib/room/MixFaders.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { canHoldToTalk } from '$lib/room/ptt-keys';
	import { openSoundPanel, soundPanel } from '$lib/room/sound-panel.svelte';

	// `compact` is the sidebar's you-panel: an icon in a row of icons, next to
	// the mic and the camera it belongs with.
	let { compact = false }: { compact?: boolean } = $props();

	const av = $derived(roomConnection.current?.av);
	// The mic's menu opens this too (#914), so the flag lives outside.
	const open = $derived(soundPanel.open);
</script>

{#if av}
	<button
		onclick={openSoundPanel}
		aria-expanded={open}
		class={compact
			? 'text-muted-dim hover:text-muted flex flex-1 justify-center rounded py-1.5'
			: 'btn btn-secondary btn-xs'}
		title="the mix, the gate and your devices"
		aria-label="sound — the mix, the gate and your devices"
		>{#if compact}<Sliders size={16} />{:else}<Sliders size={13} /> Sound{/if}</button
	>
{/if}

{#if open && av}
	{@const voice = av}
	<Modal
		label="Sound — the mix and your gate"
		onclose={() => (soundPanel.open = false)}
		class="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
	>
		<h2 class="font-display font-bold">Sound</h2>
		<p class="text-muted mt-1 text-xs">
			The levels you reach for mid-ride. Everything else lives on <a
				href="/settings/voice#gate"
				onclick={() => (soundPanel.open = false)}
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
				<!-- Space is the key, and the button says so (#1879); where there
				     is no key to hold, the mode is not offered. -->
				{#if canHoldToTalk()}
					<button
						onclick={() => voice.setMode('ptt')}
						aria-pressed={voice.mode === 'ptt'}
						class="btn flex-1 flex-col gap-0 leading-tight {voice.mode === 'ptt'
							? 'btn-primary'
							: 'btn-secondary'}"
						>Push to talk
						<span class="block text-[10px] font-normal opacity-70"
							>hold Space</span
						></button
					>
				{/if}
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
				<MixFaders
					onRiderGain={(id, gain) => voice.setRiderGain(id, gain)}
					onShareGain={(gain) => voice.setShareGain(gain)}
				/>
			</div>
		</div>

		<div class="border-ink/5 mt-4 border-t pt-4">
			<!-- The camera sits here too (#945): the you-panel puts its button
			     next to the mic's, so the device it opens belongs next to the
			     mic's device, not one page away. The same pickers as
			     /settings/voice (#1883), unnamed-device hint included. -->
			<DevicePickers
				devices={{ mics: voice.mics, cams: voice.cams, outs: voice.outs }}
				micId={voice.micId}
				camId={voice.camId}
				outId={voice.outId}
				canPickOutput={voice.canPickOutput}
				onDevice={(kind, id) =>
					kind === 'mic'
						? void voice.setMic(id)
						: kind === 'cam'
							? void voice.setCam(id)
							: voice.setOut(id)}
			/>
		</div>

		<div class="mt-5 flex justify-end">
			<button
				onclick={() => (soundPanel.open = false)}
				class="btn btn-secondary">Done</button
			>
		</div>
	</Modal>
{/if}

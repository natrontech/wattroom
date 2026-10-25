<script lang="ts">
	// The mix and the gate, reachable without leaving the call (#477). ADR-0020
	// sent these behind the cog as "set once at a desk"; riders reported the
	// opposite — you only find out the mix is wrong when someone is talking
	// over music you cannot hear them through, which is mid-interval, and the
	// cog is a navigation out of the voice channel onto a page that also
	// holds FTP.
	//
	// A shortcut, never the only way (ux.md): /settings/voice keeps the full page,
	// with push-to-talk's explanation and the rest. A modal
	// rather than a popover because the targets have to survive being tapped
	// from a bike, and `Modal` already keeps the jukebox dock clear of it.
	//
	// It rises from the you-panel that opens it, over the sidebar, and leaves
	// the ride beside it undimmed (#4170). On a desk three columns (what you
	// send, what you hear, whom) over one row of devices keep it short enough
	// to clear the bike computer's head at 900 px. A phone stacks them, the
	// devices second, so they never sit below everything else.
	import { MediaQuery } from 'svelte/reactivity';
	import Sliders from '@lucide/svelte/icons/sliders';
	import Modal from '$lib/components/Modal.svelte';
	import DevicePickers from '$lib/channel/DevicePickers.svelte';
	import GateTune from '$lib/channel/GateTune.svelte';
	import MixFaders from '$lib/channel/MixFaders.svelte';
	import RiderVolumes from '$lib/channel/RiderVolumes.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { canHoldToTalk } from '$lib/channel/ptt-keys';
	import { device } from '$lib/device.svelte';
	import HandheldMicNote from '$lib/channel/HandheldMicNote.svelte';
	import { openSoundPanel, soundPanel } from '$lib/channel/sound-panel.svelte';

	// `compact` is the sidebar's you-panel: an icon in a row of icons, next to
	// the mic and the camera it belongs with.
	let { compact = false }: { compact?: boolean } = $props();

	const av = $derived(channelConnection.current?.av);
	// The mic's menu opens this too (#914), so the flag lives outside.
	const open = $derived(soundPanel.open);
	const close = () => (soundPanel.open = false);
	// Tailwind's `lg`: where the three columns and the row of devices start.
	const desk = new MediaQuery('min-width: 1024px');
</script>

{#if av}
	<button
		onclick={openSoundPanel}
		aria-expanded={open}
		class={compact
			? 'text-muted-dim hover:text-muted flex flex-1 items-center justify-center rounded py-1.5'
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
		onclose={close}
		placement="corner"
		class="riding sm:w-[26rem] lg:w-[62rem]"
	>
		<div class="flex items-center gap-4">
			<h2 class="font-display font-bold">Sound</h2>
			<a
				href="/settings/voice#gate"
				onclick={close}
				class="btn btn-ghost btn-xs ml-auto">Voice &amp; audio</a
			>
			<button onclick={close} class="btn btn-lg btn-secondary">Done</button>
		</div>

		<div class="mt-3 grid gap-y-6 lg:grid-cols-3 lg:gap-x-8">
			<section>
				<h3 class="eyebrow">how you transmit</h3>
				{#if device.coarse}
					<HandheldMicNote />
				{:else}
					<!-- Two big targets, not radios: this is tapped at 160 bpm (ux.md). -->
					<div class="mt-2 flex gap-2">
						<button
							onclick={() => voice.setMode('gate')}
							aria-pressed={voice.mode === 'gate'}
							class="btn flex-1 px-3 whitespace-nowrap {voice.mode === 'gate'
								? 'btn-primary'
								: 'btn-secondary'}">Voice activation</button
						>
						<!-- Space is the key, and the button says so (#1879); where there
						     is no key to hold, the mode is not offered. -->
						{#if canHoldToTalk()}
							<button
								onclick={() => voice.setMode('ptt')}
								aria-pressed={voice.mode === 'ptt'}
								class="btn flex-1 px-3 whitespace-nowrap {voice.mode === 'ptt'
									? 'btn-primary'
									: 'btn-secondary'}"
								>Push to talk <span class="text-xs font-normal">Space</span
								></button
							>
						{/if}
					</div>
					<div class="mt-4">
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
							class="btn btn-secondary btn-xs mt-2 {voice.micTesting
								? 'border-z4/60'
								: ''}"
							>{voice.micTesting
								? 'testing — you hear yourself · stop'
								: 'test my mic'}</button
						>
					{/if}
				{/if}
			</section>
			<!-- The camera sits here too (#945): the you-panel puts its button
			     next to the mic's, so the device it opens belongs next to the
			     mic's device, not one page away. The same pickers as
			     /settings/voice (#1883). On a desk they are one row under the
			     three columns, on the columns' gap so each select starts on a
			     column's edge; the unnamed-device hint stays on the settings page,
			     where a rider names them (G4: no teaching sentence mid-ride). -->
			<section class="lg:order-last lg:col-span-3 [&>div]:gap-x-8 [&>p]:hidden">
				<DevicePickers
					stacked={!desk.current}
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
			</section>
			<section>
				<h3 class="eyebrow">mix, yours only</h3>
				<div class="mt-2">
					<MixFaders onShareGain={(gain) => voice.setShareGain(gain)} />
				</div>
			</section>
			<section>
				<RiderVolumes
					onRiderGain={(id, gain) => voice.setRiderGain(id, gain)}
				/>
			</section>
		</div>
	</Modal>
{/if}

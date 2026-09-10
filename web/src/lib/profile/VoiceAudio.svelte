<script lang="ts">
	// Devices, transmit mode and the mix, for the machine you are sitting at.
	//
	// Its own file because it is the one section that belongs to the AV chain
	// rather than to the profile: it reads `roomConnection` directly and owns
	// the device refresh, and none of that is the page's business (#686).
	import DevicePickers from '$lib/room/DevicePickers.svelte';
	import MixFaders from '$lib/room/MixFaders.svelte';
	import VoiceSettings from '$lib/room/VoiceSettings.svelte';
	import { account } from '$lib/account.svelte';
	import { deviceChoices } from '$lib/room/av-devices.svelte';
	import { canPickOutput } from '$lib/room/av-output';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { describeMediaError } from '$lib/room/media-error';

	// The AV chain only exists while you are in a room. The device picks do
	// not (#1858): they are the one store the next join applies, so a rider
	// with a USB mic beside the built-in one chooses before going live on
	// the wrong one. The gate meter stays behind a live connection.
	const av = $derived(roomConnection.current?.av);
	const choices = deviceChoices();
	// The store only re-reads devices after a connect or a hot-plug; a rider
	// choosing a mic here has usually done neither yet (#658).
	$effect(() => {
		void (av ? av.refreshDevices() : choices.refresh());
	});

	// Before the first grant the browser hands back blank names. One audio
	// grant, released at once, is enough for enumerateDevices to name them.
	let grant = $state<string | null>(null);
	async function nameDevices() {
		grant = null;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
		} catch (cause) {
			grant =
				describeMediaError(cause, 'microphone') ??
				'The browser did not grant the microphone, so the devices stay unnamed.';
		}
		await choices.refresh();
	}
</script>

<section class="panel mt-8 p-6">
	<h2 class="font-display font-bold">Voice &amp; audio</h2>
	{#if !account.me?.avEnabled}
		<!-- Capability gating (ux.md): no LiveKit, no voice, so no controls
			     that would tune something that cannot run. -->
		<p class="text-muted mt-2 text-sm">
			Voice and camera are not configured on this server, so there is nothing to
			tune here yet.
		</p>
	{:else}
		<p class="text-muted mt-1 mb-5 text-sm">
			Which devices this machine uses, how you transmit, and how loud everything
			sits under everything else.
		</p>
		{#if av}
			<VoiceSettings
				micOn={av.micOn}
				micLevel={av.micLevel}
				transmitting={av.transmitting}
				voiceMode={av.mode}
				gateThreshold={av.gateThreshold}
				effectiveThreshold={av.effectiveGateThreshold}
				onVoiceMode={(m) => av.setMode(m)}
				onGateThreshold={(t) => av.setGateThreshold(t)}
				micTesting={av.micTesting}
				onMicTest={() => void av.toggleMicTest()}
				onRiderGain={(id, gain) => av.setRiderGain(id, gain)}
				onShareGain={(gain) => av.setShareGain(gain)}
				devices={{ mics: av.mics, cams: av.cams, outs: av.outs }}
				micId={av.micId}
				camId={av.camId}
				outId={av.outId}
				canPickOutput={av.canPickOutput}
				onDevice={(kind, id) =>
					kind === 'mic'
						? void av.setMic(id)
						: kind === 'cam'
							? void av.setCam(id)
							: av.setOut(id)}
			/>
		{:else}
			<DevicePickers
				devices={{ mics: choices.mics, cams: choices.cams, outs: choices.outs }}
				micId={choices.micId}
				camId={choices.camId}
				outId={choices.outId}
				{canPickOutput}
				onDevice={(kind, id) =>
					kind === 'mic'
						? choices.setMic(id)
						: kind === 'cam'
							? choices.setCam(id)
							: choices.setOut(id)}
				onName={() => void nameDevices()}
			/>
			{#if grant}
				<p class="text-danger mt-2 text-xs">{grant}</p>
			{/if}
			<!-- The mix needs no room either: the cues ring for a DM and a
				     friend request too, and the you-panel's cue fader (#898) must
				     not be the only way to reach one (ux.md). -->
			<div class="mt-5 max-w-sm">
				<MixFaders />
			</div>
			<p class="text-muted mt-4 text-sm">
				Open a room to set your gate — the meter needs a live mic to show you a
				level.
			</p>
		{/if}
	{/if}
</section>

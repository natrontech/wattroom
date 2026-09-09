<script lang="ts">
	// Devices, transmit mode and the mix, for the machine you are sitting at.
	//
	// Its own file because it is the one section that belongs to the AV chain
	// rather than to the profile: it reads `roomConnection` directly and owns
	// the device refresh, and none of that is the page's business (#686).
	import MixFaders from '$lib/room/MixFaders.svelte';
	import VoiceSettings from '$lib/room/VoiceSettings.svelte';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';

	// The AV chain only exists while you are in a room; the pickers say so
	// rather than rendering controls that tune nothing.
	const av = $derived(roomConnection.current?.av);
	// The store only re-reads devices after a connect or a hot-plug; a rider
	// choosing a mic here has usually done neither yet (#658).
	$effect(() => {
		void av?.refreshDevices();
	});
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
			<!-- The mix needs no room: the cues ring for a DM and a friend
				     request too, and the you-panel's cue fader (#898) must not
				     be the only way to reach one (ux.md). Devices and the gate
				     stay behind a live connection — they have nothing to show
				     without one. -->
			<div class="mt-3 max-w-sm">
				<MixFaders />
			</div>
			<p class="text-muted mt-4 text-sm">
				Open a room to pick devices and set your gate — the meter needs a live
				mic to show you a level.
			</p>
		{/if}
	{/if}
</section>

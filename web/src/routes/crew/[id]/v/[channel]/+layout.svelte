<script lang="ts">
	// A voice channel (#2449, ADR-0058): its live shell, at its own address.
	import { page } from '$app/state';
	import VoiceChannelShell from '$lib/room/VoiceChannelShell.svelte';
	import type { VoiceChannelData } from '$lib/room/voice-channel';

	let { children } = $props();
</script>

<VoiceChannelShell
	crewId={page.params.id ?? ''}
	channelId={page.params.channel ?? ''}
	initial={page.data as VoiceChannelData}
>
	{@render children()}
</VoiceChannelShell>

<script lang="ts">
	// What the crew wrote down, on its Home: the newest announcement across
	// its text channels, then its pins. It was the Board page until the crew's
	// nav came down to Home, Schedule and Members.
	import AnnouncementStrip from '$lib/announce/AnnouncementStrip.svelte';
	import MarkedIn from '$lib/announce/MarkedIn.svelte';
	import { takeDownAnnouncement } from '$lib/announce/take-down';
	import { fetchCrewAnnouncement, type CrewAnnouncement } from '$lib/channels';
	import type { Crew } from '$lib/crew';
	import { provideCrewEmoji } from '$lib/emoji/crew-emoji.svelte';
	import CrewPins from '$lib/pins/CrewPins.svelte';
	import { presence } from '$lib/presence.svelte';
	import { untrack } from 'svelte';

	let { crew }: { crew: Crew } = $props();

	// The notice is a chat line and may carry the crew's own emoji (#2643).
	provideCrewEmoji(() => crew.id);
	const administers = $derived(crew.role === 'owner' || crew.role === 'admin');

	let announcement = $state<CrewAnnouncement | null>(null);
	async function reread() {
		const res = await fetchCrewAnnouncement(crew.id);
		// A failed read keeps the notice you are reading; the pins are the page.
		if (res.ok) announcement = res.data ?? null;
	}
	void reread();
	// Marking or clearing one pings the lobby with its channel (#2435).
	let heard = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === heard) return;
		heard = version;
		untrack(() => void reread());
	});
	// The re-read, not a local null: taking the newest down can surface the
	// next one from another channel.
	const clear = () =>
		announcement &&
		takeDownAnnouncement(
			announcement.channelId,
			announcement.messageId,
			reread,
		);
</script>

<section class="mt-8">
	{#if announcement}
		<AnnouncementStrip
			{announcement}
			canClear={administers}
			onclear={() => void clear()}
		/>
		<MarkedIn crewId={crew.id} {announcement} class="-mt-2 mb-5" />
	{/if}
	<CrewPins crewId={crew.id} crewName={crew.name} />
</section>

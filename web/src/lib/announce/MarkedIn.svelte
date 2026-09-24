<script lang="ts">
	// Where the crew's announcement was marked, as a way there: the Board and
	// a voice channel both show the crew's newest, which lives in a chat
	// channel neither of them is (ADR-0058).
	import { textChannelPath, type CrewAnnouncement } from '$lib/channels';
	import MessageCircle from '@lucide/svelte/icons/message-circle';

	let {
		crewId,
		announcement,
		class: klass = '',
	}: {
		crewId: string;
		announcement: CrewAnnouncement;
		class?: string;
	} = $props();
</script>

<p class="text-muted text-xs {klass}">
	Marked in
	<a
		href={textChannelPath(crewId, announcement.channelId)}
		class="btn-link inline-flex items-center gap-1 align-bottom"
		><MessageCircle size={12} />{announcement.channelName}</a
	>
</p>

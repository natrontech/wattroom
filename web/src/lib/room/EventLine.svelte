<script lang="ts">
	// One event (#321): no avatar, no reactions, nothing to copy — the place
	// talking about itself stays quieter than the people in it. The thread
	// draws it between messages; a voice channel draws it beside its deck
	// (ADR-0022 as amended by ADR-0058).
	import type { RoomEvent } from '$lib/protocol';
	import { eventText } from '$lib/channel/events';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Music from '@lucide/svelte/icons/music';
	import ScreenShare from '@lucide/svelte/icons/screen-share';

	let { event, class: klass = '' }: { event: RoomEvent; class?: string } =
		$props();
	const Mark = $derived(
		event.kind === 'session'
			? CalendarClock
			: event.kind === 'screen'
				? ScreenShare
				: Music,
	);
</script>

<p
	class="text-muted-dim flex items-baseline gap-1.5 text-[11px] italic {klass}"
>
	<Mark size={11} class="shrink-0 translate-y-0.5 opacity-70" />
	<span class="min-w-0 wrap-anywhere">{eventText(event)}</span>
</p>

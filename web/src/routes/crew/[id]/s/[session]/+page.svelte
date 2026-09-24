<script lang="ts">
	// The session's surface (#2450): the Training place — instrument, the
	// interval strip, the coach's controls, sprints, games, the countdown —
	// in the voice channel the session runs in.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { sessionPath } from '$lib/channel/address';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { useChannel } from '$lib/channel/context';
	import { liveSessionId } from '$lib/channel/tick-session';
	import Training from '$lib/session/Training.svelte';

	const channel = useChannel();

	// The address is the session's for as long as it runs (#2600). When it
	// ends — or a newer one is running in its channel — the page lets go: to
	// the newer session, or back to the channel, so a reload, a shared link
	// or the next Start does not strand anyone on "This session has ended".
	// Replaced, not pushed: Back should not return to a session that is over.
	$effect(() => {
		const state = channelConnection.current?.live.tick?.state;
		const here = page.params.session;
		if (!state || !here) return;
		const live = liveSessionId(state);
		if (live === here) return;
		const to = live
			? sessionPath(channel.address.crew, live)
			: channel.address.home;
		void goto(to, { replaceState: true, keepFocus: true, noScroll: true });
	});
</script>

<Training />

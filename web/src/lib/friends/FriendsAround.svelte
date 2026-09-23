<script lang="ts">
	// Friends around right now, as chips (#2586): Home's row, and the crew
	// Home's for the ones outside that crew. A chip goes where they are when
	// you may enter it, else to your conversation with them.
	import Avatar from '$lib/components/Avatar.svelte';
	import {
		friendPlace,
		friends,
		type Friend,
	} from '$lib/friends/friends.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { statusOf } from '$lib/status';
	import { placePath } from '$lib/whereabouts';

	let { list }: { list: Friend[] } = $props();
</script>

<ul class="flex flex-wrap gap-2">
	{#each list as friend (friend.id)}
		<li>
			<a
				href={friend.channel
					? placePath(friend.channel)
					: `/messages/dm/${friend.id}`}
				class="panel hover:border-muted/40 flex items-center gap-2 px-2.5 py-1.5 text-xs"
				title={friendPlace(friend)}
			>
				<!-- The badge Avatar draws, from the one vocabulary (#807,
				     $lib/status) — not a mark of this row's own. Home drew
				     RidingBars for anyone `inRoom`, and those bars say "riding
				     now" to the eye and to a screen reader, so a friend chatting
				     in a room was reported as pedalling while the Friends page
				     called the same person "in a room". ADR-0012: presence never
				     implies watts (#2168). -->
				<Avatar
					name={friend.name}
					avatarUrl={friend.avatarUrl}
					xp={friend.totalXp}
					status={statusOf(crewLive.crews, friend.id, friends.list)}
					size={20}
				/>
				<span class="font-medium">{friend.name}</span>
			</a>
		</li>
	{/each}
</ul>

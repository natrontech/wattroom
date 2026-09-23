<script lang="ts">
	// The room's dashboard, when nothing is running: what this room is
	// adding up to and the three things you do to it. It lives on the
	// Lounge rather than a sixth place — Discord's server home IS its first
	// channel. Its own component (size, code-quality.md): the Lounge page is
	// the tiles and the stage; this is the part that only exists between
	// sessions.
	import { shareInviteLink } from '$lib/crew-flows';
	import { useRoom } from '$lib/room/context';
	import SessionControls from '$lib/room/SessionControls.svelte';
	import TogetherTiles from '$lib/components/TogetherTiles.svelte';
	import WeekBoard from '$lib/components/WeekBoard.svelte';
	import { shareVerb } from '$lib/share';
	import Link from '@lucide/svelte/icons/link';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	const room = useRoom();
</script>

<section class="mt-6">
	<TogetherTiles
		together={room.together}
		streakWeeks={room.streakWeeks}
		streakLabel="this crew's streak"
	/>
	{#if room.board.length}
		<WeekBoard rows={room.board} />
	{/if}

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<!-- The room's home holds its action (#1332, ADR-0020 amended): a
		     coach starts the session here, with the controls Training has,
		     drawn once; a rider joins one that is running — on Training,
		     where the numbers are. -->
		<SessionControls />
		<!-- The invite is the crew's (#1236): one click gets its link out of
		     the app — a share sheet on a phone, the clipboard at a desk (#973).
		     Without the code — never for a member, but the row must not
		     render a button that fails — the Members place says how. -->
		{#if room.code}
			<button
				onclick={() => shareInviteLink(room.code)}
				class="btn btn-secondary"
				><Link size={14} /> {shareVerb()} invite link</button
			>
		{:else}
			<a href={room.address.members} class="btn btn-secondary"
				><UserPlus size={14} /> Invite</a
			>
		{/if}
	</div>
</section>

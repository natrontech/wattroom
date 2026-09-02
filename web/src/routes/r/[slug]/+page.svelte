<script lang="ts">
	// The Lounge: the room's default place (ADR-0020). Was a tab inside
	// RoomLive; it is a URL now.
	//
	// One fused grid — camera and metrics on the same tile (#181) — with the
	// stage above it only when someone is actually sharing. Tapping a tile
	// focuses that rider: what "video-first" used to be a whole layout for,
	// as a tap rather than a mode you have to remember you are in.
	import { dev } from '$app/environment';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import SessionControls from '$lib/room/SessionControls.svelte';
	import Stage from '$lib/room/Stage.svelte';
	import { useRoom } from '$lib/room/context';
	import { formatWhen } from '$lib/format';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import {
		Headphones,
		CalendarClock,
		MonitorUp,
		ScreenShare,
		ScreenShareOff,
		UserPlus,
	} from '@lucide/svelte';

	const room = useRoom();
	const av = $derived(roomConnection.current?.av);
	const focused = $derived(room.riders.find((r) => r.id === room.focusId));
	const others = $derived(room.riders.filter((r) => r.id !== room.focusId));
</script>

{#snippet tile(rider: (typeof room.riders)[number])}
	<RiderTile
		{rider}
		phase={room.phase}
		videoKey={room.videoOf(rider.id) ?? 0}
		videoAttach={room.videoOf(rider.id)
			? (node) => room.attachVideo(rider.id, node)
			: undefined}
	/>
{/snippet}

<div class="flex h-full flex-col px-8 py-6">
	<!-- No page header: the sidebar says which room this is and the people
	     column says who is in it. What is left is what the lounge can DO. -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<SessionControls />
		{#if av && account.me?.avEnabled}
			{#if av.status === 'off' || av.status === 'failed'}
				<button onclick={() => void av.join()} class="btn btn-primary"
					><Headphones size={14} /> Join voice</button
				>
			{:else}
				<button
					onclick={() => void av.toggleShare()}
					class="btn btn-secondary inline-flex items-center gap-1.5"
				>
					{#if av.sharing}<ScreenShareOff size={14} /> Stop sharing{:else}<ScreenShare
							size={14}
						/> Share screen{/if}
				</button>
			{/if}
		{/if}
		{#if !room.trainer}
			<button
				onclick={() => room.pair()}
				disabled={typeof navigator === 'undefined' || !navigator.bluetooth}
				class="btn btn-secondary">Pair trainer</button
			>
			{#if dev}
				<!-- Dev-only (#123): simulated watts in a live room would count for
				     medals, XP and streaks — the fairness layer takes no fakes. -->
				<button
					onclick={() => room.pairSimulated()}
					class="btn btn-ghost btn-xs">Ride simulated</button
				>
			{/if}
		{:else}
			<button onclick={() => room.unpair()} class="btn btn-ghost btn-xs"
				>Unpair trainer</button
			>
		{/if}
		<button onclick={() => room.openTv()} class="btn btn-ghost btn-xs ml-auto"
			><MonitorUp size={13} /> TV</button
		>
	</div>

	{#if room.rideError}
		<p class="text-danger mb-3 text-xs">{room.rideError}</p>
	{/if}

	{#if room.onStage}
		<!-- The stage (#280): many people may share at once, so the picker
		     chooses; the frame zooms, pans, resizes and pops out. -->
		<div class="mb-3 shrink-0">
			<Stage
				sources={room.stageSources}
				activeKey={room.onStage.key}
				trackKey={`${room.onStage.key}:${room.onStage.gen}`}
				onPick={(key) => room.pickStage(key)}
				attach={(node) => room.attachStage(node, room.onStage!.key)}
			/>
		</div>
	{/if}

	{#if focused}
		<!-- Focus narrows what you are looking at; it does not empty the room,
		     so everyone else stays beside them. -->
		<div
			class="grid min-h-0 shrink-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]"
		>
			<div>
				<button
					onclick={() => room.setFocus(null)}
					class="block w-full text-left"
					title="tap to unfocus">{@render tile(focused)}</button
				>
				<p class="text-muted mt-2 text-xs">
					<span class="text-ink font-medium">{focused.name}</span> is focused — tap
					again to let go.
				</p>
			</div>
			<div class="grid grid-cols-3 gap-2 lg:grid-cols-1">
				{#each others as rider (rider.id)}
					<button
						onclick={() => room.setFocus(rider.id)}
						class="block text-left"
						title="focus {rider.name}">{@render tile(rider)}</button
					>
				{/each}
			</div>
		</div>
	{:else}
		<div class="grid shrink-0 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
			{#each room.riders as rider (rider.id)}
				<button
					onclick={() => room.setFocus(rider.id)}
					class="block text-left"
					title="focus {rider.name}">{@render tile(rider)}</button
				>
			{/each}
		</div>
	{/if}

	{#if room.phase === 'lounge'}
		<!-- The room's dashboard, when nothing is running: what this room is
		     adding up to and the three things you do to it. It lives on the
		     Lounge rather than a sixth place — Discord's server home IS its
		     first channel. -->
		<section class="mt-6">
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="panel px-4 py-3">
					<p class="eyebrow">riders</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{room.members.length}
					</p>
					<p class="text-muted text-[11px]">
						{room.riders.length} here now
					</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="eyebrow">streak</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{room.streakWeeks}<span class="text-muted ml-1 text-sm"
							>wk{room.streakWeeks === 1 ? '' : 's'}</span
						>
					</p>
					<p class="text-muted text-[11px]">a session every week</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="eyebrow">this month</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{Math.round(room.monthKj).toLocaleString()}<span
							class="text-muted ml-1 text-sm">kJ</span
						>
					</p>
					<p class="text-muted text-[11px]">everyone, together</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="eyebrow">medals</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{room.medals.length}
					</p>
					<p class="text-muted text-[11px]">earned in this room</p>
				</div>
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-2">
				{#if room.upcoming[0]}
					{@const next = room.upcoming[0]}
					<a
						href="/r/{room.slug}/sessions"
						class="panel hover:border-muted/40 flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5"
					>
						<CalendarClock size={15} class="text-muted shrink-0" />
						<span class="min-w-0">
							<span class="eyebrow">next session</span>
							<span class="block truncate text-sm font-medium"
								>{next.workoutName}</span
							>
							<span class="text-muted block text-[11px]"
								>{formatWhen(next.startsAt, true)} · planned by {next.createdBy}</span
							>
						</span>
					</a>
				{:else if room.canControl}
					<button
						onclick={() => room.openPicker('plan')}
						class="btn btn-secondary"
						><CalendarClock size={14} /> Plan a session</button
					>
				{/if}
				<a href="/r/{room.slug}/members" class="btn btn-ghost"
					><UserPlus size={14} /> Invite</a
				>
			</div>
		</section>
	{/if}
</div>

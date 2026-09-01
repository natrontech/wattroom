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
	import Stage from '$lib/room/Stage.svelte';
	import { useRoom } from '$lib/room/context';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import {
		MonitorUp,
		Radio,
		ScreenShare,
		ScreenShareOff,
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

<div class="flex h-full flex-col px-5 py-4">
	<!-- No page header: the sidebar says which room this is and the people
	     column says who is in it. What is left is what the lounge can DO. -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		{#if room.canControl}
			<button onclick={() => room.openPicker()} class="btn btn-accent btn-lg"
				><Radio size={15} /> Start a session</button
			>
		{/if}
		{#if av && account.me?.avEnabled}
			{#if av.status === 'off' || av.status === 'failed'}
				<button onclick={() => void av.join()} class="btn btn-secondary"
					>Join voice</button
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
		<p class="text-z6 mb-3 text-xs">{room.rideError}</p>
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
		<p class="text-muted/70 mt-4 text-[11px]">
			Nothing is running. The room is a place to be — the session starts when
			someone starts it.
		</p>
	{/if}
</div>

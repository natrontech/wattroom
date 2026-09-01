<script lang="ts">
	// ADR-0020 column 1: rooms, DMs, and you — the crew radar plus your own AV
	// state. Names rather than Discord's icon rail: four rooms fit, and #181's
	// fourth gap (nothing signals a room you are not looking at) needs words —
	// "Sweet Spot, 12 min in" is not something a 48 px icon can say.
	import Avatar from '$lib/components/Avatar.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { DM_HEADS, RAIL_ROOMS } from './shape';
	import { Headphones, Mic, Settings, Video, VideoOff } from '@lucide/svelte';

	let {
		activeSlug = '',
		connectedSlug = '',
		live = false,
	}: { activeSlug?: string; connectedSlug?: string; live?: boolean } = $props();
</script>

<nav
	class="bg-surface border-ink/5 flex h-full w-52 shrink-0 flex-col border-r"
>
	<div class="flex items-center gap-2 px-4 py-4">
		<Logo size={22} {live} />
		<span class="font-display text-sm font-bold">WattRoom</span>
	</div>

	<div class="eyebrow px-4 pt-1 pb-1">your rooms</div>
	<ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
		{#each RAIL_ROOMS as room (room.slug)}
			{@const here = room.slug === connectedSlug}
			{@const active = room.slug === activeSlug}
			<li>
				<a
					href="#{room.slug}"
					class="block rounded px-2 py-1.5 {active
						? 'bg-surface-raised text-ink'
						: 'text-muted hover:text-ink'}"
				>
					<span class="flex items-center gap-2">
						{#if here}
							<span
								class="bg-z4 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
								title="you are in this room"
							></span>
						{/if}
						<span
							class="truncate text-sm {room.unread && !active
								? 'text-ink font-semibold'
								: ''}">{room.icon} {room.name}</span
						>
						<!-- The unread/mention signal (#181 gap 4). A mention is the only
						     thing loud enough to earn the live hue on chrome — it is the
						     room addressing you by name. -->
						{#if room.mention}
							<span
								class="bg-watt text-paper ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums"
								>{room.unread}</span
							>
						{:else if room.unread}
							<span
								class="bg-muted/30 text-ink ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums"
								>{room.unread}</span
							>
						{:else if room.connected > 0}
							<span class="ml-auto flex shrink-0 items-center gap-1">
								<span class="bg-z4 h-1.5 w-1.5 rounded-full"></span>
								<span class="text-muted/70 font-mono text-[10px]"
									>{room.connected}</span
								>
							</span>
						{:else}
							<span class="text-muted/50 ml-auto shrink-0 font-mono text-[10px]"
								>{room.members}</span
							>
						{/if}
					</span>
					{#if room.session}
						<!-- The late-join radar: what is on, and how far in. -->
						<span
							class="text-watt/90 mt-0.5 flex items-center gap-1 truncate text-[10px]"
						>
							<span class="bg-watt glow-stroke h-1 w-1 shrink-0 rounded-full"
							></span>
							{room.session.workoutName} · {Math.round(
								room.session.elapsedSec / 60,
							)} min in
						</span>
					{:else if room.next}
						<span class="text-muted/70 mt-0.5 block truncate text-[10px]"
							>next: {room.next.workoutName} · {room.next.when}</span
						>
					{/if}
					{#if room.voice.length > 0 && !active}
						<!-- Who is in voice, without entering (ADR-0010: the sidebar is
						     the radar). The full roster is column 4's job. -->
						<span
							class="text-muted/70 mt-0.5 flex items-center gap-1 truncate text-[10px]"
						>
							<Headphones size={9} class="shrink-0" />
							{room.voice.join(', ')}
						</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>

	<div class="eyebrow px-4 pt-3 pb-1">messages</div>
	<ul class="px-2 pb-1">
		{#each DM_HEADS as head (head.name)}
			<li>
				<button
					class="text-muted hover:text-ink flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
				>
					<Avatar name={head.name} size={20} />
					<span class="truncate">{head.name}</span>
					{#if head.unread}
						<span class="bg-watt ml-auto h-2 w-2 shrink-0 rounded-full"></span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>

	<!-- The you panel, pinned (#181 gap 2). What left it: the per-rider mixer,
	     the gate slider and the theme cycle — three desk settings living in a
	     208 px strip. They are on /profile now; the cog is how you get there. -->
	<div class="border-ink/5 border-t px-3 py-2.5">
		<div class="flex items-center gap-2">
			<Avatar name="You" size={26} />
			<span class="mr-auto min-w-0">
				<span class="block truncate text-xs font-medium">You</span>
				<span class="text-z4 block truncate text-[10px]">in voice</span>
			</span>
			<button class="text-z4 rounded p-1" aria-label="mute microphone"
				><Mic size={14} /></button
			>
			<button
				class="text-muted/50 hover:text-muted rounded p-1"
				aria-label="turn camera on"><VideoOff size={14} /></button
			>
			<button
				class="text-muted hover:text-ink rounded p-1"
				aria-label="settings"><Settings size={14} /></button
			>
		</div>
	</div>
</nav>

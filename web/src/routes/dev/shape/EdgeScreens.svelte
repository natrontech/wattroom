<script lang="ts">
	// The screens ADR-0020's frame deliberately does NOT apply to, plus the two
	// overlays that stay overlays. A modal survives the redesign when it is a
	// decision rather than a destination — you come back to where you were.
	import Avatar from '$lib/components/Avatar.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import TvMode from '$lib/room/TvMode.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { plannedZoneSeconds } from '$lib/components/zones';
	import { formatClock, wkg } from '$lib/format';
	import type { Segment } from '$lib/workout/types';
	import type { Block, RoomRider } from '$lib/room/view';
	import { Menu, MessageSquare, Mic, Users, Video } from '@lucide/svelte';

	let {
		screen,
		riders,
		segments,
		total,
		elapsed,
		block,
	}: {
		screen: string;
		riders: RoomRider[];
		segments: Segment[];
		total: number;
		elapsed: number;
		block: Block | null;
	} = $props();

	const you = $derived(riders.find((r) => r.you)!);
	const ranked = $derived(
		[...riders].sort((a, b) => b.watts / b.ftp - a.watts / a.ftp),
	);
</script>

{#if screen === 'tv'}
	<div class="cave bg-surface h-full">
		<TvMode
			{riders}
			{segments}
			{total}
			{elapsed}
			{block}
			roomName="Thursday Sufferfest"
			workoutName="Sweet Spot 2×20"
			code="SUF42K"
		/>
	</div>
{:else if screen === 'watch'}
	<!-- Not this shell on purpose: read-only, any mobile browser, no Web
	     Bluetooth. iOS Safari is the whole point. -->
	<div class="grid h-full place-items-center">
		<div
			class="cave bg-surface ring-ink/10 h-[720px] w-[360px] overflow-y-auto rounded-[2rem] p-4 ring-8"
		>
			<div class="flex items-center gap-2">
				<Logo size={18} live />
				<span class="font-display truncate text-sm font-bold"
					>Thursday Sufferfest</span
				>
			</div>
			<p class="text-muted mt-1 text-xs">
				Sweet Spot 2×20 · {formatClock(elapsed)}
			</p>
			<ul class="mt-4 space-y-1.5">
				{#each ranked as rider (rider.id)}
					<li class="panel flex items-center gap-2 px-3 py-2">
						<Avatar name={rider.name} size={26} />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm">{rider.name}</span>
							{#if rider.coach}<span class="eyebrow">coach</span>{/if}
						</span>
						<span class="text-right tabular-nums">
							<span
								class="font-display text-watt glow-text block text-lg font-bold"
								>{rider.watts}</span
							>
							<span class="text-muted block text-[10px]"
								>{wkg(rider.watts, rider.kg)} w/kg</span
							>
						</span>
					</li>
				{/each}
			</ul>
			<div class="mt-4 flex gap-1.5">
				{#each ['🔥', '💪', '😤', '🚀'] as emoji (emoji)}
					<button class="border-muted/20 flex-1 rounded border py-2.5 text-lg"
						>{emoji}</button
					>
				{/each}
			</div>
		</div>
	</div>
{:else if screen === 'mobile'}
	<!-- Below 768 px the four columns collapse: columns 1+2 become a drawer,
	     column 3 IS the screen, column 4 stays the sheet it already is. The
	     phone tab bar retires with TopNav — the drawer is the navigation. -->
	<div class="grid h-full place-items-center gap-6 lg:grid-cols-2">
		{#each ['closed', 'drawer'] as state (state)}
			<div
				class="bg-surface ring-ink/10 relative h-[720px] w-[360px] overflow-hidden rounded-[2rem] ring-8"
			>
				<div class="border-ink/5 flex items-center gap-2 border-b px-3 py-3">
					<Menu size={18} class="text-muted" />
					<span class="font-display truncate text-sm font-bold"
						>🔥 Thursday Sufferfest</span
					>
					<Users size={16} class="text-muted ml-auto" />
					<MessageSquare size={16} class="text-muted" />
				</div>
				<div class="space-y-2 p-3">
					{#each riders.slice(0, 3) as rider (rider.id)}
						<RiderTile {rider} phase="lounge" />
					{/each}
				</div>
				{#if state === 'drawer'}
					<!-- Columns 1+2, slid in. Same components, same order — a phone
					     gets the shape, not a different app. -->
					<div class="bg-paper/60 absolute inset-0"></div>
					<div
						class="bg-surface border-ink/5 absolute inset-y-0 left-0 w-[78%] border-r p-3 shadow-2xl"
					>
						<span class="eyebrow">your rooms</span>
						<ul class="mt-1 space-y-0.5">
							{#each ['🔥 Thursday Sufferfest', '🚴 mfw-5', '🌄 Sunday Long Ride'] as name, i (name)}
								<li
									class="flex items-center gap-2 rounded px-2 py-2 text-sm {i ===
									0
										? 'bg-surface-raised'
										: 'text-muted'}"
								>
									<span class="truncate">{name}</span>
									{#if i === 1}<span
											class="bg-watt text-paper ml-auto rounded-full px-1.5 text-[10px] font-bold"
											>12</span
										>{/if}
								</li>
							{/each}
						</ul>
						<span class="eyebrow mt-4 block">in this room</span>
						<ul class="mt-1 space-y-0.5">
							{#each ['Lounge', 'Training', 'Sessions', 'Members', 'Settings'] as place, i (place)}
								<li
									class="rounded px-2 py-2 text-sm {i === 0
										? 'bg-surface-raised'
										: 'text-muted'}"
								>
									{place}
								</li>
							{/each}
						</ul>
						<div
							class="border-ink/5 absolute inset-x-3 bottom-3 flex items-center gap-2 border-t pt-3"
						>
							<Avatar name="You" size={26} />
							<span class="mr-auto text-xs font-medium">You</span>
							<Mic size={15} class="text-z4" />
							<Video size={15} class="text-muted/50" />
						</div>
					</div>
				{/if}
				<span
					class="text-muted/60 absolute bottom-2 left-0 w-full text-center text-[10px]"
					>{state === 'closed'
						? 'column 3 is the screen'
						: 'columns 1 + 2'}</span
				>
			</div>
		{/each}
	</div>
{:else if screen === 'login'}
	<div class="cave bg-surface bg-gridlines grid h-full place-items-center">
		<div class="text-center">
			<Logo size={56} />
			<h2 class="font-display mt-6 text-3xl font-bold tracking-tight">
				WattRoom
			</h2>
			<p class="text-muted mt-2 text-sm">Open a room. Push watts together.</p>
			<div class="mt-8 flex flex-col gap-2">
				{#each ['Continue with Google', 'Continue with GitHub', 'Continue with Strava'] as provider (provider)}
					<button class="btn btn-secondary btn-lg w-64">{provider}</button>
				{/each}
			</div>
		</div>
	</div>
{:else if screen === 'room-picker'}
	<!-- Still a modal after ADR-0020: picking a workout is a decision you make
	     and come back from, not a place you go. -->
	<div class="bg-paper/60 absolute inset-0 z-40 grid place-items-center p-6">
		<div class="panel max-h-full w-full max-w-3xl overflow-y-auto p-5">
			<div class="border-ink/5 mb-4 flex border-b">
				{#each ['Workouts', 'Games'] as tab, i (tab)}
					<button
						class="-mb-px border-b-2 px-5 py-2.5 text-sm font-medium {i === 0
							? 'border-neon text-ink'
							: 'text-muted border-transparent'}">{tab}</button
					>
				{/each}
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each ['Sweet Spot 2×20', 'VO₂ 5×3', 'Endurance 90', 'Over-Unders 4×8'] as name, i (name)}
					<button
						class="panel px-3 py-3 text-left {i === 0 ? 'border-neon/50' : ''}"
					>
						<p class="font-display truncate text-sm font-bold">{name}</p>
						<div class="mt-1.5 h-12">
							<IntervalGraph
								{segments}
								{total}
								elapsed={0}
								ftp={you.ftp}
								trace={[]}
								compact
							/>
						</div>
						<div class="mt-1.5">
							<ZoneBar seconds={plannedZoneSeconds(segments, you.ftp)} />
						</div>
					</button>
				{/each}
			</div>
			<div class="mt-4 flex gap-2">
				<button class="btn btn-accent btn-lg">Start now</button>
				<button class="btn btn-secondary">Plan for later</button>
				<button class="btn btn-ghost ml-auto">Cancel</button>
			</div>
		</div>
	</div>
{:else if screen === 'room-summary'}
	<div class="bg-paper/60 absolute inset-0 z-40 grid place-items-center p-6">
		<div class="panel max-h-full w-full max-w-2xl overflow-y-auto p-5">
			<p class="eyebrow">Thursday Sufferfest · Sweet Spot 2×20</p>
			<h3 class="font-display mt-1 text-2xl font-bold">That's a session.</h3>
			<div class="mt-4 grid grid-cols-4 gap-4">
				{#each [{ k: 'work', v: '940 kJ' }, { k: 'execution', v: '92 %' }, { k: 'avg', v: '218 W' }, { k: 'xp', v: '+340' }] as stat (stat.k)}
					<div>
						<p class="eyebrow">{stat.k}</p>
						<p class="font-display text-2xl font-bold tabular-nums">
							{stat.v}
						</p>
					</div>
				{/each}
			</div>
			<div class="panel mt-4 h-32 p-2">
				<IntervalGraph
					{segments}
					{total}
					elapsed={total}
					ftp={you.ftp}
					trace={you.trace}
				/>
			</div>
			<div class="mt-4 flex gap-2">
				<button class="btn btn-primary">Share medal</button>
				<button class="btn btn-secondary">Back to the lounge</button>
			</div>
		</div>
	</div>
{/if}

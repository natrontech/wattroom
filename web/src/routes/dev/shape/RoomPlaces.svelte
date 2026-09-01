<script lang="ts">
	// Column 3 while you are standing in a room. Every one of these was a tab,
	// a modal or a separate route before ADR-0020; here each is a place with a
	// URL, and the content column starts with the work instead of a header
	// repeating the room name column 2 already carries.
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import TrainingPlace from './TrainingPlace.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatClock, wkg } from '$lib/format';
	import {
		fillPct,
		plannedZoneSeconds,
		ZONE_BG,
		ZONE_TEXT,
		zoneOf,
	} from '$lib/components/zones';
	import type { Segment } from '$lib/workout/types';
	import { targetState, type Block, type RoomRider } from '$lib/room/view';
	import {
		CalendarClock,
		Crown,
		MonitorUp,
		Plus,
		Radio,
		ScreenShare,
	} from '@lucide/svelte';

	let {
		screen,
		riders,
		segments,
		total,
		elapsed,
		block,
		bias,
		countdown = 10,
	}: {
		screen: string;
		riders: RoomRider[];
		segments: Segment[];
		total: number;
		elapsed: number;
		block: Block | null;
		bias: number;
		countdown?: number;
	} = $props();

	const you = $derived(riders.find((r) => r.you)!);
	const others = $derived(riders.filter((r) => !r.you));
	const zoneSeconds = $derived(plannedZoneSeconds(segments, you?.ftp ?? 265));

	const upcoming = [
		{
			name: 'Sweet Spot 2×20',
			when: 'Thu 20:00 · in 2 days',
			minutes: 65,
			by: 'Nina',
		},
		{
			name: 'VO₂ 5×3',
			when: 'Sun 09:30 · in 5 days',
			minutes: 48,
			by: 'Ruben',
		},
	];
	const members = [
		{ name: 'Nina', role: 'owner', ftp: 240, joined: 'Aug 2026', medals: 4 },
		{ name: 'Ruben', role: 'coach', ftp: 310, joined: 'Aug 2026', medals: 2 },
		{ name: 'You', role: 'member', ftp: 265, joined: 'Aug 2026', medals: 3 },
		{ name: 'Sara', role: 'member', ftp: 285, joined: 'Sep 2026', medals: 1 },
		{ name: 'Milo', role: 'member', ftp: 195, joined: 'Sep 2026', medals: 0 },
		{ name: 'Tobi', role: 'member', ftp: 225, joined: 'Sep 2026', medals: 0 },
	];
</script>

{#if screen === 'room-lounge' || screen === 'room-focus' || screen === 'room-stage'}
	<div class="flex h-full flex-col overflow-y-auto px-5 py-4">
		<!-- No page header. Column 2 says which room this is, column 4 says who
		     is in it — a header would be the third thing repeating it. What is
		     left is the one row of things the lounge can DO. -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<button class="btn btn-accent btn-lg"
				><Radio size={15} /> Start a session</button
			>
			<button class="btn btn-secondary"
				><ScreenShare size={14} /> Share screen</button
			>
			<button class="btn btn-ghost btn-xs ml-auto"
				><MonitorUp size={13} /> TV</button
			>
		</div>

		{#if screen === 'room-stage'}
			<!-- What "media-focus" used to be a whole layout for. RMF: nothing is
			     ever overlaid on the player, so the controls sit under it. -->
			<div
				class="border-neon/30 bg-paper relative mb-3 aspect-video w-full shrink-0 overflow-hidden rounded-lg border"
			>
				<div
					class="h-full w-full"
					style="background: radial-gradient(120% 90% at 30% 20%, oklch(0.42 0.16 300), oklch(0.16 0.06 300))"
				></div>
				<span
					class="bg-surface/85 absolute bottom-2 left-2 rounded px-2 py-1 text-[11px]"
					>Ruben's screen</span
				>
			</div>
			<div class="mb-3 flex gap-2">
				{#each ['Ruben · screen', 'Nina · camera', 'Jukebox'] as source, i (source)}
					<button
						class="rounded border px-2.5 py-1 text-[11px] {i === 0
							? 'border-neon text-ink'
							: 'border-muted/20 text-muted'}">{source}</button
					>
				{/each}
			</div>
		{/if}

		{#if screen === 'room-focus'}
			<!-- What "video-first" used to be a whole layout for: one rider,
			     bigger. A tap, not a mode you have to remember you are in.
			     `stretch` is deliberately NOT used — it sets h-full, which needs a
			     parent with a height, and in a width-constrained box it collapses
			     the tile to nothing. aspect-video is what a focused tile wants. -->
			{@const focused = others[1]}
			<div
				class="grid min-h-0 shrink-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]"
			>
				<div>
					<RiderTile rider={focused} phase="lounge" />
					<p class="text-muted mt-2 text-xs">
						<span class="text-ink font-medium">{focused.name}</span> is focused —
						tap their tile again to let go.
					</p>
				</div>
				<!-- Everyone else stays visible beside them, small. Focus narrows
				     what you are looking at; it does not empty the room. -->
				<div class="grid grid-cols-3 gap-2 lg:grid-cols-1">
					{#each riders.filter((r) => r.id !== focused.id) as rider (rider.id)}
						<RiderTile {rider} phase="lounge" />
					{/each}
				</div>
			</div>
		{:else}
			<!-- One fused grid: camera and metrics on the same tile (#181). -->
			<div class="grid shrink-0 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
				{#each riders as rider (rider.id)}
					<RiderTile {rider} phase="lounge" />
				{/each}
			</div>
		{/if}

		<p class="text-muted/70 mt-4 text-[11px]">
			Nothing is running. The room is a place to be — the session starts when
			someone starts it.
		</p>
	</div>
{:else if screen === 'room-countdown'}
	<div class="grid h-full place-items-center">
		<div class="text-center">
			<p class="eyebrow">starting</p>
			<p
				class="font-display text-watt glow-text-strong text-[10rem] leading-none font-bold tabular-nums"
			>
				{countdown}
			</p>
			<p class="font-display mt-4 text-2xl font-bold">Sweet Spot 2×20</p>
			<p class="text-muted mt-1 text-sm">
				65 min · {riders.length} riders · Nina is coaching
			</p>
		</div>
	</div>
{:else if screen.startsWith('room-training')}
	<TrainingPlace
		{riders}
		{you}
		{segments}
		{total}
		{elapsed}
		{block}
		{bias}
		media={screen === 'room-training-media'}
		fault={screen === 'room-training-fault'}
	/>
{:else if screen === 'room-sessions'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<div class="mb-5 flex items-center gap-3">
			<h2 class="font-display text-xl font-bold">What's planned here</h2>
			<button class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> Plan a session</button
			>
		</div>
		<ul class="space-y-2">
			{#each upcoming as entry, i (entry.name)}
				<li
					class="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 {i ===
					0
						? 'border-neon/40'
						: ''}"
				>
					<CalendarClock size={16} class="text-muted shrink-0" />
					<div class="min-w-0 flex-1">
						<p class="eyebrow">
							{i === 0 ? 'next session in this room' : 'after that'}
						</p>
						<p class="font-display truncate text-base font-bold">
							{entry.name}
						</p>
						<p class="text-muted mt-0.5 text-xs">
							{entry.when} · {entry.minutes} min · planned by {entry.by}
						</p>
					</div>
					<span class="flex shrink-0 gap-3">
						<button class="text-muted hover:text-ink text-[11px] underline"
							>move</button
						>
						<button class="text-muted hover:text-ink text-[11px] underline"
							>remove</button
						>
					</span>
				</li>
			{/each}
		</ul>
		<div class="border-ink/5 mt-4 flex flex-wrap gap-4 border-t pt-3">
			<button class="text-muted hover:text-ink text-[11px] underline"
				>subscribe to this room</button
			>
			<a
				href="#sessions"
				class="text-muted hover:text-ink text-[11px] underline"
				>all your sessions</a
			>
		</div>

		<h3 class="eyebrow mt-8">this month</h3>
		<div class="panel mt-2 grid grid-cols-3 gap-4 px-4 py-3">
			{#each [{ k: 'sessions', v: '7' }, { k: 'streak', v: '4 weeks' }, { k: 'work', v: '4 210 kJ' }] as stat (stat.k)}
				<div>
					<p class="eyebrow">{stat.k}</p>
					<p class="font-display text-xl font-bold tabular-nums">{stat.v}</p>
				</div>
			{/each}
		</div>
		<div class="mt-4">
			<p class="eyebrow mb-1.5">time in zone, if you ride what's planned</p>
			<ZoneBar seconds={zoneSeconds} legend />
		</div>
	</div>
{:else if screen === 'room-members'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<h2 class="font-display mb-1 text-xl font-bold">
			Who rides here — {members.length}
		</h2>
		<p class="text-muted mb-5 text-xs">
			Column 4 is the live read; this is the paperwork — roles, medals, when
			they joined.
		</p>
		<ul class="divide-ink/5 panel divide-y">
			{#each members as member (member.name)}
				<li class="flex items-center gap-3 px-4 py-2.5">
					<Avatar name={member.name} size={32} />
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-1.5">
							<span class="truncate text-sm font-medium">{member.name}</span>
							{#if member.role === 'owner'}<Crown
									size={12}
									class="text-muted"
								/>{/if}
						</span>
						<span class="text-muted block text-[11px]"
							>{member.role} · {member.ftp} W · joined {member.joined}</span
						>
					</span>
					{#if member.medals > 0}
						<span class="text-muted shrink-0 text-xs tabular-nums"
							>🏅 {member.medals}</span
						>
					{/if}
					<button class="btn btn-ghost btn-xs shrink-0">Manage</button>
				</li>
			{/each}
		</ul>
	</div>
{:else if screen === 'states'}
	<!-- errors.md owes every screen four states, and the mock was shipping one.
	     Three here, on the surface with all three failure shapes: a cold server,
	     a room with nothing planned, and a request that lost a race. -->
	<div class="mx-auto w-full max-w-3xl space-y-8 px-5 py-6">
		<div>
			<p class="eyebrow mb-2">loading</p>
			<div class="panel space-y-2 p-4">
				<Skeleton class="h-4 w-40" />
				<Skeleton class="h-3 w-64" />
				<Skeleton class="h-3 w-52" />
			</div>
		</div>

		<div>
			<p class="eyebrow mb-2">empty</p>
			<!-- ux.md: empty states teach, never apologise. One line on what the
			     thing is, and the CTA that makes the first one. -->
			<div class="panel px-4 py-8">
				<EmptyState>
					Sessions are how a room agrees on a time. Plan one and it shows up
					here, on everyone's Home, and in their calendar.
					{#snippet cta()}
						<button class="btn btn-primary btn-xs"
							><Plus size={13} /> Plan the first session</button
						>
					{/snippet}
				</EmptyState>
			</div>
		</div>

		<div>
			<p class="eyebrow mb-2">error</p>
			<!-- Says what went wrong, why, and what to do next. "Something went
			     wrong" is a bug (errors.md). -->
			<Banner tone="warn">
				<p class="text-xs">
					<span class="font-medium">That session could not be moved.</span>
					<span class="text-muted"
						>Nina rescheduled it a moment ago, so your change was out of date.
						Reload to see where it sits now.</span
					>
				</p>
			</Banner>
			<button class="btn btn-secondary btn-xs mt-2">Reload the room</button>
		</div>
	</div>
{:else if screen === 'room-settings'}
	<div class="mx-auto w-full max-w-2xl space-y-6 px-5 py-6">
		<div class="panel p-4">
			<label class="block">
				<span class="eyebrow">room name</span>
				<input class="input mt-1 w-full" value="Thursday Sufferfest" />
			</label>
			<label class="mt-3 block">
				<span class="eyebrow">room icon</span>
				<input class="input input-xs mt-1 w-20 text-center" value="🔥" />
			</label>
		</div>
		<div class="panel p-4">
			<h3 class="font-display font-bold">Sound pack</h3>
			<p class="text-muted mt-1 text-xs">
				What the room says out loud when a block changes.
			</p>
			<div class="mt-3 flex flex-wrap gap-2">
				{#each ['Base', 'Arcade', 'Quiet'] as pack, i (pack)}
					<button
						class="rounded border px-3 py-1.5 text-xs {i === 0
							? 'border-neon text-ink'
							: 'border-muted/20 text-muted'}">{pack}</button
					>
				{/each}
			</div>
		</div>
		<div class="panel p-4">
			<h3 class="font-display font-bold">Reactions</h3>
			<div class="mt-3 flex flex-wrap gap-1.5">
				{#each ['🔥', '💪', '😤', '🚀', '☠️', '🧊'] as emoji (emoji)}
					<span class="border-muted/20 rounded border px-2.5 py-1.5 text-base"
						>{emoji}</span
					>
				{/each}
			</div>
		</div>
		<div class="border-z6/40 rounded-lg border p-4">
			<h3 class="font-display text-z6 font-bold">Delete room</h3>
			<p class="text-muted mt-1 text-xs">
				Every ride recorded here stays on the riders' own history. The room, its
				medals and its plans do not.
			</p>
			<button class="btn btn-danger mt-3">Delete Thursday Sufferfest</button>
		</div>
	</div>
{/if}

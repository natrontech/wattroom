<script lang="ts">
	import { ArrowRight, CalendarClock, Flame } from '@lucide/svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { formatWhen } from '$lib/format';
	import FriendsPanel from '$lib/friends/FriendsPanel.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	// Home (#212): the between-rides overview — who is around, what is
	// planned, your friends, your week. Rooms management stays on /rooms.
	interface RoomEntry {
		slug: string;
		name: string;
		connected?: number;
		riders?: string[];
		voice?: string[];
		phase?: string;
		memberCount?: number;
		nextSession?: { workoutName: string; startsAt: string };
	}
	interface Ride {
		id: string;
		workoutName: string;
		startedAt: string;
		seconds: number;
		kj: number;
	}

	void account.load();

	let rooms = $state<RoomEntry[] | null>(null);
	let rides = $state<Ride[] | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		const res = await api<{ rooms: RoomEntry[] }>('/api/rooms');
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		rooms = res.data.rooms;
	}

	$effect(() => {
		if (!account.loaded || !account.me) return;
		void load();
		void api<{ rides: Ride[] }>('/api/rides').then((res) => {
			if (res.ok) rides = res.data.rides;
		});
		// Presence stays honest while the page sits open.
		const timer = setInterval(() => void load(), 10_000);
		return () => clearInterval(timer);
	});

	const busy = $derived((rooms ?? []).filter((r) => (r.connected ?? 0) > 0));
	const planned = $derived(
		(rooms ?? [])
			.filter((r) => r.nextSession)
			.sort(
				(a, b) =>
					Date.parse(a.nextSession!.startsAt) -
					Date.parse(b.nextSession!.startsAt),
			),
	);
	const week = $derived.by(() => {
		const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
		const recent = (rides ?? []).filter(
			(ride) => Date.parse(ride.startedAt) > cutoff,
		);
		return {
			count: recent.length,
			minutes: Math.round(
				recent.reduce((sum, ride) => sum + ride.seconds, 0) / 60,
			),
			kj: Math.round(recent.reduce((sum, ride) => sum + ride.kj, 0)),
		};
	});
</script>

<main class="mx-auto max-w-4xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">
		Hey {account.me?.displayName ?? 'rider'}
	</h1>

	{#if error}
		<div
			class="border-z6/40 bg-z6/10 mt-6 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
		>
			<span>{error}</span>
			<button
				onclick={() => void load()}
				class="text-muted hover:text-ink ml-auto text-xs underline"
				>Retry</button
			>
		</div>
	{/if}

	{#if rooms === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 2 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else}
		<!-- Happening now: the reason to open the app — people. -->
		<section class="mt-8">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Happening now
			</h2>
			{#if busy.length > 0}
				<div class="mt-3 grid gap-3">
					{#each busy as room (room.slug)}
						<a
							href="/r/{room.slug}"
							class="border-muted/15 bg-surface-raised hover:border-muted/40 flex items-center gap-4 rounded-lg border px-5 py-4 transition-colors"
						>
							<span
								class="{room.phase === 'running' || room.phase === 'countdown'
									? 'bg-watt glow-stroke'
									: 'bg-z4'} h-2.5 w-2.5 shrink-0 rounded-full"
							></span>
							<div class="min-w-0">
								<p class="font-display font-bold">{room.name}</p>
								<p class="text-muted mt-0.5 text-xs">
									{(room.riders ?? []).join(', ')}
									{#if room.phase === 'running' || room.phase === 'countdown'}
										· riding now{:else}
										· in the lounge{/if}
								</p>
							</div>
							<span
								class="bg-ink text-paper ml-auto inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold"
								>Join <ArrowRight size={13} /></span
							>
						</a>
					{/each}
				</div>
			{:else}
				<p class="text-muted mt-3 text-sm">
					Nobody's around right now — <a
						href="/rooms"
						class="hover:text-ink underline">open a room</a
					> and your crew gets a place to appear.
				</p>
			{/if}
		</section>

		<!-- Planned: what is coming, across every room you are in. -->
		<section class="mt-8">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Planned
			</h2>
			{#if planned.length > 0}
				<div class="border-muted/15 bg-surface-raised mt-3 rounded-lg border">
					{#each planned as room (room.slug)}
						<a
							href="/r/{room.slug}"
							class="border-ink/5 hover:bg-surface flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0"
						>
							<CalendarClock size={15} class="text-muted shrink-0" />
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">
									{room.nextSession?.workoutName}
								</p>
								<p class="text-muted text-xs">
									{formatWhen(room.nextSession?.startsAt ?? '')} · {room.name}
								</p>
							</div>
						</a>
					{/each}
				</div>
			{:else}
				<p class="text-muted mt-3 text-sm">
					Nothing on the calendar — plan one from a room's lounge and it shows
					up here for everyone.
				</p>
			{/if}
		</section>

		<!-- Friends: presence, requests, DMs — the whole panel, reused. -->
		<FriendsPanel />

		<!-- Your week: enough numbers to feel momentum, not a dashboard farm. -->
		<section class="mt-10">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Your week
			</h2>
			<div class="mt-3 grid grid-cols-3 gap-3">
				<div
					class="border-muted/15 bg-surface-raised rounded-lg border px-4 py-3"
				>
					<p class="font-display text-2xl font-bold tabular-nums">
						{rides === null ? '–' : week.count}
					</p>
					<p class="text-muted text-[10px] tracking-wider uppercase">rides</p>
				</div>
				<div
					class="border-muted/15 bg-surface-raised rounded-lg border px-4 py-3"
				>
					<p class="font-display text-2xl font-bold tabular-nums">
						{rides === null ? '–' : week.minutes}<span
							class="text-muted ml-1 text-sm">min</span
						>
					</p>
					<p class="text-muted text-[10px] tracking-wider uppercase">
						in the saddle
					</p>
				</div>
				<div
					class="border-muted/15 bg-surface-raised rounded-lg border px-4 py-3"
				>
					<p
						class="font-display inline-flex items-center gap-1.5 text-2xl font-bold tabular-nums"
					>
						{rides === null ? '–' : week.kj}<span class="text-muted text-sm"
							>kJ</span
						>
						{#if week.kj > 0}<Flame size={16} class="text-z5" />{/if}
					</p>
					<p class="text-muted text-[10px] tracking-wider uppercase">work</p>
				</div>
			</div>
			<p class="text-muted mt-2 text-xs">
				FTP {account.me?.ftpWatts ?? '–'} W ·
				<a href="/history" class="hover:text-ink underline">all rides</a> ·
				<a href="/ramp" class="hover:text-ink underline">retest FTP</a>
			</p>
		</section>
	{/if}
</main>

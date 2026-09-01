<script lang="ts">
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { ArrowRight, CalendarClock, Flame, Radio } from '@lucide/svelte';
	import { account } from '$lib/account.svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { formatWhen } from '$lib/format';
	import { presence } from '$lib/presence.svelte';
	import {
		fetchProgression,
		FORM_SENTENCES,
		type LoadSummary,
	} from '$lib/progression';
	import Banner from '$lib/components/Banner.svelte';
	import { changelog } from '$lib/changelog.svelte';
	import { summarize } from '$lib/changelog';
	import Skeleton from '$lib/components/Skeleton.svelte';

	// Home (#212): the between-rides overview — who is around, what is
	// planned, your friends, your week. ADR-0020 folded /sessions in here and
	// retired /rooms — the sidebar is the room list.
	interface RoomEntry {
		slug: string;
		name: string;
		icon?: string;
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
	// What's new (#345). Home is the between-rides surface, which is the only
	// place this belongs — ux.md: never interrupt a rider mid-interval.
	void changelog.load();

	let rides = $state<Ride[] | null>(null);
	let error = $state<string | null>(null);
	let form = $state<LoadSummary | null>(null);

	// The shell's presence store is this list, re-fetched on every lobby ping
	// (#251). Home used to fetch it again, so each ping cost two identical
	// requests; the rail feed carries everything this page reads.
	const rooms = $derived(presence.loaded ? presence.rooms : null);
	$effect(() => {
		if (!account.loaded || !account.me) return;
		void fetchProgression().then((res) => {
			// Decorative context — on failure the form line simply stays away.
			// Hidden through the SPEC cold start: numbers first, opinions once
			// they mean something.
			if (res.ok && res.data?.load && !res.data.load.building)
				form = res.data.load;
		});
		void api<{ rides: Ride[] }>('/api/rides').then((res) => {
			if (res.ok) rides = res.data.rides;
		});
	});

	const busy = $derived((rooms ?? []).filter((r) => (r.connected ?? 0) > 0));

	const greeting = $derived.by(() => {
		const h = new Date().getHours();
		return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
	});
	// One sentence and one button: the room that is riding, else the room
	// with people in it, else nothing — a hero with nowhere to go is noise.
	const headline = $derived.by(() => {
		const live = busy.find((r) => r.live && r.session);
		if (live && live.session) {
			const min = Math.round(live.session.elapsedSec / 60);
			return {
				slug: live.slug,
				text: `${live.name} is riding right now — ${min < 1 ? 'just starting' : `${min} minute${min === 1 ? '' : 's'} in`}.`,
				cta: 'Join the ride',
			};
		}
		const around = busy[0];
		if (around)
			return {
				slug: around.slug,
				text: `${(around.riders ?? []).join(', ')} ${(around.riders ?? []).length === 1 ? 'is' : 'are'} in ${around.name}.`,
				cta: 'Join them',
			};
		return null;
	});
	const planned = $derived(
		(rooms ?? [])
			.filter((r) => r.next)
			.sort(
				(a, b) => Date.parse(a.next!.startsAt) - Date.parse(b.next!.startsAt),
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

	// ── Opening and joining, absorbed (ADR-0020) ─────────────────────────────
	// /rooms retired into the sidebar, but its two real actions had to land
	// somewhere: this is what the sidebar's + points at.
	let newRoomName = $state('');
	let joinCode = $state('');
	let roomBusy = $state(false);
	let roomError = $state<string | null>(null);

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]{0,6}$/i.test(joinCode),
	);
	// docs/SPEC.md ownership cap: at 3 owned rooms the affordance disables with
	// the reason, instead of a 409 on click (ux.md capability gating). Off the
	// presence feed the shell already holds — fetching /api/rooms again here
	// doubled the request on every ping.
	const ownedOut = $derived(
		(rooms ?? []).filter((room) => room.role === 'owner').length >= 3,
	);

	async function createRoom() {
		roomBusy = true;
		const res = await api<{ slug: string }>('/api/rooms', {
			method: 'POST',
			json: { name: newRoomName },
		});
		roomBusy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else roomError = res.error.message;
	}

	async function joinByCode() {
		roomBusy = true;
		const res = await api<{ slug: string }>('/api/rooms/join', {
			method: 'POST',
			json: { code: joinCode },
		});
		roomBusy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else roomError = res.error.message;
	}
</script>

<main class="page max-w-4xl">
	<!-- The mock's header (ADR-0020): a greeting, one sentence on what is
	     happening, and the one thing to do about it. Home is the between-
	     rides surface, so the first thing it says is where the ride is. -->
	<h1 class="font-display text-3xl font-bold tracking-tight">
		{greeting}, {account.me?.displayName?.split(' ')[0] ?? 'rider'}.
	</h1>
	{#if headline}
		<p class="text-muted mt-1 text-sm">{headline.text}</p>
		<a href="/r/{headline.slug}" class="btn btn-accent btn-lg mt-4"
			><Radio size={15} /> {headline.cta}</a
		>
	{/if}

	{#if error}
		<div class="mt-6">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button
						onclick={() => location.reload()}
						class="text-muted hover:text-ink text-xs underline">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}

	{#if changelog.unseen}
		<div class="mt-6">
			<Banner tone="ok">
				<span class="font-display font-bold">{changelog.unseen.version}</span>
				is running — {summarize(changelog.unseen)}.
				<a href="/whats-new" class="underline">See what changed</a>
				{#snippet action()}
					<button
						onclick={() => changelog.dismiss()}
						class="text-muted hover:text-ink text-xs underline">Dismiss</button
					>
				{/snippet}
			</Banner>
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
		<!-- Around right now: the reason to open the app — people. -->
		<section class="mt-8">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Around right now
			</h2>
			{#if busy.length > 0}
				<div class="mt-3 grid gap-3">
					{#each busy as room (room.slug)}
						<a
							href="/r/{room.slug}"
							class="panel hover:border-muted/40 flex items-center gap-4 px-5 py-4 transition-colors"
						>
							{#if room.live}
								<RidingBars size={12} />
							{:else}
								<span class="bg-z4 h-2.5 w-2.5 shrink-0 rounded-full"></span>
							{/if}
							<div class="min-w-0">
								<p class="font-display font-bold">
									{room.icon ? `${room.icon} ` : ''}{room.name}
								</p>
								<p class="text-muted mt-0.5 text-xs">
									{(room.riders ?? []).join(', ')}
									{#if room.live}
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
					Nobody's around right now — open a room below and your crew gets a
					place to appear.
				</p>
			{/if}
		</section>

		<!-- Your week: enough numbers to feel momentum, not a dashboard farm. -->
		<section class="mt-10">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Your week
			</h2>
			<div class="mt-3 grid grid-cols-3 gap-3">
				<div class="panel px-4 py-3">
					<p class="font-display text-2xl font-bold tabular-nums">
						{rides === null ? '–' : week.count}
					</p>
					<p class="eyebrow">rides</p>
				</div>
				<div class="panel px-4 py-3">
					<p class="font-display text-2xl font-bold tabular-nums">
						{rides === null ? '–' : week.minutes}<span
							class="text-muted ml-1 text-sm">min</span
						>
					</p>
					<p class="eyebrow">in the saddle</p>
				</div>
				<div class="panel px-4 py-3">
					<p
						class="font-display inline-flex items-center gap-1.5 text-2xl font-bold tabular-nums"
					>
						{rides === null ? '–' : week.kj}<span class="text-muted text-sm"
							>kJ</span
						>
						{#if week.kj > 0}<Flame size={16} class="text-z5" />{/if}
					</p>
					<p class="eyebrow">work</p>
				</div>
			</div>
			{#if form}
				<p class="text-muted mt-2 text-xs">
					<span class="text-ink font-display font-semibold"
						>form {form.formPct > 0 ? '+' : ''}{Math.round(form.formPct)}%</span
					>
					· {FORM_SENTENCES[form.zone] ?? form.zone} ·
					<span class="text-[11px]">from your WattRoom rides</span>
				</p>
			{/if}
			<p class="text-muted mt-2 text-xs">
				FTP {account.me?.ftpWatts ?? '–'} W ·
				<a href="/history" class="hover:text-ink underline">all rides</a> ·
				<a href="/ramp" class="hover:text-ink underline">retest FTP</a>
			</p>
		</section>

		<!-- Your rooms: the sidebar is the list, so this is only what the list
		     cannot be — the two ways to get another one (ADR-0020). -->
		<section id="rooms" class="mt-8">
			<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
				Your rooms
			</h2>
			{#if roomError}
				<div class="mt-3"><Banner tone="error">{roomError}</Banner></div>
			{/if}
			<div class="mt-3 grid gap-3 sm:grid-cols-2">
				<div class="panel p-5">
					<h3 class="font-display font-bold">Open a room</h3>
					<p class="text-muted mt-1 text-xs">
						Private by default. Share the link or the code with whoever you ride
						with.
					</p>
					<form
						onsubmit={(e) => {
							e.preventDefault();
							void createRoom();
						}}
					>
						<input
							bind:value={newRoomName}
							maxlength="60"
							class="input mt-3 w-full"
							placeholder="Room name"
						/>
						<button
							disabled={roomBusy || !newRoomName.trim() || ownedOut}
							class="btn btn-primary mt-3 w-full">Open room</button
						>
						{#if ownedOut}
							<p class="text-muted mt-2 text-xs">
								You own 3 rooms — the cap. Delete one to open another.
							</p>
						{/if}
					</form>
				</div>

				<div class="panel p-5">
					<h3 class="font-display font-bold">Join with a code</h3>
					<p class="text-muted mt-1 text-xs">
						Six characters, from whoever invited you.
					</p>
					<form
						onsubmit={(e) => {
							e.preventDefault();
							void joinByCode();
						}}
					>
						<input
							bind:value={joinCode}
							maxlength="6"
							class="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tracking-[0.3em] uppercase outline-none placeholder:tracking-normal placeholder:normal-case {invalidCode
								? 'border-z6/60'
								: 'border-muted/25 focus:border-muted/60'}"
							placeholder="Room code"
						/>
						{#if invalidCode}
							<!-- Field-level validation lands under the field (errors.md). -->
							<p class="text-z6 mt-1.5 text-xs">
								Codes are letters and numbers only.
							</p>
						{/if}
						<button
							disabled={roomBusy || joinCode.length !== 6 || invalidCode}
							class="btn btn-secondary mt-3 w-full">Join room</button
						>
					</form>
				</div>
			</div>
		</section>

		<!-- What's next: every room's plan, across every room you are in
		     (ADR-0020 — /sessions retired into this). Planning itself happens in
		     the room whose session it is. -->
		<section id="sessions" class="mt-8">
			<div class="flex items-baseline gap-3">
				<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
					What's next
				</h2>
			</div>
			{#if planned.length > 0}
				<div class="panel mt-3">
					{#each planned as room (room.slug)}
						<a
							href="/r/{room.slug}"
							class="border-ink/5 hover:bg-surface flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0"
						>
							<CalendarClock size={15} class="text-muted shrink-0" />
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">
									{room.next?.workoutName}
								</p>
								<p class="text-muted text-xs">
									{formatWhen(room.next?.startsAt ?? '')} · {room.name}
								</p>
							</div>
						</a>
					{/each}
				</div>
			{:else}
				<p class="text-muted mt-3 text-sm">
					Nothing on the calendar. Open a room's <em>Sessions</em> and plan one —
					it shows up here, and in everyone's calendar.
				</p>
			{/if}
		</section>

		<!-- Friends moved to its own place (ADR-0020) — a list of people does
		     not belong under your week's kJ. -->
		<section class="mt-8">
			<div class="flex items-baseline gap-3">
				<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
					Friends
				</h2>
				<a
					href="/friends"
					class="text-muted hover:text-ink ml-auto text-xs underline"
					>All friends →</a
				>
			</div>
		</section>
	{/if}
</main>

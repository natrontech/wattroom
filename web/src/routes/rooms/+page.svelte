<script lang="ts">
	import { goto } from '$app/navigation';
	import Logo from '$lib/brand/Logo.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import FriendsPanel from '$lib/friends/FriendsPanel.svelte';

	interface RoomSummary {
		slug: string;
		name: string;
		icon?: string;
		listed: boolean;
		memberCount?: number;
		connected?: number;
		phase?: string;
		riders?: string[];
		role?: string;
		nextSession?: { workoutName: string; startsAt: string };
	}
	interface Medal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	interface RoomDetail {
		slug: string;
		name: string;
		code?: string;
		medals?: Medal[];
		streakWeeks?: number;
	}

	void account.load();

	// errors.md: every page owes four states — loading, error, empty, content.
	let rooms = $state<RoomSummary[] | null>(null);
	let error = $state<string | null>(null);
	let detail = $state<RoomDetail | null>(null);
	let name = $state('');
	let joinCode = $state('');
	let busy = $state(false);
	let copied = $state(false);

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]{0,6}$/i.test(joinCode),
	);

	$effect(() => {
		if (account.loaded && account.me && rooms === null) void load();
	});

	async function load() {
		const res = await api<{ rooms: RoomSummary[] }>('/api/rooms');
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		rooms = res.data.rooms;
		// The first room's paperwork feeds the invite card and medal history.
		if (rooms.length > 0) {
			const first = await api<RoomDetail>(`/api/rooms/${rooms[0].slug}`);
			if (first.ok) detail = first.data;
		}
	}

	// docs/SPEC.md ownership cap: at 3 owned rooms the affordance disables
	// with the reason, instead of a 409 on click (ux.md capability gating).
	const ownedOut = $derived(
		(rooms ?? []).filter((room) => room.role === 'owner').length >= 3,
	);

	async function create() {
		busy = true;
		const res = await api<{ slug: string }>('/api/rooms', {
			method: 'POST',
			json: { name },
		});
		busy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else error = res.error.message;
	}

	async function joinByCode() {
		busy = true;
		const res = await api<{ slug: string }>('/api/rooms/join', {
			method: 'POST',
			json: { code: joinCode },
		});
		busy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else error = res.error.message;
	}

	function copyLink() {
		void navigator.clipboard
			?.writeText(`${location.origin}/r/${detail?.slug}`)
			.then(() => {
				copied = true;
				setTimeout(() => (copied = false), 1500);
			});
	}

	const MEDAL_NAME: Record<string, string> = {
		diesel: 'Diesel',
		metronome: 'Metronome',
		hammer: 'Hammer',
		lanterne_rouge: 'Lanterne Rouge',
	};

	/** Medal history grouped by day, newest first — the mock's session rows. */
	const medalDays = $derived.by(() => {
		const byDay = new Map<string, Medal[]>();
		for (const medal of detail?.medals ?? []) {
			const list = byDay.get(medal.awardedAt) ?? [];
			list.push(medal);
			byDay.set(medal.awardedAt, list);
		}
		return [...byDay.entries()].slice(0, 5);
	});
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-3xl font-bold tracking-tight">Rooms</h1>
	</div>

	{#if error}
		<div
			class="border-z6/40 bg-z6/10 mt-6 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
		>
			<span>{error}</span>
			<button
				onclick={() => {
					error = null;
					rooms = null;
				}}
				class="text-muted hover:text-ink ml-auto text-xs underline"
				>Retry</button
			>
		</div>
	{/if}

	{#if !account.loaded || (account.me && rooms === null && !error)}
		<div class="mt-8 grid gap-3">
			{#each { length: 3 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else if rooms !== null && rooms.length === 0}
		<!-- Empty states teach, never apologise: the only onboarding most read. -->
		<div
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-10 text-center"
		>
			<Logo size={56} />
			<h2 class="font-display mt-6 text-2xl font-bold">
				A room is a place, not a session.
			</h2>
			<p class="text-muted mx-auto mt-3 max-w-md text-sm leading-relaxed">
				You open one once and it stays. Your crew drops in, voices connect,
				someone queues music, and when a coach picks a workout everyone rides it
				at their own FTP.
			</p>
			<div class="mt-7 flex justify-center gap-3">
				<button
					onclick={() => document.getElementById('open-room-name')?.focus()}
					class="bg-ink text-paper hover:bg-ink/90 rounded px-5 py-3 text-sm font-semibold"
					>Open your first room</button
				>
				<button
					onclick={() => document.getElementById('join-code')?.focus()}
					class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
					>I have a code</button
				>
			</div>
		</div>
	{:else if rooms !== null}
		<div class="mt-8 grid gap-3">
			{#each rooms as room (room.slug)}
				<a
					href="/r/{room.slug}"
					class="border-muted/15 bg-surface-raised hover:border-muted/40 flex items-center gap-4 rounded-lg border px-5 py-4 transition-colors"
				>
					<div class="min-w-0">
						<p class="font-display font-bold">
							{room.icon ? `${room.icon} ` : ''}{room.name}
						</p>
						<p class="text-muted mt-0.5 text-xs">
							{#if room.phase === 'running' || room.phase === 'countdown'}
								riding now · {(room.riders ?? []).join(', ') ||
									`${room.connected} in the room`}
							{:else if (room.connected ?? 0) > 0}
								{(room.riders ?? []).join(', ') || room.connected} in the lounge
							{:else if (room.memberCount ?? 0) > 1}
								{room.memberCount} members — open it and your crew gets a ping
							{:else}
								<!-- Quiet room: say what to do, not just that it's empty. -->
								empty — share the link and your crew appears
							{/if}
						</p>
						{#if room.nextSession}
							<p class="text-muted mt-0.5 text-xs">
								next: {room.nextSession.workoutName} ·
								{new Date(room.nextSession.startsAt).toLocaleString(undefined, {
									weekday: 'short',
									hour: '2-digit',
									minute: '2-digit',
								})}
							</p>
						{/if}
					</div>
					{#if room.phase === 'running' || room.phase === 'countdown'}
						<span
							class="bg-watt glow-stroke ml-auto h-2 w-2 shrink-0 rounded-full"
						></span>
					{/if}
				</a>
			{/each}
		</div>

		<!-- Who's around (ADR-0012) — a ride starts from people, not a slot. -->
		<FriendsPanel />

		{#if detail && medalDays.length > 0}
			<section class="border-muted/15 mt-8 rounded-lg border p-5">
				<div class="flex items-baseline gap-3">
					<h2 class="font-display font-bold">{detail.name} · medal history</h2>
					{#if (detail.streakWeeks ?? 0) > 0}
						<span class="text-muted ml-auto font-mono text-[11px] tabular-nums"
							>{detail.streakWeeks} wk streak</span
						>
					{/if}
				</div>
				<ul class="mt-4 space-y-2">
					{#each medalDays as [day, dayMedals] (day)}
						<li class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
							<span class="text-muted w-20 shrink-0 font-mono tabular-nums"
								>{day.slice(5)}</span
							>
							{#each dayMedals as medal, i (i)}
								<span class="text-muted">
									{MEDAL_NAME[medal.kind] ?? medal.kind}
									<span
										class={medal.rider === account.me?.displayName
											? 'text-watt'
											: 'text-ink'}>{medal.rider}</span
									>
								</span>
							{/each}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}

	{#if account.loaded && account.me && rooms !== null}
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			{#if detail?.code}
				<div class="border-muted/15 rounded-lg border p-5">
					<h2 class="font-display font-bold">Invite to {detail.name}</h2>
					<p class="text-muted mt-1 text-xs">
						The link is the golden path — it works on any device without typing.
					</p>
					<div
						class="border-muted/25 mt-3 flex items-center gap-2 rounded border px-3 py-2"
					>
						<span class="truncate font-mono text-xs"
							>{location.host}/r/{detail.slug}</span
						>
						<button
							onclick={copyLink}
							class="text-muted hover:text-ink ml-auto shrink-0 text-xs"
							>{copied ? 'Copied' : 'Copy'}</button
						>
					</div>
					<div class="mt-2 flex items-center gap-3">
						<span class="font-mono text-lg tracking-[0.3em] tabular-nums"
							>{detail.code}</span
						>
						<span class="text-muted text-[11px]"
							>for TVs and phones that can't open a link</span
						>
					</div>
				</div>
			{/if}

			<div class="border-muted/15 rounded-lg border p-5">
				<h2 class="font-display font-bold">Open a room</h2>
				<p class="text-muted mt-1 text-xs">
					Private by default. Share the link or the code with whoever you ride
					with.
				</p>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void create();
					}}
				>
					<input
						id="open-room-name"
						bind:value={name}
						maxlength="60"
						class="border-muted/25 placeholder:text-muted/60 focus:border-muted/60 mt-3 w-full rounded border bg-transparent px-3 py-2 text-sm outline-none"
						placeholder="Room name"
					/>
					<button
						disabled={busy || !name.trim() || ownedOut}
						class="bg-ink text-paper hover:bg-ink/90 mt-3 w-full rounded px-4 py-2.5 text-sm font-medium disabled:opacity-40"
						>Open room</button
					>
					{#if ownedOut}
						<p class="text-muted mt-2 text-xs">
							You own 3 rooms — the cap. Delete one to open another.
						</p>
					{/if}
				</form>
			</div>

			<div class="border-muted/15 rounded-lg border p-5">
				<h2 class="font-display font-bold">Join with a code</h2>
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
						id="join-code"
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
						disabled={busy || joinCode.length !== 6 || invalidCode}
						class="border-muted/30 hover:border-muted/60 mt-3 w-full rounded border px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
						>Join room</button
					>
				</form>
			</div>
		</div>
	{/if}
</main>

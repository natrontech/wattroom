<script lang="ts">
	import FitnessChart from '$lib/components/FitnessChart.svelte';
	import { confirm } from '$lib/confirm.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import FtpPrompt from '$lib/components/FtpPrompt.svelte';
	import { account } from '$lib/account.svelte';
	import {
		declineFtp,
		declinedFtp,
		suggestionDeclined,
	} from '$lib/ftp-decline';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
	import {
		fetchProgression,
		FORM_SENTENCES,
		type Progression,
	} from '$lib/progression';
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { api } from '$lib/api';
	import { formatClock } from '$lib/format';
	import { createHistoryStore, type RideRecord } from '$lib/history.svelte';
	import { toasts } from '$lib/toast.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
		type MenuItem,
	} from '$lib/context-menu.svelte';
	import DeleteRideDialog from '$lib/ride/DeleteRideDialog.svelte';
	import { untrack } from 'svelte';
	import Lock from '@lucide/svelte/icons/lock';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import type { PageData } from './$types';
	import type { ServerRide } from './+page';

	let { data }: { data: PageData } = $props();

	// The FTP prompt where the rider is looking at the curve (#1552):
	// WATTROOM.md has the server prompt when the curve outgrows the setting,
	// and a settings sub-page was the only place that did. The decline is
	// remembered, keyed on the value.
	const profile = createProfileStore();
	let declined = $state(declinedFtp());
	let applied = $state(false);
	const suggestion = $derived(
		account.me?.suggestedFtp &&
			!applied &&
			!suggestionDeclined(account.me.suggestedFtp, declined)
			? account.me.suggestedFtp
			: null,
	);
	async function applySuggestion(next: number) {
		const message =
			(await pushProfile({ ftpWatts: next })) ??
			profile.update({ ftp: next, ftpMeasuredAt: Date.now() });
		if (message) {
			toasts.push(message, { tone: 'error' });
			return;
		}
		applied = true;
		toasts.push(`FTP set to ${next} W — every workout now scales to it.`);
	}
	// Device-only leftovers: summaries the server did not take — refused for
	// being under a minute, saved while it was unreachable, or from before
	// #110. They have no samples, so they cannot become account rides — they
	// stay listed here until cleared.
	const device = createHistoryStore();

	async function clearDevice() {
		const n = device.all.length;
		const ok = await confirm({
			title: `Clear ${n} device ride${n === 1 ? '' : 's'}?`,
			body: 'These summaries exist only on this device — nothing can bring them back.',
			action: 'Clear them',
			cancel: 'Keep them',
		});
		if (ok) device.clear();
	}

	let rides = $state<ServerRide[] | null>(untrack(() => data.rides));
	let error = $state<string | null>(untrack(() => data.ridesError));
	// The list is paged (#1549): the server says whether older rides exist,
	// and the next page begins before the oldest one here. Its failure is
	// its own inline line — the page banner is for the page.
	let more = $state(untrack(() => data.more));
	let loadingMore = $state(false);
	let moreError = $state<string | null>(null);
	async function loadMore() {
		const oldest = rides?.at(-1);
		if (!oldest || loadingMore) return;
		loadingMore = true;
		moreError = null;
		const res = await api<{ rides: ServerRide[]; more?: boolean }>(
			`/api/rides?before=${encodeURIComponent(oldest.startedAt)}`,
		);
		loadingMore = false;
		if (!res.ok) {
			moreError = res.error.message;
			return;
		}
		rides = [...(rides ?? []), ...res.data.rides];
		more = !!res.data.more;
	}

	// Undo over confirm (errors.md): the flip lands at once, the toast takes
	// it back. A refused flip reverts the row and says why.
	async function setShared(ride: ServerRide, shared: boolean, undoable = true) {
		const before = ride.sharedWithFriends;
		ride.sharedWithFriends = shared;
		const res = await api(`/api/rides/${ride.id}`, {
			method: 'PATCH',
			json: { sharedWithFriends: shared },
		});
		if (!res.ok) {
			ride.sharedWithFriends = before;
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(
			shared ? 'Shared with your friends.' : 'Private again.',
			undoable
				? { undo: () => void setShared(ride, !shared, false) }
				: undefined,
		);
	}

	// The ride the confirm is asking about; null while nothing is being deleted.
	let deleting = $state<ServerRide | null>(null);

	// The row's verbs, as menu items too (#486). A device-only ride has no
	// server to flip or delete, so its row offers nothing and keeps the
	// browser's menu. Delete opens the confirm rather than acting: unlike
	// sharing, it cannot be handed back by an undo toast (errors.md).
	const rowMenu = (ride: ServerRide): MenuEntry[] => [
		{
			label: ride.sharedWithFriends ? 'Make private' : 'Share with friends',
			icon: ride.sharedWithFriends ? Lock : Users,
			onSelect: () => void setShared(ride, !ride.sharedWithFriends),
		} satisfies MenuItem,
		'separator',
		{
			label: 'Delete ride',
			icon: Trash2,
			danger: true,
			onSelect: () => (deleting = ride),
		} satisfies MenuItem,
	];

	// A chart's drilldown (the rides chart above, once /progression's) lands here with ?ride=<id> — ring it.
	let highlightId = $state<string | null>(null);

	async function load() {
		const res = await api<{ rides: ServerRide[]; more?: boolean }>(
			'/api/rides',
		);
		if (res.ok) {
			rides = res.data.rides;
			more = !!res.data.more;
			error = null;
			await ring(rides);
		} else {
			error = res.error.message;
		}
	}

	// The rides arrive seeded from load() (#772) and nothing calls load()
	// until Retry — so the mount is where the ring happens now (#824).
	$effect(() => {
		const seeded = untrack(() => rides);
		if (seeded) void ring(seeded);
	});

	async function ring(list: ServerRide[]) {
		const picked = page.url.searchParams.get('ride');
		if (picked && list.some((ride) => ride.id === picked)) {
			highlightId = picked;
			await tick();
			// Instant, retried: smooth scrolling gets cancelled by the route
			// transition, and arriving from another page needs a position,
			// not an animation.
			for (const delay of [50, 400]) {
				setTimeout(() => {
					const row = document.getElementById(`ride-${picked}`);
					if (!row) return;
					const box = row.getBoundingClientRect();
					if (box.top > window.innerHeight * 0.8 || box.top < 0) {
						row.scrollIntoView({ behavior: 'instant', block: 'center' });
					}
				}, delay);
			}
		}
	}

	// ── Progression, absorbed (ADR-0020) ─────────────────────────────────────
	// The charts and the rides they are drawn from were two pages, and every
	// drilldown was a navigation between them.
	let progression = $state<Progression | null>(untrack(() => data.progression));
	let progressionError = $state<string | null>(
		untrack(() => data.progressionError),
	);
	async function loadProgression() {
		const res = await fetchProgression();
		if (res.ok) {
			progression = res.data;
			progressionError = null;
		} else {
			progressionError = res.error.message;
		}
	}

	// The drilldowns stay put now: the ride they point at is further down this
	// same page, so they ring it instead of navigating.
	function ringRide(id: string) {
		highlightId = id;
		document.getElementById(`ride-${id}`)?.scrollIntoView({ block: 'center' });
	}
	function openDay(date: string) {
		// Snap to the nearest ride — most days carry none, and a click that
		// silently does nothing reads as broken.
		const target = new Date(date + 'T12:00:00Z').getTime();
		let best: string | null = null;
		let dist = Infinity;
		for (const ride of progression?.rides ?? []) {
			const d = Math.abs(new Date(ride.date).getTime() - target);
			if (d < dist) {
				dist = d;
				best = ride.id;
			}
		}
		if (best) ringRide(best);
	}
</script>

<svelte:head><title>Rides · WattRoom</title></svelte:head>

{#snippet rideRow(ride: RideRecord, badge?: string, server?: ServerRide)}
	<li
		id="ride-{ride.id}"
		title={server ? MENU_HINT : undefined}
		class="panel relative flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 {highlightId ===
		ride.id
			? 'ring-z2/70 ring-1'
			: ''}"
		{@attach contextMenu(() => (server ? rowMenu(server) : []))}
	>
		{#if server}
			<!-- The whole row opens the ride (#503): a tap target the size of the
			     row, which is what a rider off the bike reaches for. Overlaid
			     rather than wrapping, so the share button stays its own control. -->
			<a
				href="/history/{ride.id}"
				class="focus-visible:ring-neon/60 absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
			>
				<span class="sr-only">Open {ride.workoutName}</span>
			</a>
		{/if}
		<span class="font-display font-bold">{ride.workoutName}</span>
		{#if badge}
			<span class="eyebrow">{badge}</span>
		{/if}
		<span class="text-muted text-xs"
			>{new Date(ride.startedAt).toLocaleDateString()}</span
		>
		<span class="text-muted ml-auto font-mono text-xs tabular-nums"
			>{formatClock(ride.seconds)}</span
		>
		<span class="font-mono text-xs tabular-nums">{ride.avgWatts} W</span>
		<span class="text-muted font-mono text-xs tabular-nums">{ride.kj} kJ</span>
		<!-- A ride whose workout prescribed no target has no execution to show;
		     the dash says so on hover rather than sitting there unexplained. -->
		<span
			class="font-display text-sm font-semibold tabular-nums"
			title={ride.executionScored === false
				? 'This workout had no power targets to score'
				: undefined}
			>{ride.executionScored === false
				? '—'
				: `${Math.round(ride.execution * 100)}%`}</span
		>
		{#if server}
			<!-- Per-ride sharing (ADR-0024): off by default, one tap to flip. -->
			<button
				onclick={() => void setShared(server, !server.sharedWithFriends)}
				class="btn btn-ghost btn-xs relative -my-1 -mr-2"
				title={server.sharedWithFriends
					? 'Friends see this ride on your page — make it private'
					: 'Only you see this ride — share it with your friends'}
			>
				{#if server.sharedWithFriends}
					<Users size={13} /> shared
				{:else}
					<Lock size={13} /> private
				{/if}
			</button>
		{/if}
	</li>
{/snippet}

<main class="page">
	<div class="flex flex-wrap items-center gap-3">
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Rides</h1>
			<p class="text-muted text-xs">
				Private by default — share one with your friends from its row.
			</p>
		</div>
	</div>

	<!-- Progression, absorbed (ADR-0020): the charts and the rides they are
	     drawn from were two pages, and every drilldown was a navigation
	     between them. The charts ring a ride further down this page now. -->
	{#if progressionError}
		<div class="mt-8">
			<Banner tone="error">
				{progressionError}
				{#snippet action()}
					<button
						onclick={() => void loadProgression()}
						class="btn-link text-xs">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if progression === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 2 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border p-6">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-4 h-40" />
				</div>
			{/each}
		</div>
	{:else if progression.rides.length > 0}
		<div class="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<span class="text-muted text-xs">
				Category
				<span class="text-ink font-display text-sm font-bold"
					>{progression.category}</span
				>
				{#if progression.wkg > 0}
					· {progression.wkg.toFixed(1)} w/kg, 90-day best 20 min
				{/if}
			</span>
		</div>

		<div class="mt-3 grid gap-3 xl:grid-cols-2">
			<div class="panel px-6 py-5">
				<h2 class="text-ink text-sm font-semibold">Best power by duration</h2>
				<!-- Interpretation lives in the UI, not the rider's head: every
				     panel says what its numbers mean in one line. -->
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					Your hardest average power held for each duration. The shades compare
					now with your past: a darker bar reaching its lighter neighbours means
					you're back at your best.
				</p>
				<PowerCurveChart
					d30={progression.curve.d30}
					d90={progression.curve.d90}
					all={progression.curve.all}
				/>
			</div>
			{#if suggestion && account.me}
				<div class="mb-3">
					<FtpPrompt
						current={account.me.ftpWatts}
						suggested={suggestion}
						best20={account.me.best20m ?? 0}
						onApply={() => void applySuggestion(suggestion)}
						onKeep={() => {
							declineFtp(suggestion);
							declined = suggestion;
						}}
					/>
				</div>
			{/if}
			<div class="panel px-6 py-5">
				<h2 class="text-ink text-sm font-semibold">FTP over the last year</h2>
				<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
					The line is the FTP your rides were scored against; each dot is a
					ride's best 20 minutes. Dots climbing away above the line mean your
					FTP is due a retest.
				</p>
				<FtpTrendChart
					rides={progression.rides}
					onpick={(ride) => ringRide(ride.id)}
				/>
			</div>
			{#if progression.load && progression.load.series.length > 1}
				{@const load = progression.load}
				<div class="panel px-6 py-5 xl:col-span-2">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h2 class="text-ink text-sm font-semibold">Training load</h2>
						{#if load.building}
							<span class="text-muted text-xs italic"
								>building history — form shows after your first month</span
							>
						{:else}
							<span class="text-ink font-display text-sm font-semibold">
								form {load.formPct > 0 ? '+' : ''}{Math.round(load.formPct)}%
							</span>
							<span class="text-muted text-xs"
								>{FORM_SENTENCES[load.zone] ?? load.zone}</span
							>
						{/if}
					</div>
					<p class="text-muted mt-0.5 mb-4 max-w-2xl text-xs">
						Every ride adds load. Fitness is the load your body is used to (a
						slow 42-day average); fatigue is the last week (fast). Training with
						fatigue a little above fitness is what builds — far above it is
						where recovery earns more than riding.
					</p>
					<FitnessChart series={load.series} onpick={openDay} />
				</div>
			{/if}
		</div>

		<h2 class="eyebrow mt-10">every ride</h2>
	{/if}

	{#if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if rides === null}
		<div class="mt-8 grid gap-3">
			{#each { length: 3 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else if rides.length === 0 && device.all.length === 0}
		<!-- Empty states teach (.claude/rules/ux.md). -->
		<div class="mt-8">
			<EmptyState>
				<p class="text-ink text-sm">No rides yet.</p>
				<p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					Finish a workout and it lands here with its execution score. You can
					export any ride as a .fit for Strava or your head unit.
				</p>
				{#snippet cta()}
					<a href="/workouts" class="btn btn-primary">Pick a workout</a>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<ul class="mt-8 grid gap-2 xl:grid-cols-2">
			{#each rides as ride (ride.id)}
				{@render rideRow(ride, ride.room ? 'room' : undefined, ride)}
			{/each}
		</ul>
		{#if more}
			<div class="mt-3">
				{#if moreError}
					<div class="mb-2">
						<Banner tone="error">
							{moreError}
							{#snippet action()}
								<button onclick={loadMore} class="btn-link text-xs"
									>Retry</button
								>
							{/snippet}
						</Banner>
					</div>
				{/if}
				<button
					onclick={loadMore}
					disabled={loadingMore}
					class="btn btn-secondary"
					>{loadingMore ? 'Loading…' : 'Load older rides'}</button
				>
			</div>
		{/if}
	{/if}

	{#if device.all.length > 0}
		<h2 class="eyebrow mt-10">on this device only</h2>
		<p class="text-muted mt-1 text-xs">
			Summaries the server did not take — a ride under a minute, or one finished
			while it was unreachable. They can't move to your account.
		</p>
		<ul class="mt-3 grid gap-2 xl:grid-cols-2">
			{#each device.all as ride (ride.id)}
				{@render rideRow(ride)}
			{/each}
		</ul>
		<!-- The only copy there is: a confirm, as errors.md keeps for the
		     genuinely destructive (audit 2026-09-09). -->
		<button onclick={() => void clearDevice()} class="btn btn-danger mt-4"
			>Clear device rides</button
		>
	{/if}

	{#if deleting}
		{@const gone = deleting}
		<DeleteRideDialog
			ride={gone}
			onclose={() => (deleting = null)}
			ondeleted={() => {
				rides = rides?.filter((ride) => ride.id !== gone.id) ?? null;
				deleting = null;
				// The charts count this ride — they have to be asked again.
				void loadProgression();
			}}
		/>
	{/if}
</main>

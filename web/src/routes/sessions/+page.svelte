<script lang="ts">
	import { CalendarClock } from '@lucide/svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import { toLocalInput } from '$lib/components/when';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { toasts } from '$lib/toast.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import { buildShelf } from '$lib/workout/shelf';
	import { durationSeconds } from '$lib/workout/engine';
	import SessionPicker from '$lib/room/SessionPicker.svelte';
	import { parseSharedWorkout } from '$lib/room/workout';

	// The planning surface (#325). Planning used to live inside the room's
	// "Tonight's session" modal as an afterthought under the start button, and
	// moving a session meant finding the room, being in its lounge, and
	// spotting a "move" link. Here every room's plans are one list: what is
	// coming, one form that makes more, and the feed that mirrors it.
	interface Planned {
		id: string;
		workoutName: string;
		workoutJson: string;
		startsAt: string;
		createdBy: string;
		roomSlug: string;
		roomName: string;
		canControl: boolean;
	}
	interface RoomSummary {
		slug: string;
		name: string;
		role?: string;
	}

	void account.load();
	const custom = createCustomStore();
	const profile = createProfileStore();

	let sessions = $state<Planned[] | null>(null);
	let icsToken = $state('');
	let rooms = $state<RoomSummary[]>([]);
	let error = $state<string | null>(null);

	async function load() {
		const [plans, mine] = await Promise.all([
			api<{ sessions: Planned[]; icsToken: string }>('/api/schedule'),
			api<{ rooms: RoomSummary[] }>('/api/rooms'),
		]);
		if (!plans.ok) {
			error = plans.error.message;
			return;
		}
		error = null;
		sessions = plans.data.sessions ?? [];
		icsToken = plans.data.icsToken;
		if (mine.ok) rooms = mine.data.rooms;
	}
	$effect(() => {
		if (account.loaded && account.me) void load();
	});

	// Only rooms the matrix lets you run a session in can take a plan — the
	// form never offers a room the POST would 403 on (ux.md: capability gating).
	const plannable = $derived(
		rooms.filter((room) => room.role === 'owner' || room.role === 'coach'),
	);
	const roomOptions = $derived(
		plannable.map((room) => ({ value: room.slug, label: room.name })),
	);
	const shelf = $derived(buildShelf(custom.all));

	// ── Planning ──────────────────────────────────────────────────────────────
	// The room's picker, opened from here (#359): two bare dropdowns and a
	// time was the only place you could plan a session without seeing the
	// graph, the zones or the cadence bands you were committing a room to.
	let planning = $state(false);
	let busy = $state(false);

	async function plan(
		name: string,
		json: string,
		startsAt: string,
		roomSlug: string,
	) {
		if (!roomSlug) return;
		busy = true;
		const res = await api(`/api/rooms/${roomSlug}/schedule`, {
			method: 'POST',
			json: { workoutName: name, workoutJson: json, startsAt },
		});
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		planning = false;
		toasts.push(`${name} is on the calendar.`);
		await load();
	}

	// ── Moving and cancelling ─────────────────────────────────────────────────
	let movingId = $state<string | null>(null);
	let moveAt = $state('');

	function openMove(entry: Planned) {
		movingId = movingId === entry.id ? null : entry.id;
		moveAt = toLocalInput(new Date(entry.startsAt));
	}

	async function move(entry: Planned) {
		const res = await api(`/api/rooms/${entry.roomSlug}/schedule/${entry.id}`, {
			method: 'PATCH',
			json: { startsAt: new Date(moveAt).toISOString() },
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		movingId = null;
		toasts.push(`${entry.workoutName} moved.`);
		await load();
	}

	// errors.md: undo over confirm. The row carries everything the session was,
	// so putting it back is the same POST that made it.
	async function cancel(entry: Planned) {
		const res = await api(`/api/rooms/${entry.roomSlug}/schedule/${entry.id}`, {
			method: 'DELETE',
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		await load();
		toasts.push(`${entry.workoutName} cancelled.`, {
			undo: () => {
				void api(`/api/rooms/${entry.roomSlug}/schedule`, {
					method: 'POST',
					json: {
						workoutName: entry.workoutName,
						workoutJson: entry.workoutJson,
						startsAt: entry.startsAt,
					},
				}).then(() => load());
			},
		});
	}

	// ── The list ──────────────────────────────────────────────────────────────
	function dayKey(iso: string): string {
		return new Date(iso).toDateString();
	}
	function dayLabel(iso: string): string {
		const when = new Date(iso);
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);
		if (dayKey(iso) === today.toDateString()) return 'Today';
		if (dayKey(iso) === tomorrow.toDateString()) return 'Tomorrow';
		return when.toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'short',
		});
	}
	function clockOf(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
		});
	}
	const days = $derived.by(() => {
		const out: { key: string; label: string; entries: Planned[] }[] = [];
		for (const entry of sessions ?? []) {
			const key = dayKey(entry.startsAt);
			const group = out.at(-1);
			if (group?.key === key) group.entries.push(entry);
			else out.push({ key, label: dayLabel(entry.startsAt), entries: [entry] });
		}
		return out;
	});
	function minutesOf(workoutJson: string): number {
		const { workout } = parseSharedWorkout(workoutJson);
		return workout ? Math.round(durationSeconds(workout) / 60) : 0;
	}

	// ── Subscribe ─────────────────────────────────────────────────────────────
	let showFeed = $state(false);
	const feedUrl = $derived(
		icsToken ? `${location.origin}/api/calendar/${icsToken}.ics` : '',
	);
	function copyFeed() {
		void navigator.clipboard.writeText(feedUrl);
		toasts.push('Calendar link copied — subscribe "from URL" in your app.');
	}
	async function resetFeed() {
		const res = await api<{ icsToken: string }>('/api/calendar/rotate', {
			method: 'POST',
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		icsToken = res.data.icsToken;
		toasts.push('Calendar link reset — the old one stops working.');
	}
</script>

<main class="page max-w-3xl">
	<div class="flex flex-wrap items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Sessions</h1>
			<p class="text-muted text-xs">
				Everything planned across your rooms, in one place.
			</p>
		</div>
		<div class="ml-auto flex items-center gap-2">
			{#if icsToken}
				<button
					onclick={() => (showFeed = !showFeed)}
					class="btn btn-secondary btn-xs"
				>
					<CalendarClock size={14} /> Subscribe
				</button>
			{/if}
			{#if plannable.length > 0}
				<button onclick={() => (planning = true)} class="btn btn-primary btn-xs"
					>Plan a session</button
				>
			{/if}
		</div>
	</div>

	{#if showFeed}
		<!-- One feed for every room (#325). Calendar apps can't sign in, so the
		     URL carries the secret — shown, not just copied, because half of
		     subscribing is pasting it somewhere by hand. -->
		<div class="panel mt-4 px-4 py-3">
			<p class="text-muted text-xs">
				Add this URL in your calendar app ("subscribe from URL"). It follows
				every room you are in — join a room and its sessions appear.
			</p>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<input
					readonly
					value={feedUrl}
					aria-label="Calendar feed URL"
					onfocus={(e) => e.currentTarget.select()}
					class="input input-xs min-w-0 flex-1 font-mono"
				/>
				<button onclick={copyFeed} class="btn btn-secondary btn-xs">Copy</button
				>
				<button onclick={resetFeed} class="btn btn-ghost btn-xs"
					>Reset link</button
				>
			</div>
			<p class="text-muted mt-2 text-[11px]">
				Anyone with the link can read your schedule — reset it if it leaks.
			</p>
		</div>
	{/if}

	{#if error}
		<div class="mt-8">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button
						onclick={() => void load()}
						class="text-muted hover:text-ink text-xs underline">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}

	{#if planning}
		<SessionPicker
			title="Plan a session"
			{shelf}
			ftp={profile.current.ftp}
			rooms={roomOptions}
			{busy}
			onPlan={(name, json, at, slug) => void plan(name, json, at, slug)}
			onClose={() => (planning = false)}
		/>
	{/if}

	<section class="mt-8">
		<h2 class="eyebrow">coming up</h2>
		{#if sessions === null}
			<div class="mt-2 space-y-2">
				<Skeleton class="h-14 w-full" />
				<Skeleton class="h-14 w-full" />
			</div>
		{:else if days.length === 0}
			<div class="mt-2">
				<EmptyState>
					Nothing planned yet. A session is a workout with a time on it — the
					room hears about it, and it lands in everyone's calendar.
					{#snippet cta()}
						{#if plannable.length === 0}
							<a href="/rooms" class="btn btn-secondary btn-xs"
								>Open a room to plan in</a
							>
						{:else}
							<button
								onclick={() => (planning = true)}
								class="btn btn-primary btn-xs">Plan a session</button
							>
						{/if}
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			{#each days as day (day.key)}
				<p class="text-muted mt-5 mb-2 text-xs font-semibold">{day.label}</p>
				<div class="panel">
					{#each day.entries as entry (entry.id)}
						<div
							class="border-ink/5 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0"
						>
							<span class="font-mono text-sm tabular-nums"
								>{clockOf(entry.startsAt)}</span
							>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{entry.workoutName}</p>
								<p class="text-muted text-xs">
									{entry.roomName} · {minutesOf(entry.workoutJson)} min · planned
									by {entry.createdBy}
								</p>
							</div>
							<span class="flex shrink-0 items-center gap-3 text-[11px]">
								{#if entry.canControl}
									<button
										onclick={() => openMove(entry)}
										class="text-muted hover:text-ink underline">move</button
									>
									<button
										onclick={() => void cancel(entry)}
										class="text-muted hover:text-z6 underline">cancel</button
									>
								{/if}
								<a
									href="/r/{entry.roomSlug}"
									class="text-muted hover:text-ink underline">open room</a
								>
							</span>
							{#if movingId === entry.id}
								<div class="flex w-full flex-wrap items-center gap-2 pt-1">
									<WhenPicker bind:value={moveAt} />
									<button
										onclick={() => void move(entry)}
										disabled={!moveAt}
										class="btn btn-secondary btn-xs">Move</button
									>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</section>
</main>

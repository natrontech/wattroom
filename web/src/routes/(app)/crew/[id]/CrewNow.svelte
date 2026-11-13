<script lang="ts">
	import StatusMark from '#lib/status-line/StatusMark.svelte';
	// The crew's Home (ADR-0058, #2451): what is live, what is next and who
	// is around — in that order, because a rider opening the crew wants to
	// know whether to get on the bike. Presence only (ADR-0010's radar): who
	// is in which voice channel, never a number of theirs. Re-read on every
	// lobby ping, which is how a session starting elsewhere reaches it.
	import Banner from '#lib/components/Banner.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import NotifyOffer from '#lib/components/NotifyOffer.svelte';
	import { voiceChannelPath } from '#lib/channels.ts';
	import { joinSessionPath } from '#lib/channel/address.ts';
	import { fetchCrewRecaps, type Crew } from '#lib/crew.ts';
	import {
		answerCrewPlan,
		planCrewSession,
		fetchCrewSchedule,
		type CrewPlan,
		planPath,
	} from '#lib/crew-schedule.ts';
	import { type LiveChannel } from '#lib/crews-live.ts';
	import { crewLive } from '#lib/nav/crew-live.svelte.ts';
	import { formatClock, formatWhen } from '#lib/format.ts';
	import { presence } from '#lib/presence.svelte.ts';
	import { latestRead, pingFollower } from '#lib/stale.ts';
	import type { SessionRecap } from '#lib/protocol.ts';
	import SessionRecapCard from '#lib/session/SessionRecapCard.svelte';
	import {
		rsvpSummary,
		tallyOf,
		whoIsInOf,
		type RsvpAnswer,
	} from '#lib/session/rsvp.ts';
	import { toasts } from '#lib/toast.svelte.ts';
	import { untrack } from 'svelte';
	import { friends, friendsAround } from '#lib/friends/friends.svelte.ts';
	import FriendsAround from '#lib/friends/FriendsAround.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Radio from '@lucide/svelte/icons/radio';
	import { goto } from '$app/navigation';
	import { account } from '#lib/account.svelte.ts';
	import { device } from '#lib/device.svelte.ts';
	import type { ControlRoute, LiveSession } from '#lib/protocol.ts';
	import SessionPicker from '#lib/session/SessionPicker.svelte';
	import {
		startCrewSession,
		startRideTogether,
	} from '#lib/session/crew-session.ts';
	import { customWorkouts } from '#lib/workout/custom.svelte.ts';
	import { buildShelf } from '#lib/workout/shelf.ts';
	import type { Workout } from '#lib/workout/types.ts';

	let { crew }: { crew: Crew } = $props();

	// Who is where is the sidebar's read (#4565): one answer for the app, and
	// the lobby ping already re-reads it. Null until it has landed.
	crewLive.arrive();
	const mine = $derived(crewLive.crew(crew.id));
	const voice = $derived<LiveChannel[] | null>(
		crewLive.loaded
			? (mine?.channels.filter((c) => c.kind === 'voice') ?? [])
			: null,
	);
	// The crew's own sessions (docs/SESSIONS.md), in no voice channel.
	const sessions = $derived<LiveSession[]>(mine?.sessions ?? []);
	let next = $state<CrewPlan | null>(null);
	let latest = $state<SessionRecap | null>(null);
	let error = $state<string | null>(null);
	// The failure is a not_found — no crew of yours any more — so no Retry.
	let gone = $state(false);
	let answering = $state(false);

	async function load(id: string) {
		const [schedule, recaps] = await Promise.all([
			fetchCrewSchedule(id),
			fetchCrewRecaps(id),
		]);
		if (id !== crew.id) return;
		if (schedule.ok) next = schedule.data.sessions[0] ?? null;
		// Oldest first from the server, as the Members page reads them.
		if (recaps.ok) latest = recaps.data.recaps.at(-1) ?? null;
		// The crew's totals are the Members page's.
		const failed = [schedule, recaps].find((res) => !res.ok);
		error =
			failed && !failed.ok ? failed.error.message : (crewLive.error ?? null);
		gone = !!failed && !failed.ok && failed.error.error === 'not_found';
	}
	// By the id, not the row: a ping hands this a new `crew` for the same
	// crew, and each one used to read again beside the ping's own (#4565).
	const crewId = $derived(crew.id);
	const reread = latestRead(() => load(untrack(() => crew.id)));
	$effect(() => {
		crewId;
		void reread();
	});
	const pinged = pingFollower(untrack(() => presence.version));
	$effect(() => {
		if (!pinged(presence.version)) return;
		void reread();
	});

	const live = $derived((voice ?? []).filter((c) => c.session));
	const around = $derived(
		(voice ?? []).filter((c) => !c.session && c.occupants?.length),
	);
	const elsewhere = $derived(friendsAround(friends.list ?? [], crew.id));
	const firstVoice = $derived(voice?.[0]);
	const quiet = $derived(
		voice !== null &&
			live.length === 0 &&
			sessions.length === 0 &&
			around.length === 0 &&
			!next &&
			!latest,
	);

	/** Pressing your own answer again takes it back (the Sessions rule). */
	async function answer(plan: CrewPlan, pressed: RsvpAnswer) {
		answering = true;
		const res = await answerCrewPlan(
			crew.id,
			plan.id,
			plan.yourAnswer === pressed ? null : pressed,
		);
		answering = false;
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await reread();
	}

	// Start a session of the crew's own (docs/SESSIONS.md): the picker's
	// workout, opened on the server, then its page. A phone plans, never starts.
	let picking = $state(false);
	let starting = $state(false);
	const custom = customWorkouts();
	const shelf = $derived(buildShelf(custom.all));
	async function startSession(picked: Workout, route?: ControlRoute) {
		starting = true;
		const res = await startCrewSession(crew.id, picked, route);
		starting = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		picking = false;
		void goto(joinSessionPath(crew.id, res.data.id));
	}

	async function rideTogether() {
		const res = await startRideTogether(crew.id);
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		else void goto(joinSessionPath(crew.id, res.data.id));
	}

	const ANSWERS: [RsvpAnswer, string][] = [
		['in', "I'm in"],
		['out', "I'm out"],
	];
</script>

{#if error}
	<div class="mt-6">
		<Banner tone="error">
			{error}
			{#snippet action()}
				<!-- Permanent (#1677, #2880): a Retry would answer the same. -->
				{#if gone}
					<a href="/home" class="btn-link text-xs">Home</a>
				{:else}
					<button
						onclick={() => (void crewLive.reload(), void load(crew.id))}
						class="btn-link text-xs">Retry</button
					>
				{/if}
			{/snippet}
		</Banner>
	</div>
{/if}

{#if quiet && firstVoice}
	<div class="mt-8">
		<EmptyState>
			Nothing is running. Start the first ride in {firstVoice.name} — everyone in
			the crew can walk in.
			{#snippet cta()}
				<a
					href={voiceChannelPath(crew.id, firstVoice.id)}
					class="btn btn-primary btn-lg">Go to {firstVoice.name}</a
				>
			{/snippet}
		</EmptyState>
	</div>
{/if}

<div class="mt-8 flex items-center gap-3">
	<h2 class="eyebrow">sessions</h2>
	{#if !device.spectator}
		<button
			onclick={() => (picking = true)}
			class="btn btn-secondary btn-xs ml-auto"
			><Radio size={13} /> Start a session</button
		>
		<button onclick={() => void rideTogether()} class="btn btn-secondary btn-xs"
			><Radio size={13} /> Ride together</button
		>
	{/if}
</div>
{#if sessions.length > 0}
	<ul class="mt-2 grid gap-2">
		{#each sessions as session (session.id)}
			<li class="panel flex flex-wrap items-center gap-3">
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{session.workout}</p>
					<p class="text-muted text-xs">
						{session.coachName} coaching · {session.riders.length} riding · {formatClock(
							session.elapsed,
						)}
					</p>
				</div>
				<a
					href={joinSessionPath(crew.id, session.id)}
					class="btn btn-accent btn-lg">Join the ride</a
				>
			</li>
		{/each}
	</ul>
{/if}

{#if picking}
	<SessionPicker
		{shelf}
		shelfError={custom.error}
		onRetryShelf={() => void custom.retry()}
		intent="start"
		ftp={account.me?.ftpWatts ?? 200}
		busy={starting}
		channelName={crew.name}
		onStart={(workout, route) => void startSession(workout, route)}
		onPlan={async (workoutName, workoutJson, startsAt) => {
			const res = await planCrewSession(crew.id, {
				workoutName,
				workoutJson,
				startsAt,
			});
			if (!res.ok) return res.error.message;
			picking = false;
			await load(crew.id);
		}}
		onClose={() => (picking = false)}
	/>
{/if}

{#if live.length > 0}
	<h2 class="eyebrow mt-8">live now</h2>
	<ul class="mt-2 grid gap-2">
		{#each live as channel (channel.id)}
			{#if channel.session}
				{@const session = channel.session}
				<li class="panel flex flex-wrap items-center gap-3">
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{session.workout}</p>
						<p class="text-muted text-xs">
							in {channel.name} · {session.coachName} coaching · {session.riders
								.length} riding · {formatClock(session.elapsed)}
						</p>
					</div>
					<!-- The session's own page, as Home and the start notification
					     go (#1332, #2635): one door, one place it leads. -->
					<a
						href={joinSessionPath(crew.id, session.id)}
						class="btn btn-accent btn-lg">Join the ride</a
					>
				</li>
			{/if}
		{/each}
	</ul>
{/if}

{#if around.length > 0}
	<!-- Standing in a voice channel, which is not being on its call (#2854):
	     "in voice" is LiveKit's word for the call alone (docs/SPEC.md), and
	     the people column says this the same way. -->
	<h2 class="eyebrow mt-8">in the channel</h2>
	<ul class="divide-ink/5 panel panel-flush mt-2 divide-y">
		{#each around as channel (channel.id)}
			<li>
				<a
					href={voiceChannelPath(crew.id, channel.id)}
					class="hover:bg-ink/5 flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm"
				>
					<span class="font-medium">{channel.name}</span>
					<!-- Who is in there now, each with their status (ADR-0060). -->
					<span class="text-muted min-w-0 flex-1 truncate text-xs"
						>{#each channel.occupants ?? [] as o, i (o.id)}{i > 0
								? ', '
								: ''}{o.name}<StatusMark
								line={o.statusLine}
								size={11}
							/>{/each}</span
					>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if elsewhere.length > 0}
	<!-- Your friends outside this crew (#2586): WattRoom opens here now,
	     and Home's row of who is around was the only place they showed.
	     The ones in this crew's voice channels are the list above. -->
	<h2 class="eyebrow mt-8">friends around</h2>
	<div class="mt-2"><FriendsAround list={elsewhere} /></div>
{/if}

<!-- Always drawn, with the way to plan one (#2572): a crew with nothing
     planned showed no heading at all, and planning lived on a page the
     sidebar did not list. The button opens the Schedule's picker. -->
<div class="mt-8 flex items-center gap-3">
	<h2 class="eyebrow">next up</h2>
	<a
		href="/crew/{crew.id}/schedule?plan"
		class="btn btn-secondary btn-xs ml-auto"
		><CalendarClock size={13} /> Plan a session</a
	>
</div>
{#if !next}
	<p class="text-muted mt-2 text-xs">
		Nothing planned. A plan shows up here, on everyone's Home, and in their
		calendar.
	</p>
{:else}
	<div class="panel mt-2">
		<!-- Its own row on the Schedule (#2608): where it is moved, shared and
		     answered alongside the rest of the calendar. -->
		<a
			href={planPath(crew.id, next.id)}
			class="text-sm font-medium hover:underline">{next.workoutName}</a
		>
		<p class="text-muted mt-0.5 text-xs">
			{formatWhen(next.startsAt, true)}{next.channelName
				? ` · in ${next.channelName}`
				: ''} · planned by {next.createdBy}
		</p>
		<!-- Being there is not a role (#450): two fixed words, aria-pressed
		     says which is yours, and pressing yours again takes it back. -->
		<div class="mt-2 flex flex-wrap items-center gap-3">
			{#each ANSWERS as [key, label] (key)}
				<button
					onclick={() => next && void answer(next, key)}
					disabled={answering}
					aria-pressed={next.yourAnswer === key}
					class="btn btn-xs disabled:opacity-40 {next.yourAnswer === key
						? 'btn-primary'
						: 'btn-secondary'}">{label}</button
				>
			{/each}
			<span class="text-muted text-xs"
				>{rsvpSummary(tallyOf(next), whoIsInOf(next))}</span
			>
		</div>
	</div>
	<!-- The crew is where WattRoom opens (#2576), so the first plan a rider
	     sees is usually this one (ADR-0042, #2612). -->
	<NotifyOffer />
{/if}

{#if latest}
	<h2 class="eyebrow mt-8">latest session</h2>
	<div class="mt-2"><SessionRecapCard recap={latest} /></div>
{/if}

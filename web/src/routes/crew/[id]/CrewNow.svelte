<script lang="ts">
	// The crew's Home (ADR-0058, #2451): what is live, what is next and who
	// is around — in that order, because a rider opening the crew wants to
	// know whether to get on the bike. Presence only (ADR-0010's radar): who
	// is in which voice channel, never a number of theirs. Re-read on every
	// lobby ping, which is how a session starting elsewhere reaches it.
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import TogetherTiles from '$lib/components/TogetherTiles.svelte';
	import { voiceChannelPath } from '$lib/channels';
	import { fetchCrewMembers, fetchCrewRecaps, type Crew } from '$lib/crew';
	import {
		answerCrewPlan,
		fetchCrewSchedule,
		type CrewPlan,
	} from '$lib/crew-schedule';
	import { fetchCrewsLive, type LiveChannel } from '$lib/crews-live';
	import { formatClock, formatWhen } from '$lib/format';
	import { presence } from '$lib/presence.svelte';
	import type { SessionRecap } from '$lib/protocol';
	import SessionRecapCard from '$lib/room/SessionRecapCard.svelte';
	import {
		rsvpSummary,
		tallyOf,
		whoIsInOf,
		type RsvpAnswer,
	} from '$lib/room/rsvp';
	import type { Together } from '$lib/room/room-data';
	import { toasts } from '$lib/toast.svelte';
	import { untrack } from 'svelte';

	let { crew }: { crew: Crew } = $props();

	let voice = $state<LiveChannel[] | null>(null);
	let next = $state<CrewPlan | null>(null);
	let latest = $state<SessionRecap | null>(null);
	let together = $state<Together | null>(null);
	let streakWeeks = $state(0);
	let error = $state<string | null>(null);
	let answering = $state(false);

	async function load(id: string) {
		const [live, schedule, recaps, members] = await Promise.all([
			fetchCrewsLive(),
			fetchCrewSchedule(id),
			fetchCrewRecaps(id),
			fetchCrewMembers(id),
		]);
		if (id !== crew.id) return;
		if (live.ok)
			voice =
				live.data.crews
					.find((c) => c.id === id)
					?.channels.filter((c) => c.kind === 'voice') ?? [];
		if (schedule.ok) next = schedule.data.sessions[0] ?? null;
		// Oldest first from the server, as the Members page reads them.
		if (recaps.ok) latest = recaps.data.recaps.at(-1) ?? null;
		if (members.ok) {
			together = members.data.together ?? null;
			streakWeeks = members.data.streakWeeks;
		}
		const failed = [live, schedule, recaps, members].find((res) => !res.ok);
		error = failed && !failed.ok ? failed.error.message : null;
	}
	$effect(() => {
		void load(crew.id);
	});
	let seenVersion = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === seenVersion) return;
		seenVersion = version;
		void load(untrack(() => crew.id));
	});

	const live = $derived((voice ?? []).filter((c) => c.session));
	const around = $derived(
		(voice ?? []).filter((c) => !c.session && c.occupants?.length),
	);
	const firstVoice = $derived(voice?.[0]);
	const quiet = $derived(
		voice !== null &&
			live.length === 0 &&
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
		await load(crew.id);
	}

	const ANSWERS: [RsvpAnswer, string][] = [
		['in', "I'm in"],
		['out', "I'm out"],
	];

	const names = (channel: LiveChannel) =>
		(channel.occupants ?? []).map((o) => o.name).join(', ');
</script>

{#if error}
	<div class="mt-6">
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={() => void load(crew.id)} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	</div>
{/if}

{#if quiet && firstVoice}
	<div class="mt-8">
		<EmptyState>
			Nothing is running and nothing is planned. Start the first ride in {firstVoice.name}
			— everyone in the crew can walk in.
			{#snippet cta()}
				<a
					href={voiceChannelPath(crew.id, firstVoice.id)}
					class="btn btn-primary btn-lg">Go to {firstVoice.name}</a
				>
			{/snippet}
		</EmptyState>
	</div>
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
					<a
						href={voiceChannelPath(crew.id, channel.id)}
						class="btn btn-accent btn-lg">Join the ride</a
					>
				</li>
			{/if}
		{/each}
	</ul>
{/if}

{#if around.length > 0}
	<h2 class="eyebrow mt-8">in voice</h2>
	<ul class="divide-ink/5 panel panel-flush mt-2 divide-y">
		{#each around as channel (channel.id)}
			<li>
				<a
					href={voiceChannelPath(crew.id, channel.id)}
					class="hover:bg-ink/5 flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm"
				>
					<span class="font-medium">{channel.name}</span>
					<span class="text-muted min-w-0 flex-1 truncate text-xs"
						>{names(channel)}</span
					>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if next}
	<h2 class="eyebrow mt-8">next up</h2>
	<div class="panel mt-2">
		<p class="text-sm font-medium">{next.workoutName}</p>
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
{/if}

{#if latest}
	<h2 class="eyebrow mt-8">latest session</h2>
	<div class="mt-2"><SessionRecapCard recap={latest} /></div>
{/if}

{#if together || streakWeeks > 0}
	<div class="mt-8">
		<TogetherTiles {together} {streakWeeks} streakLabel="this crew's streak" />
	</div>
{/if}

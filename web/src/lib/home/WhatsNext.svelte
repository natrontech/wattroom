<script lang="ts">
	// Home's "What's next" (ADR-0020): every planned session in every crew you
	// are in, one row each. That cross-crew list is the whole reason /sessions
	// folded in here — "the second half of what is happening" — and what
	// landed drew the rail feed's `next` instead, one row per ROOM. A room
	// with three plans this week showed one of them, while the same rider's
	// calendar feed, built from the same query, showed all three (#1693).
	//
	// No RSVP here, on purpose (decided 2026-09-17). Saying you are in belongs
	// with the planning, in the crew whose session it is, which is the rest of
	// ADR-0020's line. So the server's row carries no `going` to draw from.
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { planPath } from '$lib/crew-schedule';
	import { formatWhen } from '$lib/format';
	import { presence } from '$lib/presence.svelte';
	import NotifyOffer from '$lib/components/NotifyOffer.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';

	/** One row of GET /api/schedule — a plan, which crew's it is (#2440),
	 *  and the voice channel when it names one. */
	interface Planned {
		id: string;
		workoutName: string;
		minutes: number;
		startsAt: string;
		createdBy: string;
		crewId: string;
		crewName: string;
		channelName?: string;
	}

	// Where a row goes (#2608): the plan's own row on its crew's Schedule,
	// where it is answered. The crew's Home showed only its next plan, so a
	// later one opened from here was nowhere to be found.
	const placeOf = (session: Planned) =>
		session.channelName
			? `${session.crewName} · ${session.channelName}`
			: session.crewName;
	const hrefOf = (session: Planned) => planPath(session.crewId, session.id);

	let {
		planCrew,
	}: {
		/** The crew this rider plans in first, for the empty state's CTA and
		 *  the calendar link — absent in no crew, where a feed is of nothing. */
		planCrew?: string;
	} = $props();

	let sessions = $state<Planned[] | null>(null);
	let error = $state<string | null>(null);
	/** Home is a glance. A rider in six crews can have fifty plans ahead of
	 *  them, and the rest is one press away rather than a page nobody scrolls
	 *  past — the same call `recent` makes for rides above. */
	const GLANCE = 8;
	let all = $state(false);

	async function load() {
		const res = await api<{ sessions: Planned[] }>('/api/schedule');
		if (!res.ok) {
			// A failed read is not an empty calendar (errors.md): whatever list
			// this had stays on screen, and the line says what happened.
			error = res.error.message;
			return;
		}
		error = null;
		sessions = res.data.sessions;
	}

	$effect(() => {
		if (!account.me) return;
		// The lobby ping (#570): planning, moving and cancelling each ping
		// every socket, and those three are exactly what this list shows. The
		// rail feed could not stand in for it — it carried each room's next
		// plan and nothing behind it, which is the bug this section fixed.
		presence.version;
		void load();
	});

	const shown = $derived(
		all ? (sessions ?? []) : (sessions ?? []).slice(0, GLANCE),
	);
	const hidden = $derived((sessions?.length ?? 0) - shown.length);
</script>

<section id="sessions">
	<h2 class="eyebrow">What's next</h2>

	{#if error}
		<p class="text-muted mt-3 text-sm">
			{error}
			<button onclick={() => void load()} class="btn-link ml-1">Retry</button>
		</p>
	{/if}

	{#if sessions === null}
		{#if !error}
			<div class="panel panel-flush mt-3">
				{#each { length: 2 } as _, i (i)}
					<div class="border-ink/5 border-b px-4 py-3 last:border-b-0">
						<Skeleton class="h-4 w-44" />
						<Skeleton class="mt-1.5 h-3 w-32" />
					</div>
				{/each}
			</div>
		{/if}
	{:else if shown.length}
		<ul class="panel panel-flush mt-3" data-testid="whats-next">
			{#each shown as session (session.id)}
				<li>
					<!-- The row a rider reads from the sofa: what, then when and
					     whose crew, then how long and who called it. The date is
					     in it because this is the one list that spans crews AND
					     weeks, where "Tue 19:00" cannot tell next week's from
					     tomorrow's. Nothing is truncated but the name, so a long
					     crew name wraps down the page instead of across it
					     (ux.md's phone standard). -->
					<a
						href={hrefOf(session)}
						class="border-ink/5 hover:bg-surface flex items-center gap-3 border-b px-4 py-3 transition-colors"
					>
						<CalendarClock size={15} class="text-muted shrink-0" />
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{session.workoutName}</p>
							<p class="text-muted mt-0.5 text-xs">
								{formatWhen(session.startsAt, true)} · {placeOf(session)}
							</p>
							<p class="text-muted-dim text-[11px]">
								{session.minutes} min · planned by {session.createdBy}
							</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
		{#if hidden > 0 || all}
			<button onclick={() => (all = !all)} class="btn-link mt-2 text-xs">
				{all ? 'Show the next few' : `Show all ${sessions.length} sessions`}
			</button>
		{/if}
		<!-- Notifications, offered where they would matter (#1485): the rider
		     can see a session is coming, so this is the moment to say the app
		     can tell them when it starts. Once, and only where the button can
		     succeed — NotifyOffer decides. -->
		<NotifyOffer />
	{:else if !error}
		<p class="text-muted mt-3 text-sm">
			Nothing on the calendar.
			{#if planCrew}
				<!-- The CTA that creates the first one (ux.md), not a word in italics (#1911). -->
				<a href="/crew/{planCrew}/schedule?plan" class="btn-link">Plan one</a> — it
				shows up here, and in everyone's calendar.
			{:else}
				Start or join a crew and plan one on its <em>Schedule</em> — it shows up here,
				and in everyone's calendar.
			{/if}
		</p>
	{/if}

	<!-- The feed is offered under the list it mirrors (ADR-0021 amended, #1374)
	     — once there is a crew to plan in; a subscription to nothing is noise on
	     the screen meant to teach. The link itself lives with the account's
	     other bearer secrets now (#1860), so this is the way to it rather than a
	     second copy of it. -->
	{#if planCrew}
		<a
			href="/settings/data"
			class="panel hover:bg-surface mt-3 flex flex-wrap items-center gap-3 transition-colors"
		>
			<CalendarClock size={15} class="text-muted shrink-0" />
			<span class="text-muted min-w-0 flex-1 text-xs">
				Put all of this in your calendar app — one subscription, every crew you
				are in.
			</span>
			<span class="btn-link shrink-0 text-xs">Get your calendar link</span>
		</a>
	{/if}
</section>

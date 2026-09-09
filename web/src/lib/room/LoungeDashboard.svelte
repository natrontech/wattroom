<script lang="ts">
	// The room's dashboard, when nothing is running: what this room is
	// adding up to and the three things you do to it. It lives on the
	// Lounge rather than a sixth place — Discord's server home IS its first
	// channel. Its own component (size, code-quality.md): the Lounge page is
	// the tiles and the stage; this is the part that only exists between
	// sessions.
	import { account } from '$lib/account.svelte';
	import { copyInviteLink } from '$lib/crew-flows';
	import { formatWhen } from '$lib/format';
	import { useRoom } from '$lib/room/context';
	import SessionControls from '$lib/room/SessionControls.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Link from '@lucide/svelte/icons/link';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	const room = useRoom();

	// Describe, never grade (RESEARCH.md §14.8): the crew against its own last
	// month, in words, with no arrow that reads as a verdict on a quiet month.
	const monthOnMonth = $derived.by(() => {
		const now = room.together?.sessionsThisMonth ?? 0;
		const then = room.together?.sessionsLastMonth ?? 0;
		if (!then) return 'the first month here';
		if (now > then) return `up from ${then}`;
		if (now < then) return `${then} last month`;
		return 'same as last month';
	});
</script>

<section class="mt-6">
	<!-- Consistency leads and nothing here orders anybody (#995,
	     RESEARCH.md §14.4/§14.7): three whole-room sums and the
	     viewer's own turnout. The riders count moved to the roster it
	     duplicates and the medals count to the members page, which is
	     where a medal's owner is legible anyway. -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="panel px-4 py-3">
			<p class="eyebrow">together</p>
			<p class="font-display text-2xl font-bold tabular-nums">
				{Math.round((room.together?.seconds ?? 0) / 3600).toLocaleString()}<span
					class="text-muted ml-1 text-sm">h</span
				>
			</p>
			<p class="text-muted text-[11px]">ridden together</p>
		</div>
		<div class="panel px-4 py-3">
			<p class="eyebrow">streak</p>
			<p class="font-display text-2xl font-bold tabular-nums">
				{room.streakWeeks}<span class="text-muted ml-1 text-sm"
					>wk{room.streakWeeks === 1 ? '' : 's'}</span
				>
			</p>
			<p class="text-muted text-[11px]">a session every week</p>
		</div>
		<div class="panel px-4 py-3">
			<p class="eyebrow">this month</p>
			<p class="font-display text-2xl font-bold tabular-nums">
				{room.together?.sessionsThisMonth ?? 0}<span
					class="text-muted ml-1 text-sm"
					>session{(room.together?.sessionsThisMonth ?? 0) === 1
						? ''
						: 's'}</span
				>
			</p>
			<p class="text-muted text-[11px]">
				{monthOnMonth} · {Math.round(room.monthKj).toLocaleString()} kJ
			</p>
		</div>
		<div class="panel px-4 py-3">
			<p class="eyebrow">showed up</p>
			{#if room.together?.attended.length}
				<div class="mt-1.5 flex flex-wrap items-center gap-1">
					{#each room.together.attended as here, i (i)}
						<!-- A dim fill, not a thin ring: a 10 px outline disappears at
						     the arm's length this screen is read from (ux.md). -->
						<span
							class="size-2.5 rounded-full {here ? 'bg-neon' : 'bg-muted/30'}"
						></span>
					{/each}
				</div>
				<p class="text-muted mt-2 text-[11px]">
					you, last {room.together.attended.length} session{room.together
						.attended.length === 1
						? ''
						: 's'}
				</p>
			{:else}
				<p class="font-display text-2xl font-bold tabular-nums">—</p>
				<p class="text-muted text-[11px]">after the first ride here</p>
			{/if}
		</div>
	</div>

	{#if room.board.length}
		<!-- The board (ADR-0036): below the tiles, this week only, and only
		     because someone turned it on. Category sits beside each name
		     because it says who is comparable — the useful half of a rank
		     without the ordering doing the talking. -->
		<div class="panel mt-3 px-4 py-3">
			<div class="flex items-baseline justify-between gap-3">
				<p class="eyebrow">this week</p>
				<p class="text-muted text-[11px]">resets Monday</p>
			</div>
			<ol class="mt-2.5 space-y-1">
				{#each room.board as row, i (row.id)}
					{@const you = row.id === account.me?.id}
					<li
						class="flex items-baseline gap-3 rounded px-2 py-1.5 text-sm {you
							? 'bg-surface-raised'
							: ''}"
					>
						<span class="text-muted w-4 shrink-0 font-mono text-xs tabular-nums"
							>{i + 1}</span
						>
						<span class="min-w-0 flex-1 truncate">{row.displayName}</span>
						<span
							class="border-muted/30 text-muted shrink-0 rounded border px-1.5 text-[10px]"
							title="category — who you are comparable with"
							>{row.category}</span
						>
						<span class="shrink-0 font-mono text-xs tabular-nums"
							>{row.kj.toLocaleString()}<span class="text-muted ml-0.5">kJ</span
							></span
						>
					</li>
				{/each}
			</ol>
		</div>
	{/if}

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<!-- The room's home holds its action (#1332, ADR-0020 amended): a
		     coach starts the session here, with the controls Training has,
		     drawn once; a rider joins one that is running — on Training,
		     where the numbers are. -->
		<SessionControls />
		{#if room.upcoming[0]}
			{@const next = room.upcoming[0]}
			<a
				href="/r/{room.slug}/sessions"
				class="panel hover:border-muted/40 flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5"
			>
				<CalendarClock size={15} class="text-muted shrink-0" />
				<span class="min-w-0">
					<span class="eyebrow">next session</span>
					<span class="block truncate text-sm font-medium"
						>{next.workoutName}</span
					>
					<span class="text-muted block text-[11px]"
						>{formatWhen(next.startsAt, true)} · planned by {next.createdBy}</span
					>
				</span>
			</a>
		{:else if room.canControl}
			<!-- Planning has one home, Sessions (#1332): this points there
			     instead of opening the picker a second time. -->
			<a href="/r/{room.slug}/sessions" class="btn btn-secondary"
				><CalendarClock size={14} /> Plan a session</a
			>
		{/if}
		<!-- The invite is the crew's (#1236): one click copies its link.
		     Without the code — never for a member, but the row must not
		     render a button that fails — the Members place says how. -->
		{#if room.code}
			<button onclick={() => copyInviteLink(room.code)} class="btn btn-ghost"
				><Link size={14} /> Copy invite link</button
			>
		{:else}
			<a href="/r/{room.slug}/members" class="btn btn-ghost"
				><UserPlus size={14} /> Invite</a
			>
		{/if}
	</div>
</section>

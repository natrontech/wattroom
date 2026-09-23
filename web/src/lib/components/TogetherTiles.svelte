<script lang="ts">
	// What a group adds up to (#995, RESEARCH.md §14.4/§14.7): time ridden
	// together, its streak, its sessions against its own last month, and the
	// viewer's own turnout — the crew's Members page and, until the room goes
	// (#2460), a room's Lounge. Sums and your own dots; nobody is ordered here.
	import type { Together } from '$lib/crew-types';

	let {
		together,
		streakWeeks,
		streakLabel,
		monthKj,
	}: {
		together?: Together | null;
		streakWeeks: number;
		streakLabel: string;
		/** The room's month in kJ; the crew's read does not carry one. */
		monthKj?: number;
	} = $props();

	// Describe, never grade (RESEARCH.md §14.8): the crew against its own last
	// month, in words, with no arrow that reads as a verdict on a quiet month.
	const monthOnMonth = $derived.by(() => {
		const now = together?.sessionsThisMonth ?? 0;
		const then = together?.sessionsLastMonth ?? 0;
		if (!then) return 'the first month here';
		if (now > then) return `up from ${then}`;
		if (now < then) return `${then} last month`;
		return 'same as last month';
	});
</script>

<!-- Consistency leads and nothing here orders anybody (#995,
	     RESEARCH.md §14.4/§14.7): three whole-group sums and the
	     viewer's own turnout. The riders count moved to the roster it
	     duplicates and the medals count to the members page, which is
	     where a medal's owner is legible anyway. -->
<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
	<div class="panel">
		<p class="eyebrow">together</p>
		<p class="font-display text-2xl font-bold tabular-nums">
			{Math.round((together?.seconds ?? 0) / 3600).toLocaleString()}<span
				class="text-muted ml-1 text-sm">h</span
			>
		</p>
		<p class="text-muted text-[11px]">ridden together</p>
	</div>
	<div class="panel">
		<p class="eyebrow">{streakLabel}</p>
		<p class="font-display text-2xl font-bold tabular-nums">
			{streakWeeks}<span class="text-muted ml-1 text-sm"
				>wk{streakWeeks === 1 ? '' : 's'}</span
			>
		</p>
		<p class="text-muted text-[11px]">a session every week</p>
	</div>
	<div class="panel">
		<p class="eyebrow">this month</p>
		<p class="font-display text-2xl font-bold tabular-nums">
			{together?.sessionsThisMonth ?? 0}<span class="text-muted ml-1 text-sm"
				>session{(together?.sessionsThisMonth ?? 0) === 1 ? '' : 's'}</span
			>
		</p>
		<p class="text-muted text-[11px]">
			{monthOnMonth}{#if monthKj !== undefined}
				· {Math.round(monthKj).toLocaleString()} kJ{/if}
		</p>
	</div>
	<div class="panel">
		<p class="eyebrow">showed up</p>
		{#if together?.attended.length}
			<div class="mt-1.5 flex flex-wrap items-center gap-1">
				{#each together.attended as here, i (i)}
					<!-- A dim fill, not a thin ring: a 10 px outline disappears at
						     the arm's length this screen is read from (ux.md). -->
					<span class="size-2.5 rounded-full {here ? 'bg-neon' : 'bg-muted/30'}"
					></span>
				{/each}
			</div>
			<p class="text-muted mt-2 text-[11px]">
				you, last {together.attended.length} session{together.attended
					.length === 1
					? ''
					: 's'}
			</p>
		{:else}
			<p class="font-display text-2xl font-bold tabular-nums">—</p>
			<p class="text-muted text-[11px]">after the first ride here</p>
		{/if}
	</div>
</div>

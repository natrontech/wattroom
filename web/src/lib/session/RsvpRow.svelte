<script lang="ts">
	// Being there is not a role (#450): two words, no maybe, and aria-pressed
	// says which is yours; beside them, SPEC's tally. The crew's Schedule and a
	// voice channel's plan card (#2606) draw the same row.
	// Under it, the names the line leaves out — for the plan's organiser, who
	// is out and who has not answered (#2797).
	import {
		rosterOf,
		rsvpSummary,
		tallyOf,
		whoIsInOf,
		type PlanAnswers,
		type RsvpAnswer,
	} from '$lib/session/rsvp';

	let {
		plan,
		onChoose,
	}: { plan: PlanAnswers; onChoose: (word: RsvpAnswer) => void } = $props();
	const roster = $derived(rosterOf(plan));
</script>

<div class="flex flex-wrap items-center gap-3">
	{#each ['in', 'out'] as const as word (word)}
		<button
			onclick={() => onChoose(word)}
			aria-pressed={plan.yourAnswer === word}
			class="btn btn-xs {plan.yourAnswer === word
				? 'btn-primary'
				: 'btn-secondary'}">{word === 'in' ? "I'm in" : "I'm out"}</button
		>
	{/each}
	<span class="text-muted text-xs"
		>{rsvpSummary(tallyOf(plan), whoIsInOf(plan))}</span
	>
</div>
{#if roster.length}
	<details class="mt-1">
		<summary
			class="text-muted hover:text-ink inline-flex min-h-6 cursor-pointer items-center text-xs"
			>Show names</summary
		>
		<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			{#each roster as group (group.word)}
				<dt class="text-muted">{group.word}</dt>
				<dd>{group.names}</dd>
			{/each}
		</dl>
	</details>
{/if}

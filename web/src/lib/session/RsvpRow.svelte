<script lang="ts">
	// Being there is not a role (#450): two words, no maybe, and aria-pressed
	// says which is yours; beside them, SPEC's tally. The crew's Schedule and a
	// voice channel's plan card (#2606) draw the same row.
	import {
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

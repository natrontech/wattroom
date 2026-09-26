<script lang="ts">
	import { REPO } from './seo';

	// Every page ends on the way in (#2995): the empty-state rule, for a page.
	let {
		title = 'Your crew is one link away.',
		line = 'Start a crew, send its six-character code, and ride your first workout together tonight. Free, no install.',
		start = 'Start your crew',
		source = 'Read the source',
	}: {
		title?: string;
		line?: string;
		start?: string;
		source?: string;
	} = $props();
</script>

<section class="mx-auto mt-24 w-full max-w-4xl px-4 sm:px-6">
	<div
		class="shell-card bg-surface-raised/60 relative overflow-hidden px-6 py-12 text-center backdrop-blur sm:px-12"
	>
		<div
			class="bg-gridlines pointer-events-none absolute inset-0 opacity-30"
			aria-hidden="true"
		></div>
		<h2
			class="font-display relative text-3xl font-bold tracking-tight uppercase sm:text-4xl"
		>
			{title}
		</h2>
		<p class="text-muted relative mx-auto mt-3 max-w-xl text-balance">{line}</p>
		<div class="relative mt-7 flex flex-wrap justify-center gap-3">
			<a href="/login" class="btn btn-primary btn-lg">{start}</a>
			<a href={REPO} class="btn btn-secondary btn-lg">{source}</a>
		</div>
	</div>
</section>

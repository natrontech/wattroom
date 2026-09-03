<script lang="ts">
	import { changelog } from '$lib/changelog.svelte';
	import { highlights, inlineParts } from '$lib/changelog';
	import type { ReleaseAction } from '$lib/release-actions';

	// The what's-new notice (#345, #631). Home only — ux.md: a changelog is
	// never worth interrupting an interval for. It counted entries once; a
	// count is not news, so it now says what changed and, when the release
	// shipped something tryable, offers it in one tap.
	const LINES = 3;

	const release = $derived(changelog.unseen);
	const news = $derived(release ? highlights(release, LINES) : null);
	const missed = $derived(changelog.skipped.length);
	const tail = $derived(
		[
			news && news.more > 0 ? `${news.more} more in this release` : '',
			missed > 0
				? `${missed} earlier release${missed === 1 ? '' : 's'} landed while you were away`
				: '',
		]
			.filter(Boolean)
			.join(' · '),
	);

	// A tapped action stays put, disabled, saying what it did. Letting it
	// vanish under the finger reads as a misfire.
	let done = $state(new Set<string>());

	function apply(action: ReleaseAction) {
		action.run();
		done = new Set(done).add(action.id);
	}
</script>

{#if release && news}
	<section class="panel px-5 py-4">
		<div class="flex flex-wrap items-baseline gap-x-3">
			<p class="eyebrow">what's new</p>
			<p class="font-display text-sm font-bold">{release.version}</p>
			<p class="text-muted text-xs">is running</p>
		</div>

		<!-- Unkeyed on purpose, like /whats-new: these are render-only lists
		     whose text repeats across releases. -->
		<ul class="mt-3 space-y-2">
			{#each news.lines as line}
				<li class="flex gap-3 text-sm leading-relaxed">
					<span class="eyebrow mt-1.5 w-12 shrink-0">{line.heading}</span>
					<span class="flex-1">
						{#each inlineParts(line.text) as part}
							{#if part.code}<code class="bg-z1/60 rounded px-1 py-0.5 text-xs"
									>{part.text}</code
								>{:else}{part.text}{/if}
						{/each}
					</span>
				</li>
			{/each}
		</ul>

		{#if changelog.actions.length}
			<div class="border-muted/15 mt-4 space-y-3 border-t pt-4">
				{#each changelog.actions as action (action.id)}
					<div class="flex flex-wrap items-center gap-3">
						<p class="text-muted min-w-48 flex-1 text-sm">{action.note}</p>
						<button
							class="btn btn-secondary"
							disabled={done.has(action.id)}
							onclick={() => apply(action)}
						>
							{done.has(action.id) ? action.done() : action.label()}
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
			<a href="/whats-new" class="btn btn-secondary btn-xs"
				>See everything that changed</a
			>
			{#if tail}<p class="text-muted text-xs">{tail}.</p>{/if}
			<button
				onclick={() => changelog.dismiss()}
				class="text-muted hover:text-ink ml-auto text-xs underline"
				>Dismiss</button
			>
		</div>
	</section>
{/if}

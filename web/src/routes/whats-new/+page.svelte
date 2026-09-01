<script lang="ts">
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { changelog } from '$lib/changelog.svelte';
	import { inlineParts } from '$lib/changelog';

	// What's new (#345): the changelog the running build shipped with. Reading
	// it acknowledges the current version, so the home notice stops nagging.
	void changelog.load().then(() => changelog.dismiss());
</script>

<svelte:head><title>What's new · WattRoom</title></svelte:head>

<main class="page max-w-3xl">
	<div class="flex flex-wrap items-center gap-3">
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">What's new</h1>
			<p class="text-muted text-xs">
				{#if changelog.version}
					You are running {changelog.version}.
				{:else}
					A development build — the list below is the last released version.
				{/if}
			</p>
		</div>
	</div>

	{#if changelog.failed}
		<div class="mt-8">
			<Banner tone="warn">
				The changelog could not be loaded. It ships with the app, so this
				usually means the page is stale — reload and try again.
			</Banner>
		</div>
	{:else if changelog.releases === null}
		<div class="mt-8 space-y-3"><Skeleton /><Skeleton /><Skeleton /></div>
	{:else if changelog.releases.length === 0}
		<div class="mt-8">
			<EmptyState>
				This build predates the first tagged release, so there is nothing to
				compare it against yet.
			</EmptyState>
		</div>
	{:else}
		<div class="mt-8 space-y-8">
			{#each changelog.releases as release (release.version)}
				<section class="panel px-5 py-4">
					<div class="flex flex-wrap items-baseline gap-x-3">
						<h2 class="font-display text-lg font-bold">{release.version}</h2>
						<span class="eyebrow">{release.date}</span>
						{#if release.version === changelog.version}
							<span class="eyebrow text-neon">running now</span>
						{/if}
					</div>
					<!-- Unkeyed on purpose: these are render-only lists whose content repeats.
					     Keying by text crashed the page when one entry used `deploy/`
					     twice in one line (each_key_duplicate). -->
					{#each release.sections as section}
						<h3 class="eyebrow mt-4">{section.heading}</h3>
						<ul class="mt-2 space-y-2">
							{#each section.items as item}
								<li class="text-sm leading-relaxed">
									{#each inlineParts(item) as part}
										{#if part.code}<code
												class="bg-z1/60 rounded px-1 py-0.5 text-xs"
												>{part.text}</code
											>{:else}{part.text}{/if}
									{/each}
								</li>
							{/each}
						</ul>
					{/each}
				</section>
			{/each}
		</div>
	{/if}
</main>

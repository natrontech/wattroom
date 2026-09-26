<script lang="ts">
	// The opt-in public crew directory (ADR-0039 as amended by ADR-0058,
	// #2456).
	//
	// It shows a crew's name, its mark, and the way in — its door. Nothing
	// else: no member count, no activity, no owner. Finding a crew is not
	// reading it, and this page is the only surface in WattRoom a rider
	// reaches about crews they are not in, so what it discloses is the
	// decision.
	import Compass from '@lucide/svelte/icons/compass';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import { api } from '$lib/api';

	interface Entry {
		code: string;
		name: string;
		icon?: string;
		imageUrl?: string;
	}

	let crews = $state<Entry[] | null>(null);
	let error = $state<string | null>(null);
	// The server pages at fifty (crew_directory.go); the next page is asked
	// for, or crews past the 50th are unreachable (audit 2026-09-09).
	const PAGE = 50;
	let more = $state(false);
	// A failed page read is said beside the button, not over the fifty crews
	// already on screen (audit 2026-09-09).
	let moreError = $state<string | null>(null);

	async function load(offset = 0) {
		if (offset) moreError = null;
		else error = null;
		const res = await api<{ crews: Entry[] }>(
			`/api/crews/directory${offset ? `?offset=${offset}` : ''}`,
		);
		if (!res.ok) {
			if (offset) moreError = res.error.message;
			else error = res.error.message;
			return;
		}
		// A crew listed between two pages shifts the offset (#1690): the keyed
		// list threw on the row that came back twice.
		const seen = new Set((offset ? (crews ?? []) : []).map((c) => c.code));
		crews = offset
			? [...(crews ?? []), ...res.data.crews.filter((c) => !seen.has(c.code))]
			: res.data.crews;
		more = res.data.crews.length === PAGE;
	}

	$effect(() => {
		void load();
	});
</script>

<svelte:head><title>Find a crew · WattRoom</title></svelte:head>

<main class="page">
	<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="page-title">Find a crew</h1>
		<p class="text-muted text-xs">
			Crews that chose to be findable. Every other crew takes its invite.
		</p>
	</header>

	{#if error}
		<!-- Never a blank page on failure, and the retry is the affordance
		     (errors.md) rather than a sentence telling somebody to reload. -->
		<div class="mt-6">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if crews === null}
		<ul class="mt-6 space-y-2">
			{#each { length: 4 } as _, i (i)}
				<li class="border-muted/15 rounded-lg border p-4"><Skeleton /></li>
			{/each}
		</ul>
	{:else if crews.length === 0}
		<div class="mt-6">
			<EmptyState>
				{#snippet icon()}<Compass
						size={22}
						class="text-muted-dim mb-2"
					/>{/snippet}
				<p class="text-sm">
					No crew has listed itself yet. A crew is invite-only until its admins
					choose otherwise, which is the default and stays the default.
				</p>
				{#snippet cta()}
					<a href="/home#crews" class="btn btn-secondary"
						>Join a crew with a code</a
					>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<ul class="mt-6 space-y-2">
			{#each crews as crew (crew.code)}
				<li>
					<!-- The door, not the crew: whoever follows it meets the join
					     and the board disclosure every invite meets. -->
					<a
						href="/c/{crew.code}"
						class="border-muted/15 hover:border-muted/40 flex items-center gap-3 rounded-lg border px-4 py-3"
					>
						<CrewMark
							name={crew.name}
							icon={crew.icon}
							imageUrl={crew.imageUrl}
							size={24}
						/>
						<span class="min-w-0 truncate text-sm font-medium">{crew.name}</span
						>
					</a>
				</li>
			{/each}
		</ul>
		{#if moreError}
			<div class="mt-3">
				<Banner tone="error">
					{moreError}
					{#snippet action()}
						<button
							onclick={() => void load(crews?.length ?? 0)}
							class="btn-link text-xs">Retry</button
						>
					{/snippet}
				</Banner>
			</div>
		{/if}
		{#if more}
			<button
				onclick={() => void load(crews?.length ?? 0)}
				class="btn btn-secondary btn-xs mt-3">Show more</button
			>
		{/if}
	{/if}
</main>

<script lang="ts">
	// The riders you hid (#3202), and the way back for each. Hiding happens
	// from a rider — their card or their menu — so this list is the one place
	// the whole of it is seen, and the undo that outlives the toast.
	import Avatar from '$lib/components/Avatar.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { hiddenRiders } from '$lib/hidden-riders.svelte';

	void hiddenRiders.load();
</script>

<section class="panel panel-xl mt-8" data-testid="hidden-riders">
	<h2 class="font-display font-bold">Hidden riders</h2>
	<p class="text-muted mt-1 text-xs">
		A hidden rider cannot message you, ask to be your friend, or reach you with
		cheers, pokes or reactions — and neither can you them. They are not told. In
		a crew you share you still ride together; an admin can remove a member.
	</p>
	{#if hiddenRiders.error}
		<div class="mt-4">
			<Banner tone="error">
				{hiddenRiders.error}
				{#snippet action()}
					<button
						onclick={() => void hiddenRiders.load()}
						class="btn-link text-xs">Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if hiddenRiders.list === null}
		<p class="text-muted mt-4 text-xs">Loading…</p>
	{:else if hiddenRiders.list.length === 0}
		<p class="text-muted mt-4 text-xs">
			Nobody is hidden. Hide a rider from their card or their menu — right-click
			them, or long-press.
		</p>
	{:else}
		<ul class="mt-4 grid gap-2">
			{#each hiddenRiders.list as rider (rider.id)}
				<li class="flex items-center gap-3 text-sm">
					<Avatar name={rider.name} avatarUrl={rider.avatarUrl} size={28} />
					<span class="min-w-0 truncate font-semibold">{rider.name}</span>
					<span class="text-muted text-xs">
						hidden {new Date(rider.since).toLocaleDateString()}
					</span>
					<button
						onclick={() => void hiddenRiders.show(rider.id, rider.name)}
						class="btn btn-secondary btn-xs ml-auto">Show again</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

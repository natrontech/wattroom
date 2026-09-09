<script lang="ts">
	// Read-only API tokens for a rider's own tools (ADR-0017).
	//
	// Its own file because it is its own thing: four pieces of state and three
	// requests that nothing else on the profile page touches, and the secret
	// exists client-side only in `fresh`, until the rider hides it. The page
	// was 758 lines and this was the largest section that owed it nothing
	// (#686 — long, not tangled).
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { untrack } from 'svelte';
	import type { ApiToken } from '../../routes/settings/data/+page';

	let {
		initial,
		initialError = null,
	}: { initial: ApiToken[]; initialError?: string | null } = $props();

	// A seed, not a binding: the list is ours to own once mounted, which
	// is what `untrack` says out loud (the page used the same idiom).
	let tokens = $state<ApiToken[]>(untrack(() => initial));
	let name = $state('');
	let fresh = $state<string | null>(null);
	let error = $state<string | null>(null);
	// The list failed to load (#1330's audit): said above the form, with the
	// retry, rather than rendered as an empty list.
	let loadError = $state<string | null>(untrack(() => initialError));

	async function load() {
		const res = await api<{ tokens: ApiToken[] }>('/api/tokens');
		if (res.ok) {
			tokens = res.data?.tokens ?? [];
			loadError = null;
		} else loadError = res.error.message;
	}

	async function create() {
		const res = await api<ApiToken & { token: string }>('/api/tokens', {
			method: 'POST',
			json: { name: name.trim() },
		});
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		name = '';
		fresh = res.data.token;
		await load();
	}

	async function revoke(id: string) {
		const res = await api<undefined>(`/api/tokens/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		tokens = tokens.filter((entry) => entry.id !== id);
	}
</script>

<section class="border-muted/15 mt-3 rounded-lg border p-6">
	<h2 class="font-display font-bold">Coach access</h2>
	<p class="text-muted mt-1 text-xs">
		Read-only tokens for your own tools — a personal coach AI can read your
		progression and rides over the API or MCP (<code
			class="font-mono text-[11px]">{location.origin}/mcp</code
		>). Your data only, never anyone else's.
	</p>
	{#if fresh}
		<div class="border-muted/30 mt-4 rounded-lg border border-dashed p-4">
			<p class="text-xs font-semibold">
				Copy it now — it is never shown again.
			</p>
			<code class="mt-2 block font-mono text-xs break-all select-all"
				>{fresh}</code
			>
			<p class="text-muted mt-3 text-[11px]">Hook it up to Claude Code:</p>
			<code class="mt-1 block font-mono text-[11px] break-all select-all"
				>claude mcp add --transport http wattroom {location.origin}/mcp --header
				"Authorization: Bearer {fresh}"</code
			>
			<button onclick={() => (fresh = null)} class="btn-link mt-3 text-xs"
				>Done, hide it</button
			>
		</div>
	{/if}
	{#if loadError}
		<div class="mt-4">
			<Banner tone="error">
				{loadError}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}
	{#if tokens.length > 0}
		<ul class="mt-4 grid gap-2">
			{#each tokens as entry (entry.id)}
				<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
					<span class="text-ink font-semibold">{entry.name}</span>
					<span class="text-muted">
						created {new Date(entry.createdAt).toLocaleDateString()}
						{entry.lastUsedAt
							? `· last used ${new Date(entry.lastUsedAt).toLocaleDateString()}`
							: '· never used'}
					</span>
					<button onclick={() => void revoke(entry.id)} class="btn-link ml-auto"
						>Revoke</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	<form
		class="mt-4 flex flex-wrap gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void create();
		}}
	>
		<input
			bind:value={name}
			maxlength="60"
			placeholder="Token name — e.g. claude coach"
			class="input w-64"
		/>
		<button class="btn btn-secondary" disabled={!name.trim()}
			>Create token</button
		>
	</form>
	{#if error}
		<p class="text-muted mt-2 text-xs">{error}</p>
	{/if}
</section>

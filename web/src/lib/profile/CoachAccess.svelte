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
	import Copy from '@lucide/svelte/icons/copy';
	import { confirm } from '$lib/confirm.svelte';
	import { toasts } from '$lib/toast.svelte';
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

	// A confirm, not an undo (errors.md): the row is deleted and the secret
	// cannot be reissued, and whatever the rider connected with it stops
	// working — one click used to do that in silence (#1759).
	async function revoke(entry: ApiToken) {
		const sure = await confirm({
			title: `Revoke “${entry.name}”?`,
			body: 'Whatever you connected with it stops working, and the token cannot be shown again — you would create a new one.',
			action: 'Revoke',
			cancel: 'Keep it',
		});
		if (!sure) return;
		const res = await api<undefined>(`/api/tokens/${entry.id}`, {
			method: 'DELETE',
		});
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		tokens = tokens.filter((t) => t.id !== entry.id);
		toasts.push(`Revoked “${entry.name}”.`);
	}

	// "Copy it now" with nothing to press was a long-press-and-drag on a phone
	// against a 68-character string, and getting it wrong cost the token.
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toasts.push('Copied.');
		} catch {
			toasts.push('Could not copy — select the text and copy it yourself.', {
				tone: 'error',
				seconds: 8,
			});
		}
	}
	const mcpAdd = $derived(
		fresh
			? `claude mcp add --transport http wattroom ${location.origin}/mcp --header "Authorization: Bearer ${fresh}"`
			: '',
	);
</script>

<section class="panel mt-8 p-6">
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
			<div class="mt-2 flex items-start gap-2">
				<code class="min-w-0 flex-1 font-mono text-xs break-all select-all"
					>{fresh}</code
				>
				<button
					onclick={() => void copy(fresh ?? '')}
					class="btn btn-secondary btn-xs shrink-0"
					aria-label="copy the token"><Copy size={12} /> Copy</button
				>
			</div>
			<p class="text-muted mt-3 text-[11px]">Hook it up to Claude Code:</p>
			<div class="mt-1 flex items-start gap-2">
				<code class="min-w-0 flex-1 font-mono text-[11px] break-all select-all"
					>{mcpAdd}</code
				>
				<button
					onclick={() => void copy(mcpAdd)}
					class="btn btn-secondary btn-xs shrink-0"
					aria-label="copy the command"><Copy size={12} /> Copy</button
				>
			</div>
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
					<button onclick={() => void revoke(entry)} class="btn-link ml-auto"
						>Revoke</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}
		<div class="mt-4"><Banner tone="error">{error}</Banner></div>
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
			aria-label="token name"
			class="input w-64"
		/>
		<button class="btn btn-secondary" disabled={!name.trim()}
			>Create token</button
		>
	</form>
</section>

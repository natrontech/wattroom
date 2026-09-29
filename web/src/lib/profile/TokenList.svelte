<script lang="ts">
	// A rider's personal tokens as rows, each with its Revoke (ADR-0017): the
	// list Coach access keeps, and the one "Sign out everywhere else" shows
	// for the tokens it leaves standing (#2902). One component so the two can
	// never disagree about what a revoke asks or does.
	import { api } from '$lib/api';
	import { confirm } from '$lib/confirm.svelte';
	import { toasts } from '$lib/toast.svelte';
	import type { ApiToken } from '../../routes/(app)/settings/data/+page';

	let {
		tokens = $bindable(),
		onError,
	}: { tokens: ApiToken[]; onError: (message: string | null) => void } =
		$props();

	// A confirm, not an undo (errors.md): the row is deleted and the secret
	// cannot be reissued, and whatever the rider connected with it stops
	// working — one click used to do that in silence (#1759).
	async function revoke(entry: ApiToken) {
		const sure = await confirm({
			title: `Revoke “${entry.name}”?`,
			body: 'Whatever you connected with it stops working, and the token cannot be shown again — you would create a new one.',
			action: 'Revoke',
		});
		if (!sure) return;
		const res = await api<undefined>(`/api/tokens/${entry.id}`, {
			method: 'DELETE',
		});
		if (!res.ok) {
			onError(res.error.message);
			return;
		}
		onError(null);
		tokens = tokens.filter((t) => t.id !== entry.id);
		toasts.push(`Revoked “${entry.name}”.`);
	}
</script>

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

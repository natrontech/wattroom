<script lang="ts">
	// Furnishing the room: anyone in the crew pays from their own Batzen and it
	// goes up for everyone. What the crew owns stays free to swap.
	import Banner from '#lib/components/Banner.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { api } from '#lib/api.ts';
	import { ITEM_NAMES, SLOTS, type ShopItem } from '#lib/lounge/furnish.ts';

	let {
		crew,
		owned,
		picks,
		shop,
		togetherSec = 0,
		onclose,
		onchange,
	}: {
		crew: string;
		owned: string[];
		picks: Record<string, string>;
		shop: Record<string, ShopItem>;
		/** The crew's time together in voice, which unlocks some things. */
		togetherSec?: number;
		onclose: () => void;
		onchange: () => void;
	} = $props();

	let balance = $state<number | null>(null);
	let error = $state('');
	let busy = $state(false);

	async function loadBalance() {
		const res = await api<{ balance: number }>('/api/me/wallet');
		if (res.ok) balance = res.data.balance;
	}
	void loadBalance();

	const items = (slot: string) =>
		Object.keys(shop)
			.filter((id) => shop[id].slot === slot)
			.sort();

	async function done(res: {
		ok: boolean;
		error?: { message: string };
	}): Promise<void> {
		busy = false;
		error = res.ok ? '' : (res.error?.message ?? '');
		if (res.ok) {
			onchange();
			void loadBalance();
		}
	}

	async function buy(id: string) {
		busy = true;
		await done(
			await api(`/api/crews/${crew}/room/items/${id}`, { method: 'POST' }),
		);
	}

	async function pick(slot: string, item: string) {
		busy = true;
		await done(
			await api(`/api/crews/${crew}/room/picks`, {
				method: 'PUT',
				json: { slot, item },
			}),
		);
	}
</script>

<Modal label="Furnish the lounge" {onclose} class="max-w-xl">
	<h2 class="font-display text-lg font-bold">Furnish the lounge</h2>
	<p class="text-muted mt-1 text-sm">
		You pay from your own Batzen, and it goes up for your whole crew.
		{#if balance !== null}You have {balance}.{/if}
		Some things come free with time together in voice: your crew has
		<span class="font-display tabular-nums"
			>{Math.floor(togetherSec / 3600)} h</span
		> so far.
	</p>
	<div class="mt-4 grid gap-4">
		{#each SLOTS as { slot, name } (slot)}
			<section>
				<h3 class="eyebrow mb-1.5">{name}</h3>
				<div class="flex flex-wrap gap-1.5">
					<button
						type="button"
						disabled={busy}
						onclick={() => void pick(slot, '')}
						aria-pressed={!picks[slot]}
						class="btn btn-xs {picks[slot] ? 'btn-secondary' : 'btn-primary'}"
						>As it came</button
					>
					{#each items(slot) as id (id)}
						{#if owned.includes(id)}
							<button
								type="button"
								disabled={busy}
								onclick={() => void pick(slot, id)}
								aria-pressed={picks[slot] === id}
								class="btn btn-xs {picks[slot] === id
									? 'btn-primary'
									: 'btn-secondary'}">{ITEM_NAMES[id]}</button
							>
						{:else if shop[id].hours}
							<span
								class="btn btn-xs btn-ghost pointer-events-none opacity-70"
								title="Unlocks with time together in voice, for free"
								>{ITEM_NAMES[id]} · {shop[id].hours} h together</span
							>
						{:else}
							<button
								type="button"
								disabled={busy}
								onclick={() => void buy(id)}
								class="btn btn-xs btn-ghost"
								>{ITEM_NAMES[id]} · {shop[id].price} Batzen</button
							>
						{/if}
					{/each}
				</div>
			</section>
		{/each}
	</div>
	{#if error}
		<div class="mt-4"><Banner tone="error">{error}</Banner></div>
	{/if}
</Modal>

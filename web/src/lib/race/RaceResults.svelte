<script lang="ts">
	import type { RaceBracket } from '#lib/protocol.ts';
	import { account } from '#lib/account.svelte.ts';
	import { confirmWeight as sendConfirm } from '#lib/profile-sync.svelte.ts';
	import { finishMark, unrankedWhy, yoursFirst } from './closing-card';

	// The race's section of the closing card (#3779, ADR-0067): per Category,
	// yours first; never stored. Nothing here is live, so nothing is in watt.
	let { results, you }: { results: RaceBracket[]; you: string } = $props();

	const brackets = $derived(yoursFirst(results, you));
	let confirm = $state<'idle' | 'busy' | 'done'>('idle');
	let error = $state<string | null>(null);

	// The commissaire's tap (#3629).
	async function confirmWeight() {
		confirm = 'busy';
		error = await sendConfirm();
		confirm = error ? 'idle' : 'done';
	}
</script>

<section class="panel panel-lg sm:col-span-2" data-testid="race-results">
	<h2 class="eyebrow">race results</h2>
	{#each brackets as bracket (bracket.category)}
		{@const placed = bracket.placed ?? []}
		{@const unranked = bracket.unranked ?? []}
		<div class="mt-4" data-testid="race-bracket">
			<h3 class="font-display text-sm font-bold">
				Category {bracket.category}
			</h3>
			{#if bracket.alone}
				{@const lone = [...placed, ...unranked][0]}
				<p class="text-muted mt-1 text-xs">
					{lone?.riderId === you ? 'You' : lone?.name} rode alone in {bracket.category}.
				</p>
			{/if}
			<ol class="mt-2 grid gap-2">
				{#each placed as finisher, i (finisher.riderId)}
					<li
						class="flex items-baseline gap-3 text-sm"
						data-testid="race-placed"
					>
						{#if !bracket.alone}
							<span class="num text-muted w-6 shrink-0">{i + 1}</span>
						{/if}
						<span
							class="truncate {finisher.riderId === you ? 'font-medium' : ''}"
							>{finisher.riderId === you ? 'You' : finisher.name}</span
						>
						<span class="num ml-auto">{finishMark(finisher)}</span>
					</li>
				{/each}
			</ol>
			{#if unranked.length > 0}
				<ul class="mt-2 grid gap-2">
					{#each unranked as finisher (finisher.riderId)}
						<li class="text-sm" data-testid="race-unranked">
							<div class="flex items-baseline gap-3">
								<span class="w-6 shrink-0"></span>
								<span
									class="truncate {finisher.riderId === you
										? 'font-medium'
										: ''}"
									>{finisher.riderId === you ? 'You' : finisher.name}</span
								>
								<span class="text-muted text-xs">unranked</span>
								<span class="num ml-auto">{finishMark(finisher)}</span>
							</div>
							{#if finisher.riderId === you && finisher.why}
								{@const told = unrankedWhy(finisher.why)}
								<p class="mt-1 ml-9 text-xs">{told.text}</p>
								{#if told.way === 'confirm'}
									<div class="mt-2 ml-9 flex flex-wrap items-center gap-3">
										{#if confirm === 'done'}
											<p class="text-xs">
												Confirmed. The next race places you.
											</p>
										{:else if account.me}
											<button
												onclick={confirmWeight}
												disabled={confirm === 'busy'}
												class="btn btn-secondary btn-lg"
												>Still {account.me.weightKg} kg? That's right</button
											>
										{/if}
										{#if error}
											<p class="text-danger text-xs" role="alert">{error}</p>
										{/if}
									</div>
								{:else if told.way}
									<a
										href={told.way.href}
										class="btn btn-secondary btn-lg mt-2 ml-9"
										>{told.way.label}</a
									>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</section>

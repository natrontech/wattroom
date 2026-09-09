<script lang="ts">
	// The three setup steps that decide whether a rider ever rides (#1333):
	// pair a trainer, name the crew, invite someone. Each row is a link to
	// where the step is done and retires itself once it is; the card goes
	// when the last one does. Only the owner of a crew sees it — the crew
	// steps are theirs, and a rider who joined someone else's crew has
	// nothing to name or fill.
	import { fetchCrew } from '$lib/crew';
	import type { RoomCrew } from '$lib/room/room-data';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	let {
		crew,
		ridden,
	}: {
		/** The rider's own crew — null until the room list has landed. */
		crew: RoomCrew | null;
		/** Any ride on the account: the trainer was paired, or simulated. */
		ridden: boolean;
	} = $props();

	// How many are in the crew is not on the room list; one read, once per
	// crew, and the card stays quiet until it knows.
	let people = $state<number | null>(null);
	$effect(() => {
		const id = crew?.id;
		people = null;
		if (!id) return;
		void fetchCrew(id).then((res) => {
			if (res.ok && res.data.id === id) people = res.data.people.length;
		});
	});

	// The server's word (#1151): comparing the name to the owner's display
	// name retired the step when the OWNER renamed themselves (audit 2026-09-09).
	const named = $derived(!!crew?.named);
	const invited = $derived(people !== null && people > 1);
	const steps = $derived(
		crew && people !== null
			? [
					{
						done: ridden,
						label: 'Pair your trainer',
						hint: 'or ride simulated once to see the room work',
						href: '/settings/equipment',
					},
					{
						done: named,
						label: 'Name your crew',
						hint: `it is “${crew.name}” until you do`,
						href: `/crew/${crew.id}/settings`,
					},
					{
						done: invited,
						label: 'Invite someone',
						hint: 'the crew’s link gets them in — rooms have none of their own',
						href: `/crew/${crew.id}`,
					},
				]
			: [],
	);
	const left = $derived(steps.filter((s) => !s.done).length);
</script>

{#if steps.length > 0 && left > 0}
	<section class="panel mt-6 px-5 py-4">
		<p class="eyebrow">getting set up · {left} of {steps.length} to go</p>
		<ul class="divide-ink/5 mt-2 divide-y">
			{#each steps as step (step.label)}
				<li>
					{#if step.done}
						<p class="text-muted flex items-center gap-3 py-2 text-sm">
							<Check size={16} class="text-z4 shrink-0" />
							<span class="line-through">{step.label}</span>
						</p>
					{:else}
						<a
							href={step.href}
							class="hover:bg-surface -mx-2 flex items-center gap-3 rounded px-2 py-2 text-sm transition-colors"
						>
							<span
								class="border-muted/40 h-4 w-4 shrink-0 rounded-full border"
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1">
								<span class="block font-medium">{step.label}</span>
								<span class="text-muted block text-xs">{step.hint}</span>
							</span>
							<ChevronRight size={14} class="text-muted shrink-0" />
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

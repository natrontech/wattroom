<script lang="ts">
	// The setup steps that decide whether a rider ever rides (#1333, #1484):
	// set the two numbers every target scales from, take a first ride, name
	// the crew, invite someone. Each row is a link to where the step is done —
	// or, for the one step that is a question, the question itself — and
	// retires itself once it is done; the card goes when the last one does. The first step is everyone's (#1857): it used
	// to be gated with the crew steps on OWNING a crew, so a brand-new
	// account — no crew yet — and a rider who joined someone else's saw no
	// card at all, and the one instruction that makes a watt appear went
	// down with the two that are the owner's alone.
	import { account, unchosen } from '$lib/account.svelte';
	import { fetchCrew } from '$lib/crew';
	import FtpAsk from '$lib/home/FtpAsk.svelte';
	import type { RoomCrew } from '$lib/room/room-data';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	/** A row: a link to where the step is done, or the one step that is a
	 *  question and is answered in place (#1484). */
	type Step = {
		done: boolean;
		label: string;
		/** The small grey line under a link row; the ask writes its own. */
		hint?: string;
		href?: string;
		ask?: boolean;
	};

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
	// Labelled for what it tests (#1857): a finished ride. "Pair your
	// trainer" stayed open after a rider paired one, with the real rule in
	// the small grey line.
	const first: Step = $derived({
		done: ridden,
		label: 'Take your first ride',
		hint: 'pair your trainer, or ride simulated once to see the room work',
		href: '/settings/equipment',
	});
	// Above the trainer step, because it is above it in consequence (#1484):
	// an account is created holding 200 W and 75 kg that nobody chose, and
	// every target, the execution score, the XP bonus, the category and the
	// load scale from them. Answered in place rather than behind a link — the
	// one step that is a question should not send the rider to a settings page
	// to answer it — and never a gate: skipping it still rides, and Home
	// labels the number a starting guess until it is answered. Signed out
	// there is no account to ask about, so the step stays away.
	const numbers: Step[] = $derived(
		account.me
			? [
					{
						done: !unchosen(account.me.ftpSource),
						label: 'Set your FTP and weight',
						ask: true,
					},
				]
			: [],
	);
	const steps: Step[] = $derived(
		crew && people !== null
			? [
					...numbers,
					first,
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
			: [...numbers, first],
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
					{:else if step.ask}
						<FtpAsk label={step.label} />
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

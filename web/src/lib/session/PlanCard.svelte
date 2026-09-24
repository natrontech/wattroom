<script lang="ts">
	// The plan set to run in this voice channel (#2606). The reminder mail and
	// the calendar event both land here, and since the room's Sessions place
	// went with M9 the channel said nothing about it. Its time, the crew's
	// answers, and — once it is due — a Start that starts it the way the
	// Schedule does, so the plan is marked and stops offering itself.
	import { useChannel } from '$lib/channel/context';
	import { goto } from '$app/navigation';
	import {
		planDue,
		pressAnswer,
		startCrewPlan,
		startedPath,
	} from '$lib/crew-schedule';
	import { device } from '$lib/device.svelte';
	import { formatWhen } from '$lib/format';
	import { serverNow } from '$lib/server-clock';
	import RsvpRow from '$lib/session/RsvpRow.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { needsTrainer } from '$lib/session/sensor-status';
	import type { RsvpAnswer } from '$lib/session/rsvp';
	import { toasts } from '$lib/toast.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';

	const channel = useChannel();
	const plan = $derived(channel.plan);

	// Due is a moment, not a render: a card left open on the channel has to
	// grow its Start when the fifteen minutes arrive, with nothing else moving.
	let now = $state(serverNow());
	$effect(() => {
		const id = setInterval(() => (now = serverNow()), 30_000);
		return () => clearInterval(id);
	});
	const due = $derived(!!plan && planDue(plan.startsAt, now));
	// Nobody else holds the channel's session — the one-session rule would
	// refuse it with their name, and SessionControls already says whose it is.
	const canStart = $derived(channel.canControl && !device.spectator);
	// The gear first, as the picker asks it (#2594).
	const unpaired = $derived(needsTrainer(channel.trainer, channel.pairing));

	let busy = $state(false);
	async function start() {
		if (!plan) return;
		busy = true;
		const res = await startCrewPlan(channel.address.crew, plan.id);
		busy = false;
		channel.reloadPlan();
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		// To the ride, where the count-in is (#2599).
		void goto(startedPath(channel.address.crew, res.data), {
			keepFocus: true,
			noScroll: true,
		});
	}
	async function choose(word: RsvpAnswer) {
		if (!plan) return;
		const res = await pressAnswer(channel.address.crew, plan, word);
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		channel.reloadPlan();
	}
</script>

{#if plan}
	<section class="panel mt-4" aria-label="planned here">
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<CalendarClock size={16} class="text-muted shrink-0" />
			<div class="min-w-0 flex-1">
				<p class="eyebrow">planned here</p>
				<p class="font-display truncate text-base font-bold">
					{plan.workoutName}
				</p>
				<p class="text-muted mt-0.5 text-xs">
					{formatWhen(plan.startsAt, true)} · planned by {plan.createdBy}
				</p>
			</div>
			{#if due && device.spectator}
				<!-- The cockpit stays on the screen a coach rides on (#1767). -->
				<span class="text-watt glow-text text-xs">starting soon</span>
			{:else if due && canStart}
				<span class="flex flex-wrap items-center gap-2">
					{#if unpaired}<TrainerOverview compact />{/if}
					<button
						onclick={() => void start()}
						disabled={busy}
						class="btn {unpaired ? 'btn-secondary' : 'btn-accent'} btn-lg"
						>{unpaired
							? 'Start without a trainer'
							: `Start ${plan.workoutName}`}</button
					>
				</span>
			{/if}
		</div>
		<div class="mt-2">
			<RsvpRow {plan} onChoose={(word) => void choose(word)} />
		</div>
	</section>
{/if}

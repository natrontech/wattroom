<script lang="ts">
	// Who can find the room, as one ladder (#1204). The steps, their words and
	// the two columns each one means live in $lib/rooms/reach — a crew row asks
	// the same question and must not word it differently (#2007).
	// Split from the settings page (#1265); the page owns the two values and
	// saves on `onchange`.
	import {
		REACH_FLAGS,
		reachOf,
		reachSteps,
		type Reach,
	} from '$lib/rooms/reach';

	let {
		listed = $bindable(),
		crewVisible = $bindable(),
		crewName,
		busy = false,
		onchange,
	}: {
		listed: boolean;
		crewVisible: boolean;
		crewName?: string;
		busy?: boolean;
		onchange: () => void;
	} = $props();

	const steps = $derived(reachSteps(crewName));
	const reach = $derived(reachOf(listed, crewVisible));
	function setReach(next: Reach) {
		({ crewVisible, listed } = REACH_FLAGS[next]);
		onchange();
	}
</script>

<!-- The one control that takes a room from private to findable — by
		     its crew (#1204, ADR-0038) or by people who have never been in it
		     (#1118, ADR-0039). Worded as the privacy choice it is rather than
		     as two checkboxes, and it says what each step actually does —
		     including the half riders assume and should not: being findable
		     is not being readable. -->
<section class="panel mt-3 p-6">
	<h2 class="font-display font-bold">Who can find this room</h2>
	<p class="text-muted mt-1.5 text-xs">
		Finding is not joining and it is not reading. Whichever you pick, the chat,
		the members and the numbers stay for people who are actually in here.
	</p>
	<div
		class="mt-3 space-y-2"
		role="radiogroup"
		aria-label="who can find this room"
	>
		{#each steps as step (step.key)}
			<button
				role="radio"
				aria-checked={reach === step.key}
				onclick={() => setReach(step.key)}
				disabled={busy}
				class="flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left {reach ===
				step.key
					? 'ring-neon border-neon/40 bg-neon/10 ring-1'
					: 'border-muted/15'}"
			>
				<span class="min-w-0">
					<span class="block text-sm font-medium">{step.label}</span>
					<span class="text-muted block text-xs">{step.hint}</span>
				</span>
			</button>
		{/each}
	</div>
</section>

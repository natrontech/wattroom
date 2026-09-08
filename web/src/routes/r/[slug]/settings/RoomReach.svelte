<script lang="ts">
	// Who can find the room, as one ladder (#1204). The server keeps two
	// columns — listed is the public directory, crewVisible the crew's
	// sidebar — but a room listed to strangers and hidden from its own crew
	// is not a state anyone means, so the page walks them as one question.
	// Split from the settings page (#1265); the page owns the two values and
	// saves on `onchange`.
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

	type Reach = 'members' | 'crew' | 'everyone';
	const REACH: Record<Reach, { crewVisible: boolean; listed: boolean }> = {
		members: { crewVisible: false, listed: false },
		crew: { crewVisible: true, listed: false },
		everyone: { crewVisible: true, listed: true },
	};

	const reach = $derived<Reach>(
		listed ? 'everyone' : crewVisible ? 'crew' : 'members',
	);
	function setReach(next: Reach) {
		({ crewVisible, listed } = REACH[next]);
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
		{#each [{ key: 'members', label: 'Its members', hint: 'Its members, and the crew-mates you let in from the Members place. The rest of the crew sees that it exists and that it is private — not a way in.' }, { key: 'crew', label: crewName ? `The crew — ${crewName}` : 'The crew', hint: 'Everyone in the crew sees it in their sidebar and can walk in without a code. This is how a new room starts.' }, { key: 'everyone', label: 'Everyone on WattRoom', hint: 'Anyone signed in can find it by name in the directory and join — which puts them in the crew. They see its name and icon first, nothing about who rides here or what you did.' }] as const as step (step.key)}
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

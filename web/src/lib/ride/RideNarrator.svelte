<script lang="ts">
	/**
	 * The ride narrator (#3213, WCAG 4.1.3): the world and the Skyline say what
	 * happens to a rider who cannot see them. Two sr-only live regions, polite
	 * for a block, a climb and a summit, an alert for the trainer. S speaks the
	 * state. Mounted once by the surface that rides, like watchClimbCues: a TV
	 * beside the desk would say it twice.
	 */
	import type { MomentEvent } from '$lib/moments';
	import { board } from '$lib/board/clips.svelte';
	import { zoneOf } from '$lib/components/zones';
	import { isTyping } from '$lib/keys';
	import { climbView } from '$lib/ride/climb-view';
	import {
		blockLine,
		climbStartLine,
		createNarrator,
		crewLines,
		momentLine,
		stateLine,
		SPRINT_LINE,
		SUMMIT_LINE,
		toTopLine,
		trainerLine,
		type Narration,
	} from '$lib/ride/narrator';
	import { gradeAt } from '$lib/road/at-metre';
	import { turnedRound } from '$lib/road/road';
	import type { SkylineView } from '$lib/road/skyline';

	let {
		view,
		watts,
		ftp,
		stale = false,
		block = null,
		moment = null,
		crew = [],
		sprintStartsAt = null,
	}: {
		view: SkylineView | null;
		watts: number;
		ftp: number;
		stale?: boolean;
		/** The workout block now riding, when there is a workout. */
		block?: { index: number; label: string } | null;
		/** The moments queue's latest event (#3210): a finish, a result, a PR. */
		moment?: MomentEvent | null;
		/** The other riders on the session, for "Anna joined". */
		crew?: { id: string; name: string }[];
		/** The armed sprint's start (server ms), while one is armed. */
		sprintStartsAt?: number | null;
	} = $props();

	let said = $state<Narration>({
		polite: '',
		alert: '',
		politeSeq: 0,
		alertSeq: 0,
	});
	const narrator = createNarrator(Date.now, (n) => (said = n));
	$effect(() => {
		const id = setInterval(narrator.tick, 1000);
		return () => clearInterval(id);
	});

	const climb = $derived(climbView(view));
	let opened: number | null = null;
	let topped: number | null = null;
	let kmLeft = Infinity;
	$effect(() => {
		const c = climb;
		if (!c) {
			// The card closed: the next lap's climb opens afresh.
			opened = null;
			return;
		}
		if (c.climb.startM !== opened) {
			opened = c.climb.startM;
			topped = null;
			kmLeft = Infinity;
			narrator.polite(climbStartLine(c));
		}
		if (c.card.summited) {
			if (topped !== c.climb.startM) {
				topped = c.climb.startM;
				narrator.polite(SUMMIT_LINE);
			}
			return;
		}
		// On the climb, never on the lead-in: "2 km to the top" is a count down.
		const whole = Math.floor(c.card.toTopM / 1000);
		if (c.toFootM === 0 && whole >= 1 && whole < kmLeft) {
			kmLeft = whole;
			narrator.polite(toTopLine(whole));
		}
	});

	let lastBlock: number | null | undefined;
	$effect(() => {
		const index = block?.index ?? null;
		if (lastBlock !== undefined && block && index !== lastBlock)
			narrator.polite(blockLine(block.label));
		lastBlock = index;
	});

	$effect(() => {
		const line = moment && momentLine(moment);
		if (line) narrator.polite(line);
	});

	let roster: Map<string, string> | undefined;
	$effect(() => {
		const now = new Map(crew.map((r) => [r.id, r.name]));
		if (roster)
			for (const line of crewLines(roster, now)) narrator.polite(line);
		roster = now;
	});

	let armed: number | null = null;
	$effect(() => {
		if (sprintStartsAt !== null && sprintStartsAt !== armed)
			narrator.alert(SPRINT_LINE);
		armed = sprintStartsAt;
	});

	let lastStale: boolean | undefined;
	$effect(() => {
		// Losing the trainer interrupts; getting it back is good news and waits its turn.
		if (lastStale !== undefined && stale !== lastStale)
			(stale ? narrator.alert : narrator.polite)(trainerLine(stale));
		lastStale = stale;
	});

	function keys(event: KeyboardEvent) {
		if (event.key.toLowerCase() !== 's' || event.repeat || !view) return;
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event))
			return;
		// A pad the rider bound to S is theirs.
		if (board.onKey('s')) return;
		const road = view.road;
		const m = view.reverse ? road.length - view.m : view.m;
		narrator.alert(
			stateLine({
				m,
				lengthM: road.length,
				grade: gradeAt(view.reverse ? turnedRound(road) : road, m),
				toTopM:
					climb?.toFootM === 0 && !climb.card.summited
						? climb.card.toTopM
						: undefined,
				watts,
				zone: ftp > 0 ? zoneOf(watts, ftp) : 1,
			}),
		);
	}
</script>

<svelte:window onkeydown={keys} />

<div class="sr-only" data-testid="ride-narrator">
	<p role="status">
		{#key said.politeSeq}{said.polite}{/key}
	</p>
	{#if said.alert}
		{#key said.alertSeq}<p role="alert">{said.alert}</p>{/key}
	{/if}
</div>

<script lang="ts">
	import type { Medal } from '$lib/components/MedalCard.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import { CHANNEL_NAME, workout } from '../channel/mockChannel.svelte';

	// The real closing card with every part a capture cannot ride into
	// (#3686): a session's roster with scores, and a medal. 65 minutes of
	// samples climbing through the zones against a 250 W FTP.
	const FTP = 250;
	const samples = Array.from({ length: 3900 }, (_, s) => ({
		watts: Math.round(
			120 + (s / 3900) * 140 + 30 * Math.sin(s / 90) + (s % 600 < 20 ? 250 : 0),
		),
	}));

	const medal: Medal = {
		name: 'Metronome',
		criterion: 'best execution score',
		rider: 'You',
		value: '94',
		unit: '%',
		kj: 812,
		xp: 959,
	};
</script>

<main class="page">
	<SessionSummary
		title={workout.name}
		crew={CHANNEL_NAME}
		{samples}
		ftp={FTP}
		execution={0.94}
		{medal}
		placeName={CHANNEL_NAME}
		savedXp={959}
		riders={[
			{ id: 'me', name: 'You', execution: 0.94, you: true },
			{ id: 'mia', name: 'Mia', execution: 0.91 },
			{ id: 'kim', name: 'Kim', execution: 0.87 },
		]}
	>
		{#snippet actions()}
			<a href="/history" class="btn btn-secondary">See your ride</a>
			<button class="btn btn-primary">Done</button>
		{/snippet}
	</SessionSummary>
</main>

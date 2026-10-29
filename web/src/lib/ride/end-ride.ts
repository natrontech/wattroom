import { confirm } from '$lib/confirm.svelte';

/**
 * End ride on a workout asks first (#2623): the rest of the workout cannot
 * be resumed, and one stray tap filed a cut ride (errors.md). The riding
 * screen's End ride and the ride dock's ask the same question.
 */
export function askToEndWorkout(): Promise<boolean> {
	return confirm({
		title: 'End the ride?',
		body: 'The rest of the workout cannot be resumed. What you have ridden is saved if it is a minute or longer.',
		action: 'End the ride',
		cancel: 'Keep riding',
	});
}

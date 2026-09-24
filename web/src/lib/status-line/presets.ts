import type { ClearAfter } from './clear-after';

/**
 * The one-tap statuses (docs/SPEC.md "Personal status"). The emoji here are
 * what a rider wears — data, like a typed one — which is why this file is on
 * the no-emoji guard's allowlist.
 */
export const PRESETS: readonly {
	emoji: string;
	text: string;
	clear: ClearAfter;
}[] = [
	{ emoji: '🤒', text: 'Out sick', clear: 'today' },
	{ emoji: '🏔️', text: 'Riding outside', clear: '4h' },
	{ emoji: '😴', text: 'Recovery week', clear: 'week' },
	{ emoji: '🏖️', text: 'On holiday', clear: 'never' },
];

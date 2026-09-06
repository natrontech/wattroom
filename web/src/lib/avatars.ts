/**
 * The avatar preset catalog (#253) — the client is its canonical home; the
 * server stores only the id. Colors are zone/theme tokens (never --color-watt:
 * that accent marks live data, ADR-0005).
 */
import Bike from '@lucide/svelte/icons/bike';
import Cat from '@lucide/svelte/icons/cat';
import Flame from '@lucide/svelte/icons/flame';
import Ghost from '@lucide/svelte/icons/ghost';
import Mountain from '@lucide/svelte/icons/mountain';
import Music from '@lucide/svelte/icons/music';
import Rabbit from '@lucide/svelte/icons/rabbit';
import Rocket from '@lucide/svelte/icons/rocket';
import Skull from '@lucide/svelte/icons/skull';
import Snail from '@lucide/svelte/icons/snail';
import Turtle from '@lucide/svelte/icons/turtle';
import Zap from '@lucide/svelte/icons/zap';

export interface AvatarPreset {
	id: string;
	icon: typeof Bike;
	/** CSS color for the disc — a theme token, resolved by the browser. */
	bg: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
	{ id: 'bike', icon: Bike, bg: 'var(--color-neon)' },
	{ id: 'zap', icon: Zap, bg: 'var(--color-z5)' },
	{ id: 'flame', icon: Flame, bg: 'var(--color-z6)' },
	{ id: 'rocket', icon: Rocket, bg: 'var(--color-z2)' },
	{ id: 'mountain', icon: Mountain, bg: 'var(--color-z3)' },
	{ id: 'ghost', icon: Ghost, bg: 'var(--color-z1)' },
	{ id: 'skull', icon: Skull, bg: 'var(--color-z7)' },
	{ id: 'cat', icon: Cat, bg: 'var(--color-z4)' },
	{ id: 'rabbit', icon: Rabbit, bg: 'var(--color-z5)' },
	{ id: 'turtle', icon: Turtle, bg: 'var(--color-z4)' },
	{ id: 'snail', icon: Snail, bg: 'var(--color-z1)' },
	{ id: 'music', icon: Music, bg: 'var(--color-z2)' },
];

export function presetById(id: string): AvatarPreset | undefined {
	return AVATAR_PRESETS.find((preset) => preset.id === id);
}

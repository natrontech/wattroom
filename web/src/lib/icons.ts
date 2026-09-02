import type { Component } from 'svelte';
import {
	BicepsFlexed,
	Bike,
	Coffee,
	Dumbbell,
	Flag,
	Flame,
	Ghost,
	HandMetal,
	Heart,
	Moon,
	Mountain,
	PartyPopper,
	Rocket,
	Skull,
	Snowflake,
	Sparkles,
	Sun,
	ThumbsUp,
	Tornado,
	Trophy,
	Zap,
	type IconProps,
} from '@lucide/svelte';

export type Icon = Component<IconProps>;

/**
 * A room's icon and its reactions are drawn icons, stored as their lucide
 * name (#447): the server keeps the key, the client draws it, so they look
 * the same on every device and in every theme. Two curated vocabularies —
 * the identity mark a room wears, and the palette it cheers with.
 */
export const ROOM_ICONS: Record<string, Icon> = {
	bike: Bike,
	zap: Zap,
	flame: Flame,
	mountain: Mountain,
	tornado: Tornado,
	skull: Skull,
	flag: Flag,
	ghost: Ghost,
	rocket: Rocket,
	trophy: Trophy,
	coffee: Coffee,
	dumbbell: Dumbbell,
	sun: Sun,
	moon: Moon,
	snowflake: Snowflake,
};

export const CHEER_ICONS: Record<string, Icon> = {
	flame: Flame,
	'biceps-flexed': BicepsFlexed,
	'party-popper': PartyPopper,
	skull: Skull,
	rocket: Rocket,
	snowflake: Snowflake,
	heart: Heart,
	zap: Zap,
	trophy: Trophy,
	'hand-metal': HandMetal,
	'thumbs-up': ThumbsUp,
};

/** The stock reaction set — the server's baseCheers, the same six keys. */
export const STOCK_CHEERS = [
	'flame',
	'biceps-flexed',
	'party-popper',
	'skull',
	'rocket',
	'snowflake',
];

/**
 * Rooms made before #447 store emoji, and a client from before it still
 * throws them; each known one maps to its icon so nothing already saved goes
 * blank. Keyed without the U+FE0F presentation selector — `keyFor` strips it.
 */
export const EMOJI_TO_KEY: Record<string, string> = {
	'🚴': 'bike',
	'⚡': 'zap',
	'🔥': 'flame',
	'🏔': 'mountain',
	'🌀': 'tornado',
	'🦖': 'ghost',
	'💀': 'skull',
	'🏁': 'flag',
	'💪': 'biceps-flexed',
	'👏': 'party-popper',
	'🚀': 'rocket',
	'🧊': 'snowflake',
	'❤': 'heart',
	'🏆': 'trophy',
	'👍': 'thumbs-up',
};

const ALL_ICONS: Record<string, Icon> = { ...ROOM_ICONS, ...CHEER_ICONS };

/** The icon key a stored value means: a key as-is, a known emoji translated. */
export function keyFor(value: string): string {
	return EMOJI_TO_KEY[value.replace(/\uFE0F/g, '')] ?? value;
}

/**
 * The component that draws `value` — an icon key or an emoji an older room
 * or client stored. Nothing for '', a placeholder for a value nobody knows.
 */
export function iconFor(value: string | undefined): Icon | null {
	if (!value) return null;
	return ALL_ICONS[keyFor(value)] ?? Sparkles;
}

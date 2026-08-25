/**
 * Synthwave palette candidates for the brand round.
 * Applied as inline CSS vars on the /dev wrapper — Tailwind v4 theme tokens are
 * plain custom properties, so overriding them recolours every mock underneath.
 */
export type Palette = {
	name: string;
	note: string;
	vars: {
		'--color-surface': string;
		'--color-surface-raised': string;
		'--color-muted': string;
		'--color-watt': string; // live data — the one hue that glows
		'--color-neon': string; // secondary neon: horizons, grids, mark accents
	};
};

export const palettes: Palette[] = [
	{
		name: 'Miami Nights',
		note: 'Indigo night, cyan live data, magenta horizon. The postcard synthwave.',
		vars: {
			'--color-surface': '#0c0224',
			'--color-surface-raised': '#180a3d',
			'--color-muted': '#8c82c4',
			'--color-watt': '#22e8ff',
			'--color-neon': '#ff2e88',
		},
	},
	{
		name: 'Outrun',
		note: 'Violet-black, hot magenta live data. Loudest — sprint moments will scream.',
		vars: {
			'--color-surface': '#0a0118',
			'--color-surface-raised': '#1a0736',
			'--color-muted': '#9182b8',
			'--color-watt': '#ff3d8b',
			'--color-neon': '#8b2bff',
		},
	},
	{
		name: 'Laser Yellow',
		note: 'Keeps watt-yellow as the live hue, goes synthwave everywhere else. No ADR needed.',
		vars: {
			'--color-surface': '#10012b',
			'--color-surface-raised': '#1e0a45',
			'--color-muted': '#9083bd',
			'--color-watt': '#ffe94d',
			'--color-neon': '#ff2e88',
		},
	},
	{
		name: 'Tron Ice',
		note: 'Coldest and calmest. Reads as an instrument, not an arcade — easiest on a 2h ride.',
		vars: {
			'--color-surface': '#03060f',
			'--color-surface-raised': '#0b1428',
			'--color-muted': '#6f88a8',
			'--color-watt': '#5cf2ff',
			'--color-neon': '#2b6cff',
		},
	},
];

/** Shared selection so any mock can react to a palette switch, not just recolour via CSS. */
export const active = $state({ palette: palettes[0] });

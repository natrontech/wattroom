import type { FigureBuild } from '$lib/account.svelte';
import {
	MaxFigureHeightCm,
	MinFigureHeightCm,
	SkinSwatches,
} from '$lib/protocol';

export const BUILDS: FigureBuild[] = ['slim', 'athletic', 'strong'];
/** docs/spec/garage.md: the neutral figure is athletic, a middle height. */
export const NEUTRAL_BUILD: FigureBuild = 'athletic';
export const NEUTRAL_HEIGHT_CM = Math.round(
	(MinFigureHeightCm + MaxFigureHeightCm) / 2,
);
/** The 8 swatches, lightest to darkest, and the neutral tone none of them is. */
export const SKIN_VARS = Array.from(
	{ length: SkinSwatches },
	(_, i) => `var(--world-skin-${i + 1})`,
);
export const NEUTRAL_SKIN_VAR = 'var(--world-kit-skin)';

export const metres = (cm: number) => `${(cm / 100).toFixed(2)} m`;

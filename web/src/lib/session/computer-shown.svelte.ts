import type { CameraPreset } from '$lib/world/cameras';
import type { ComputerPage } from './computer-pages';

/**
 * The page the riding screen's bike computer shows, and whether it has MAP
 * (#4217): the view switch's Map segment is pressed while MAP shows, and
 * drawn only where there is one. BikeComputer writes it; the TV's copy never.
 * `world` is the view switch's: the 3D world draws, for the phone remote's
 * answer (#4223). `camera` is the world's, while one draws (#4253).
 */
export const computerShown = $state<{
	page: ComputerPage;
	maps: boolean;
	world: boolean;
	camera: CameraPreset | null;
}>({
	page: 'ride',
	maps: false,
	world: false,
	camera: null,
});

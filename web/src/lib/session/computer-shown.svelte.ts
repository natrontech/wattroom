import type { ComputerPage } from './computer-pages';

/**
 * The page the riding screen's bike computer shows, and whether it has MAP
 * (#4217): the view switch's Map segment is pressed while MAP shows, and
 * drawn only where there is one. BikeComputer writes it; the TV's copy never.
 */
export const computerShown = $state<{ page: ComputerPage; maps: boolean }>({
	page: 'ride',
	maps: false,
});

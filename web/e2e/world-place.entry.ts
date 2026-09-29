import {
	goldenKeying,
	goldenRoad,
} from '../src/lib/world/place/golden.test-helper';
import { placementHash } from '../src/lib/world/place/region';

/** What world-place.spec.ts bundles into a page and a worker: the golden world's hash. */
export const goldenHash = (): string =>
	placementHash(goldenKeying(), 0, goldenRoad().length, 40);

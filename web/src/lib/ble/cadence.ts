import { createCadenceTracker } from './revolutions';
import { createBleSensor, type ReadingFields, type Sensor } from './sensor';

/** Cycling Speed and Cadence Service and its measurement. */
const CSC_SERVICE = 0x1816;
const CSC_MEASUREMENT = 0x2a5b;

/**
 * Parse CSC Measurement (0x2A5B). Settles the "CSC 0x2A5B parsing" debt in
 * docs/RESEARCH.md §11.
 *
 * Two optional blocks, wheel then crank. The wheel block is parsed only to find the
 * crank block behind it — indoors the trainer reports speed, and no part of the
 * product scores distance, so wheel revolutions have no consumer.
 *
 * ponytail: no wheel speed. It needs a per-rider wheel circumference to mean
 * anything, and nothing would read it. Add both together if outdoor rides ever land.
 */
export function parseCsc(view: DataView): {
	crank?: { revs: number; eventTime: number };
} {
	const flags = view.getUint8(0);
	let offset = 1;

	if (flags & 0x01) offset += 6; // wheel revs: uint32 + uint16 event time

	if (flags & 0x02) {
		return {
			crank: {
				revs: view.getUint16(offset, true),
				eventTime: view.getUint16(offset + 2, true),
			},
		};
	}
	return {};
}

export function createCadenceSensor(): Sensor {
	return createBleSensor({
		kind: 'cadence',
		service: CSC_SERVICE,
		characteristic: CSC_MEASUREMENT,
		defaultName: 'Cadence sensor',
		createParser: () => {
			const cadenceFrom = createCadenceTracker();
			return (view): ReadingFields | null => {
				const { crank } = parseCsc(view);
				// A wheel-only sensor has nothing to say here.
				return crank ? { cadence: cadenceFrom(crank) } : null;
			};
		},
	});
}

import { FRAMES, type BarStyle, type FrameId } from './bikes/presets';

/**
 * What a figure is dressed in and rides (#3070, ADR-0073): the parts the mesh
 * builder reads, as the rider studio's catalogue has them. Only the shapes a
 * mesh needs live here; names, prices and the rest of the garage are its own
 * (#3159). A kit is always whole: resolveKit fills every slot.
 */

export type TubeShape = 'round' | 'steel' | 'aero' | 'kamm';
/** Tube radii in metres, and how the tubes are shaped and joined. */
export type FrameTubes = {
	shape: TubeShape;
	aspect?: number;
	dt: number;
	tt: number;
	st: number;
	ht: number;
	cs: number;
	ss: number;
	fork: number;
	stays: 'dropped' | 'normal';
	dropY?: number;
	lugs?: boolean;
	lugContrast?: boolean;
};
export type FrameParts = {
	brakes: 'disc' | 'rim' | 'coaster' | 'none';
	rings: number;
	derailleur: boolean;
	bottleCages: number;
	fenders?: boolean;
	rack?: boolean;
	frameBag?: boolean;
	bell?: boolean;
	lamp?: boolean;
};

export type WheelShape =
	| { type: 'spoked'; depth: number; spokes: number }
	| { type: 'blades'; depth: number; blades: number; bladeMm: number }
	| { type: 'disc'; depth: number };
export type Wheels = {
	finish: 'alloy' | 'carbon' | 'silver' | 'steel';
	front: WheelShape;
	rear: WheelShape;
	decal: {
		style: 'none' | 'logo' | 'band' | 'grooves';
		count: number;
		arcDeg: number;
	};
};
export type Tyres = {
	widthMm: number;
	wall: 'black' | 'tan';
	tread: 'slick' | 'knob';
};

export type Kit = {
	frame: FrameId;
	tubes: FrameTubes;
	parts: FrameParts;
	wheels: Wheels;
	tyres: Tyres;
	bars: BarStyle;
	saddle: 'race' | 'short' | 'leather';
	bottles: 'none' | 'one' | 'two';
	/** A finish, painted by the caller's palette (lib/world carries no colours). */
	groupset: 'black' | 'silver' | 'copper';
	jersey: { sleeves: 'short' | 'long' };
	shorts: 'short' | 'knicker';
	helmet: 'road' | 'aero' | 'hairnet';
	glasses: 'wrap' | 'shield' | 'round' | 'none';
	socks: { height: number; stripe?: boolean };
	shoes: 'road' | 'laced';
	gloves: 'short' | 'full' | 'none';
	hair: 'short' | 'ponytail' | 'none';
};

const spoked = (depth: number, spokes: number): WheelShape => ({
	type: 'spoked',
	depth,
	spokes,
});
const logo = (arcDeg: number) => ({ style: 'logo' as const, count: 2, arcDeg });
const NO_DECAL = { style: 'none' as const, count: 0, arcDeg: 0 };

// prettier-ignore
export const WHEELS = {
	alloy30: { finish: 'alloy', front: spoked(0.03, 24), rear: spoked(0.03, 24), decal: logo(38) },
	carbon30: { finish: 'carbon', front: spoked(0.03, 20), rear: spoked(0.03, 24), decal: logo(44) },
	carbon60: { finish: 'carbon', front: spoked(0.06, 20), rear: spoked(0.06, 24), decal: logo(56) },
	trispoke: {
		finish: 'carbon',
		front: { type: 'blades', depth: 0.05, blades: 3, bladeMm: 34 },
		rear: { type: 'disc', depth: 0.06 },
		decal: { style: 'logo', count: 3, arcDeg: 30 },
	},
	gravel: { finish: 'alloy', front: spoked(0.025, 28), rear: spoked(0.025, 28), decal: logo(34) },
	box32: { finish: 'silver', front: spoked(0.018, 32), rear: spoked(0.018, 32), decal: NO_DECAL },
	army: { finish: 'steel', front: spoked(0.02, 36), rear: spoked(0.02, 36), decal: NO_DECAL },
} satisfies Record<string, Wheels>;

const slick = (widthMm: number): Tyres => ({
	widthMm,
	wall: 'black',
	tread: 'slick',
});
export const TYRES = {
	black28: slick(28),
	black26: slick(26),
	black25: slick(25),
	black23: slick(23),
	classic23: { widthMm: 23, wall: 'tan', tread: 'slick' },
	gravel45: { widthMm: 45, wall: 'black', tread: 'knob' },
	balloon40: { widthMm: 40, wall: 'tan', tread: 'slick' },
} satisfies Record<string, Tyres>;

type FrameKit = {
	tubes: FrameTubes;
	parts: FrameParts;
	wheels: keyof typeof WHEELS;
	tyres: keyof typeof TYRES;
	bars: BarStyle;
	saddle: Kit['saddle'];
};

// prettier-ignore
const STEEL: FrameTubes = { shape: 'steel', dt: 0.0145, tt: 0.0128, st: 0.0143, ht: 0.0165, cs: 0.0105, ss: 0.0085, fork: 0.0115, stays: 'normal', lugs: true };
const CLASSIC = {
	parts: { brakes: 'rim', rings: 2, derailleur: true, bottleCages: 1 },
	wheels: 'box32',
	tyres: 'classic23',
	bars: 'drop',
	saddle: 'leather',
} as const;

/** Each frame's tubes, parts and the parts it comes with. */
// prettier-ignore
export const FRAME_KITS: Record<FrameId, FrameKit> = {
	race: {
		tubes: { shape: 'round', dt: 0.0205, tt: 0.0165, st: 0.0165, ht: 0.024, cs: 0.0115, ss: 0.0095, fork: 0.0135, stays: 'dropped', dropY: 0.055 },
		parts: { brakes: 'disc', rings: 2, derailleur: true, bottleCages: 2 },
		wheels: 'alloy30', tyres: 'black28', bars: 'drop', saddle: 'race',
	},
	aero: {
		tubes: { shape: 'kamm', aspect: 2.4, dt: 0.0165, tt: 0.0125, st: 0.0135, ht: 0.022, cs: 0.011, ss: 0.0085, fork: 0.012, stays: 'dropped', dropY: 0.13 },
		parts: { brakes: 'disc', rings: 2, derailleur: true, bottleCages: 2 },
		wheels: 'carbon60', tyres: 'black28', bars: 'aero', saddle: 'short',
	},
	climb: {
		tubes: { shape: 'round', dt: 0.0175, tt: 0.014, st: 0.0145, ht: 0.022, cs: 0.0105, ss: 0.0085, fork: 0.0125, stays: 'normal' },
		parts: { brakes: 'rim', rings: 2, derailleur: true, bottleCages: 2 },
		wheels: 'carbon30', tyres: 'black26', bars: 'drop', saddle: 'race',
	},
	tt: {
		tubes: { shape: 'kamm', aspect: 2.8, dt: 0.016, tt: 0.012, st: 0.013, ht: 0.021, cs: 0.011, ss: 0.0085, fork: 0.012, stays: 'dropped', dropY: 0.15 },
		parts: { brakes: 'rim', rings: 1, derailleur: true, bottleCages: 1 },
		wheels: 'trispoke', tyres: 'black25', bars: 'tt', saddle: 'short',
	},
	gravel: {
		tubes: { shape: 'round', dt: 0.022, tt: 0.0175, st: 0.017, ht: 0.025, cs: 0.0125, ss: 0.01, fork: 0.015, stays: 'dropped', dropY: 0.04 },
		parts: { brakes: 'disc', rings: 1, derailleur: true, bottleCages: 2 },
		wheels: 'gravel', tyres: 'gravel45', bars: 'flare', saddle: 'race',
	},
	steel: { ...CLASSIC, tubes: STEEL },
	zweihundert: { ...CLASSIC, tubes: { ...STEEL, lugContrast: true } },
	track: {
		tubes: { shape: 'aero', aspect: 1.7, dt: 0.019, tt: 0.016, st: 0.016, ht: 0.023, cs: 0.0115, ss: 0.009, fork: 0.0135, stays: 'normal' },
		parts: { brakes: 'none', rings: 1, derailleur: false, bottleCages: 0 },
		wheels: 'carbon60', tyres: 'black23', bars: 'track', saddle: 'short',
	},
	ordonnanz: {
		tubes: { shape: 'steel', dt: 0.0175, tt: 0.0165, st: 0.0165, ht: 0.019, cs: 0.0125, ss: 0.0105, fork: 0.0135, stays: 'normal', lugs: true },
		parts: { brakes: 'coaster', rings: 1, derailleur: false, bottleCages: 0, fenders: true, rack: true, frameBag: true, bell: true, lamp: true },
		wheels: 'army', tyres: 'balloon40', bars: 'upright', saddle: 'leather',
	},
};

/** The studio's starter loadout: what a rider wears before choosing anything. */
const STARTER = {
	bottles: 'one',
	groupset: 'black',
	jersey: { sleeves: 'short' },
	shorts: 'short',
	helmet: 'road',
	glasses: 'wrap',
	socks: { height: 0.11 },
	shoes: 'road',
	gloves: 'short',
	hair: 'short',
} satisfies Partial<Kit>;

/**
 * A whole kit from a frame and any picks: every slot filled, the frame's own
 * parts where nothing was picked. A time-trial or upright frame keeps its bar.
 */
export function resolveKit(
	frame: FrameId = 'race',
	picks: Partial<Omit<Kit, 'frame' | 'tubes' | 'parts'>> = {},
): Kit {
	const fk = FRAME_KITS[frame];
	const fixed = FRAMES[frame].cockpit.bar;
	return {
		...STARTER,
		wheels: WHEELS[fk.wheels],
		tyres: TYRES[fk.tyres],
		bars: fk.bars,
		saddle: fk.saddle,
		...picks,
		...(fixed === 'tt' || fixed === 'upright' ? { bars: fixed } : {}),
		frame,
		tubes: fk.tubes,
		parts: fk.parts,
	};
}

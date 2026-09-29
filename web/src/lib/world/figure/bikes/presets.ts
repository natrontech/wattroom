/**
 * The frames a figure can ride (#3069, ADR-0073), from real geometry: the
 * rider studio's catalogue, as measured on the bikes they are modelled on.
 * Millimetres and degrees, at the size the figure's 1.8 m rider takes.
 */

export type FrameGeometry = {
	stack: number;
	reach: number;
	/** Head and seat angle, degrees from horizontal. */
	hta: number;
	sta: number;
	headTube: number;
	chainstay: number;
	bbDrop: number;
	forkOffset: number;
	/** 0 for a level top tube, which sets the seat tube itself. */
	seatTube: number;
	topTube: 'sloping' | 'level';
	/** How far down the head tube the top tube meets it; 24 unless said. */
	ttDrop?: number;
};

export type BarStyle = 'drop' | 'aero' | 'flare' | 'track' | 'tt' | 'upright';

/** How the rider sits on it: the fit solver's targets and the cockpit's ranges, metres. */
export type Cockpit = {
	bar: BarStyle;
	torsoDeg: number;
	shoulderDeg: number;
	stemDeg: number;
	spacer: [number, number];
	stem: [number, number];
	stemStyle?: 'quill';
};

export type FramePreset = {
	name: string;
	geometry: FrameGeometry;
	cockpit: Cockpit;
};

const DROP: Omit<Cockpit, 'torsoDeg'> = {
	bar: 'drop',
	shoulderDeg: 86,
	stemDeg: -6,
	spacer: [0.005, 0.035],
	stem: [0.08, 0.13],
};

const STEEL: FramePreset = {
	name: 'Stahlross',
	geometry: {
		stack: 560,
		reach: 383,
		hta: 73,
		sta: 73,
		headTube: 150,
		chainstay: 420,
		bbDrop: 70,
		forkOffset: 45,
		seatTube: 0,
		topTube: 'level',
	},
	cockpit: {
		bar: 'drop',
		stemStyle: 'quill',
		torsoDeg: 42,
		shoulderDeg: 86,
		stemDeg: -17,
		spacer: [0.03, 0.07],
		stem: [0.08, 0.12],
	},
};

export const FRAMES = {
	race: {
		name: 'Allrounder',
		geometry: {
			stack: 565,
			reach: 395,
			hta: 73.5,
			sta: 73.5,
			headTube: 146,
			chainstay: 410,
			bbDrop: 72,
			forkOffset: 44.4,
			seatTube: 480,
			topTube: 'sloping',
		},
		cockpit: { ...DROP, torsoDeg: 38 },
	},
	aero: {
		name: 'Windkanal',
		geometry: {
			stack: 555,
			reach: 400,
			hta: 73.5,
			sta: 73.5,
			headTube: 140,
			chainstay: 408,
			bbDrop: 72,
			forkOffset: 44,
			seatTube: 470,
			topTube: 'sloping',
		},
		cockpit: {
			bar: 'aero',
			torsoDeg: 34,
			shoulderDeg: 86,
			stemDeg: -10,
			spacer: [0.005, 0.025],
			stem: [0.09, 0.14],
		},
	},
	climb: {
		name: 'Bergfloh',
		geometry: {
			stack: 560,
			reach: 390,
			hta: 73.5,
			sta: 73.8,
			headTube: 150,
			chainstay: 405,
			bbDrop: 70,
			forkOffset: 43,
			seatTube: 520,
			topTube: 'sloping',
		},
		cockpit: { ...DROP, torsoDeg: 40 },
	},
	tt: {
		name: 'Zeitfahrer',
		geometry: {
			stack: 516,
			reach: 433,
			hta: 73,
			sta: 78,
			headTube: 105,
			chainstay: 405,
			bbDrop: 70,
			forkOffset: 45,
			seatTube: 470,
			topTube: 'sloping',
		},
		cockpit: {
			bar: 'tt',
			torsoDeg: 14,
			shoulderDeg: 90,
			stemDeg: -12,
			spacer: [0, 0.03],
			stem: [0.07, 0.13],
		},
	},
	gravel: {
		name: 'Kiesweg',
		geometry: {
			stack: 579,
			reach: 397,
			hta: 71,
			sta: 73.5,
			headTube: 165,
			chainstay: 435,
			bbDrop: 72,
			forkOffset: 50,
			seatTube: 500,
			topTube: 'sloping',
		},
		cockpit: {
			bar: 'flare',
			torsoDeg: 44,
			shoulderDeg: 86,
			stemDeg: -6,
			spacer: [0.005, 0.06],
			stem: [0.07, 0.12],
		},
	},
	steel: STEEL,
	zweihundert: { ...STEEL, name: 'Zweihundert' },
	track: {
		name: 'Bahnrad',
		geometry: {
			stack: 540,
			reach: 400,
			hta: 74,
			sta: 74,
			headTube: 125,
			chainstay: 390,
			bbDrop: 58,
			forkOffset: 35,
			seatTube: 500,
			topTube: 'sloping',
		},
		cockpit: {
			bar: 'track',
			torsoDeg: 34,
			shoulderDeg: 86,
			stemDeg: -10,
			spacer: [0, 0.02],
			stem: [0.09, 0.14],
		},
	},
	ordonnanz: {
		name: 'Ordonnanzrad 05',
		geometry: {
			stack: 650,
			reach: 330,
			hta: 68,
			sta: 70,
			headTube: 240,
			chainstay: 470,
			bbDrop: 62,
			forkOffset: 60,
			seatTube: 0,
			topTube: 'level',
			ttDrop: 75,
		},
		cockpit: {
			bar: 'upright',
			stemStyle: 'quill',
			torsoDeg: 66,
			shoulderDeg: 70,
			stemDeg: 10,
			spacer: [0.03, 0.12],
			stem: [0.03, 0.09],
		},
	},
} satisfies Record<string, FramePreset>;

export type FrameId = keyof typeof FRAMES;

/** Where each grip sits from the bar clamp, metres: forward, up, out to the right hand. */
export const BARS: Record<
	BarStyle,
	Record<'hoods' | 'drops' | 'tops', [number, number, number]>
> = {
	drop: {
		hoods: [0.105, 0.028, 0.2],
		drops: [-0.005, -0.118, 0.2],
		tops: [0, 0.006, 0.11],
	},
	aero: {
		hoods: [0.105, 0.03, 0.2],
		drops: [-0.005, -0.115, 0.2],
		tops: [0.012, 0.012, 0.12],
	},
	flare: {
		hoods: [0.098, 0.026, 0.2],
		drops: [-0.01, -0.108, 0.245],
		tops: [0, 0.006, 0.11],
	},
	track: {
		hoods: [0.072, -0.01, 0.19],
		drops: [-0.03, -0.14, 0.195],
		tops: [0, 0.005, 0.1],
	},
	tt: {
		hoods: [0.15, -0.024, 0.2],
		drops: [0.15, -0.024, 0.2],
		tops: [0.02, 0.004, 0.1],
	},
	upright: {
		hoods: [-0.155, 0.07, 0.262],
		drops: [-0.155, 0.07, 0.262],
		tops: [-0.155, 0.07, 0.262],
	},
};

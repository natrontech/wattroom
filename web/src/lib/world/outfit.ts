// A rider's look on the figure (#3156): their wardrobe loadout — the
// catalogue's items, its colours and its free choices — as the figure's kit,
// its slot colours and its jersey's pattern. Every kit colour passes the
// viewer's guard on the way (wardrobe/guard.ts), so what one viewer is shown
// never changes another's. A rider with no look wears a seeded one: the same
// on every screen, and their own until they choose.
import * as THREE from 'three';
import { hexToOklch } from '$lib/color';
import { catalogue, type Item } from '$lib/wardrobe/catalogue';
import { guarded, type Viewer } from '$lib/wardrobe/guard';
import type { FrameId } from './figure/bikes/presets';
import type { Palette } from './figure/figure';
import { patternIndex } from './figure/jersey';
import { FRAME_KITS, resolveKit, TYRES, WHEELS, type Kit } from './figure/kit';
import type { JerseyLook } from './figure/material';
import type { RiderKit } from './styles';
import { hexOf, STARTER, type Loadout } from './loadout';

export type Outfit = {
	kit: Kit;
	palette: Palette;
	jersey: JerseyLook;
	/** The wheels' decal. */
	decal: THREE.Color;
};

const items = new Map(catalogue.items.map((i) => [i.id, i]));
// The catalogue names more shapes than the figure draws: each that has no
// drawing of its own rides the nearest one that does.
const NEAR_FRAME: Record<string, FrameId> = {
	endurance: 'race',
	cross: 'gravel',
	hour: 'track',
	alu90: 'race',
	carbon03: 'climb',
	rando: 'steel',
};
const NEAR_WHEELS: Record<string, keyof typeof WHEELS> = {
	alloy: 'alloy30',
	carbon: 'carbon60',
	box: 'box32',
	gravel: 'gravel',
	disc: 'trispoke',
	blade3: 'trispoke',
	blade5: 'trispoke',
	army: 'army',
	vinyl: 'carbon30',
};
const NEAR_TYRES: Record<string, keyof typeof TYRES> = {
	tan: 'classic23',
	cream: 'classic23',
	knob: 'gravel45',
};
const NEAR_STYLE: Record<string, Record<string, string>> = {
	helmet: { tt: 'aero', hardshell: 'road' },
	glasses: { halfrim: 'wrap', gletscher: 'round' },
	shoes: { dial: 'road', strap: 'road', buckle: 'road', vintage: 'laced' },
	hair: { bun: 'ponytail', braid: 'ponytail', curls: 'short' },
	saddle: { cutout: 'race', lattice: 'race', suede: 'leather' },
	bars: { bullhorn: 'track', clipon: 'tt' },
};
const COUNT = ['none', 'one', 'two'] as const;

/** The item a loadout wears in a slot, the starter's where it names none. */
function itemIn(loadout: Loadout, slot: string): Item | undefined {
	const id = loadout[slot] ?? STARTER[slot];
	return typeof id === 'string' ? items.get(id) : undefined;
}
const tail = (item: Item | undefined) => item?.id.split('.')[1] ?? '';
function styled<T extends string>(
	loadout: Loadout,
	slot: string,
	fallback: T,
): T {
	const style = itemIn(loadout, slot)?.style;
	if (typeof style !== 'string') return fallback;
	return (NEAR_STYLE[slot]?.[style] ?? style) as T;
}

/** The figure's kit for a loadout: its shapes and parts, the nearest the figure draws. */
export function kitOf(loadout: Loadout): Kit {
	const frameId = tail(itemIn(loadout, 'frame'));
	const frame: FrameId =
		frameId in FRAME_KITS
			? (frameId as FrameId)
			: (NEAR_FRAME[frameId] ?? 'race');
	const params = { ...STARTER.params, ...loadout.params };
	const wheels = NEAR_WHEELS[tail(itemIn(loadout, 'wheels'))];
	const tyres = NEAR_TYRES[tail(itemIn(loadout, 'tyres'))];
	const gloves = tail(itemIn(loadout, 'gloves'));
	const finish = tail(itemIn(loadout, 'gsFinish'));
	const sockH = catalogue.params.sockH as Record<string, number>;
	return resolveKit(frame, {
		...(wheels ? { wheels: WHEELS[wheels] } : {}),
		...(tyres ? { tyres: TYRES[tyres] } : {}),
		bars: styled(loadout, 'bars', resolveKit(frame).bars),
		saddle: styled(loadout, 'saddle', resolveKit(frame).saddle),
		bottles: COUNT[Math.min(2, Math.max(0, Number(params.bottles) || 0))],
		groupset:
			finish === 'silver' || finish === 'anodised'
				? 'silver'
				: finish === 'copper'
					? 'copper'
					: 'black',
		jersey: { sleeves: params.sleeves === 'long' ? 'long' : 'short' },
		shorts: params.shortsLen === 'short' ? 'short' : 'knicker',
		helmet: styled(loadout, 'helmet', 'road'),
		glasses: styled(loadout, 'glasses', 'wrap'),
		socks: {
			height: sockH[String(params.sockH)] ?? sockH.mid,
			stripe: itemIn(loadout, 'socks')?.pattern !== 'plain',
		},
		shoes: styled(loadout, 'shoes', 'road'),
		gloves: gloves === 'none' ? 'none' : gloves === 'mitt' ? 'short' : 'full',
		hair: styled(loadout, 'hair', 'short'),
	});
}

/** The figure's look for a loadout, as `viewer` is shown it. */
export function outfitOf(
	loadout: Loadout,
	look: RiderKit,
	viewer: Viewer,
): Outfit {
	const colours = { ...STARTER.colours, ...loadout.colours };
	const kit = (name: string) =>
		new THREE.Color(guarded(hexOf.get(colours[name]) ?? look.metal, viewer));
	const fixed = (hex: string) => new THREE.Color(hex);
	let [a, b] = [kit('jerseyA'), kit('jerseyB')];
	const pattern = String(itemIn(loadout, 'jersey')?.pattern ?? 'plain');
	// Gipfelpunkte never puts dots on a white ground: a light main colour swaps with the dots.
	if (pattern === 'gipfelpunkte' && hexToOklch(`#${a.getHexString()}`).l > 0.85)
		[a, b] = [b, a];
	const finish = tail(itemIn(loadout, 'gsFinish'));
	return {
		kit: kitOf(loadout),
		palette: {
			jersey: a,
			jerseyAccent: b,
			helmet: kit('helmet'),
			helmetAccent: kit('helmetAccent'),
			// The neutral figure until the rider chooses a skin (ADR-0073, #3413).
			skin: fixed(
				loadout.skin ? (hexOf.get(loadout.skin) ?? look.skin) : look.skin,
			),
			hair: kit('hair'),
			shorts: kit('shorts'),
			shortsAccent: kit('shortsAccent'),
			sock: kit('socks'),
			sockAccent: kit('sockAccent'),
			shoe: kit('shoes'),
			sole: fixed(look.tyre),
			glove: kit('gloves'),
			glasses: fixed(look.glasses),
			lens: fixed(look.glasses),
			frame: kit('frame'),
			frameAccent: kit('frameAccent'),
			saddle: kit('saddle'),
			barTape: kit('barTape'),
			hood: fixed(look.tyre),
			leather: kit('saddle'),
			bottle: kit('bottle'),
			bottleCap: fixed(look.tyre),
			tyre: fixed(look.tyre),
			tyreWall: kit('tyreWall'),
			rim: fixed(look.rim),
			spokes: fixed(look.metal),
			metal: fixed(look.metal),
			groupset:
				finish === 'anodised'
					? kit('anodised')
					: fixed(finish === 'black' ? look.tyre : look.metal),
			chain: fixed(look.metal),
		},
		jersey: { pattern: patternIndex(pattern), b, c: kit('jerseyC') },
		decal: kit('decal'),
	};
}

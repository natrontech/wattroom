/**
 * The sizes of what is built along a designed road (structures.ts) that the
 * world reads without drawing it: where nothing may stand, where the camera
 * keeps under a roof, how far the ground is left closed over a tunnel.
 * Three-free, so world.ts and the ground's worker read them as they are.
 * Heights are the scene's (yOf: metres of height times EXAG), widths metres.
 */
import { FORMATION } from './terrain/road-profile';

/** A tunnel's tube: its half width inside, its walls' height and the vault's crown over the road, and its concrete shell's thickness. */
export const TUBE = { half: FORMATION + 0.4, wall: 4.2, crown: 7, shell: 0.7 };
/** A tunnel's portal: its face's half width (over the cutting's bench, to the foot of its slope), its height over the road, and how far round it nothing stands. */
export const PORTAL = { half: 12.5, up: 9.5, clear: 20 };
/** A gallery: its roof's clear height and thickness, how far past the formation it reaches, metres between its pillars, and how far out behind it its earth is banked onto the hill at the most. */
export const GALLERY = { clear: 5, thick: 1, out: 0.9, pillars: 6, ramp: 22 };
/** Metres the camera keeps under a roof's underside: a tunnel's vault or a gallery's slab. */
export const UNDER_ROOF = 0.8;
/** How far past its face a gallery's back wall and its roof reach into the hill behind it. */
export const GALLERY_BACK = 3.8;
/** A tunnel's portal: the metres of it built cut-and-cover, the ground cut down beside it as at the road before, before the hill closes over it (terrain/lines.ts Line.bore). Past a 10 m cell's diagonal, so no cell of the hill's lies over the road outside the portal. */
export const PORTAL_M = 16;
/** The ground's cut-outs at tunnels' portals (styles.ts uBores, structures.ts boreBoxes), at the most: three a portal, two portals a tunnel. */
export const BORE_BOXES = 18;

/**
 * The ride camera's depth range. At near 0.5 m the 24-bit depth buffer resolved
 * 0.12 m at 1 km and the road's shoulder z-fought from about 1.26 km (#3078);
 * the placement gates (#3220 O6) hold the near plane at 1 m or more.
 */
export const CAMERA = { near: 1, far: 60_000 } as const;

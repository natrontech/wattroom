"""Cut Chakra Petch's figures into a face where every figure has one advance (#3922).

Chakra Petch has no `tnum` feature, so `tabular-nums` does nothing. This keeps
the ten figures only, drops layout tables (kerning would undo the equal
advance), widens each figure to the widest one's advance and centres its ink.

  pnpm --dir web install   # the source woff2 come from @fontsource/chakra-petch
  uv run --no-project --with fonttools --with brotli python web/scripts/tabular-figures.py
"""

import pathlib

from fontTools import subset
from fontTools.ttLib import TTFont

WEB = pathlib.Path(__file__).resolve().parent.parent
SOURCE = WEB / "node_modules/@fontsource/chakra-petch/files"
OUT = WEB / "src/lib/fonts"
FAMILY = "WattRoom Figures"


def cut(weight: int) -> None:
    font = TTFont(SOURCE / f"chakra-petch-latin-{weight}-normal.woff2")
    options = subset.Options()
    options.layout_features = []
    options.flavor = "woff2"
    options.name_IDs = [0, 13, 14]  # copyright and OFL, which travel with a modified version
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=range(0x30, 0x3A))
    subsetter.subset(font)

    cmap = font.getBestCmap()
    figures = [cmap[c] for c in range(0x30, 0x3A)]
    hmtx, glyf = font["hmtx"], font["glyf"]
    width = max(hmtx[g][0] for g in figures)
    for g in figures:
        advance, lsb = hmtx[g]
        dx = (width - advance) // 2
        glyph = glyf[g]
        if glyph.isComposite():
            for component in glyph.components:
                component.x += dx
        elif glyph.numberOfContours:
            glyph.coordinates.translate((dx, 0))
        glyph.recalcBounds(glyf)
        hmtx[g] = (width, lsb + dx)

    name = font["name"]
    name.setName(FAMILY, 1, 3, 1, 0x409)
    name.setName(f"{FAMILY} {weight}", 4, 3, 1, 0x409)
    name.setName(f"WattRoomFigures-{weight}", 6, 3, 1, 0x409)
    font.save(OUT / f"wattroom-figures-{weight}.woff2")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for weight in (500, 700):
        cut(weight)

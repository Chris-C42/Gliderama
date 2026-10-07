"""
Pixelify Sans draws its 5 as an S (a rounded top with a hook down its right side), so "5.6 g" reads "S.6 g". This
makes a one-glyph companion font with a 5 that reads as one: a flat top, a straight stem down to the middle bar,
and the bowl of the font's own 6 underneath, on the same pixel grid and stroke weights (400 and 700). The app
declares it as a later @font-face of 'Pixelify Sans' for U+0035 alone (src/ui/styles/theme.css), so every other
character, in CSS and on canvas, is the original font's.

Pixelify Sans is under the SIL Open Font License 1.1 (src/ui/fonts/OFL.txt); so is this modified version.

    pip install fonttools brotli
    python3 -I scripts/fonts/make-five.py
"""

from pathlib import Path

from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-{w}-normal.woff2'
OUT = ROOT / 'src/ui/fonts/pixelify-five-{w}.woff2'

# The 5, one clockwise contour per weight, in the font's units: up the bottom-left hook, along the inside of the
# bowl, up the stem, across the top, down the inside of the stem, along the middle bar and down the outside of the
# bowl. The numbers are the font's own: its 6 for the middle bar and the bowl, its S for the hook, its 0 for the top.
FIVE = {
    400: [(151, -12), (151, 78), (60, 78), (60, 179), (161, 179), (161, 88), (423, 88), (423, 260), (60, 260),
          (60, 631), (525, 631), (525, 530), (161, 530), (161, 359), (433, 359), (433, 270), (525, 270), (525, 78),
          (433, 78), (433, -12)],
    700: [(149, -11), (149, 74), (61, 74), (61, 211), (188, 211), (188, 125), (414, 125), (414, 246), (61, 246),
          (61, 638), (542, 638), (542, 501), (188, 501), (188, 381), (453, 381), (453, 297), (542, 297), (542, 74),
          (453, 74), (453, -11)],
}

NOTICE = 'Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans). Digit 5 redrawn for Gliderama.'
LICENSE = 'This Font Software is licensed under the SIL Open Font License, Version 1.1.'


def make(weight: int) -> None:
    font = TTFont(str(SRC).format(w=weight))
    pen = TTGlyphPen(font.getGlyphSet())
    pts = FIVE[weight]
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()
    font['glyf']['five'] = pen.glyph()
    adv, _ = font['hmtx']['five']
    font['hmtx']['five'] = (adv, min(x for x, _ in pts))

    opts = Options()
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.layout_features = []
    opts.notdef_outline = True
    opts.flavor = 'woff2'
    sub = Subsetter(opts)
    sub.populate(unicodes=[0x35])
    sub.subset(font)

    style = 'Regular' if weight == 400 else 'Bold'
    names = font['name']
    for rec in list(names.names):
        if rec.nameID not in (0, 2, 5, 13, 14):
            names.removeNames(nameID=rec.nameID)
    for nid, text in {0: NOTICE, 1: 'Gliderama Five', 2: style, 3: f'Gliderama Five {style}', 4: f'Gliderama Five {style}',
                      6: f'GlideramaFive-{style}', 13: LICENSE, 14: 'https://openfontlicense.org'}.items():
        names.setName(text, nid, 3, 1, 0x409)
    font.flavor = 'woff2'
    font.save(str(OUT).format(w=weight))
    print(OUT.name.format(w=weight), Path(str(OUT).format(w=weight)).stat().st_size, 'bytes')


for w in FIVE:
    make(w)

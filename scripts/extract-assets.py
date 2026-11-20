#!/usr/bin/env python3
"""
Extract the card / board art used by the web UI from the colorized
Secret Hitler print-and-play PDF (and the wordmark from the rulebook PDF).

    python3 scripts/extract-assets.py \
        "Secret_Hitler_-_Print_and_Play_-_Color_-_A4_Scaled_-_with_Rules.pdf" \
        "Secret_Hitler_Rules.pdf"

Output: public/cards/*.webp

Requires: poppler-utils (pdfimages, pdftoppm), Pillow, numpy, scipy.

Why this works: the first 8 pages of the colorized PDF are full-page 300 ppi
rasters, so `pdfimages` gives pixel-perfect source art. Cards are found as
connected components (or, for the hollow Party Membership cards, from the
printed cut-line grid), cropped, rotated upright, given transparent rounded
corners (flood fill from the outside, so the printed frames stay intact) and
saved as WebP.

The printed sheets contain duplicate cards (6 Liberal roles, 3 Fascist roles,
10 Ja!, ...). They are pixel-identical apart from print texture, so one of each
is exported.

Game art: Secret Hitler by Goat, Wolf & Cabbage (Mike Boxleiter, Tommy
Maranges, Mac Schubert), CC BY-NC-SA 4.0.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "cards"

PAPER = np.array([253, 253, 253])
INK = (0x56, 0x46, 0x50)


# --------------------------------------------------------------------------- helpers
def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def load(path: Path, mode: str = "RGB") -> Image.Image:
    return Image.open(path).convert(mode)


def paper_distance(arr: np.ndarray) -> np.ndarray:
    return np.abs(arr.astype(int) - PAPER).sum(axis=2)


def find_boxes(img: Image.Image, min_area: int = 40000):
    """Bounding boxes of solid shapes on the page (thin cut lines are removed by opening)."""
    mask = paper_distance(np.asarray(img)) > 60
    mask = ndi.binary_opening(mask, structure=np.ones((11, 11)))
    mask = ndi.binary_closing(mask, structure=np.ones((25, 25)))
    lab, _ = ndi.label(mask)
    boxes = []
    for sl in ndi.find_objects(lab):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w >= min_area:
            boxes.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    return boxes


def grid_order(boxes, row_tol: int = 200):
    return sorted(boxes, key=lambda b: (round(b[1] / row_tol), b[0]))


def cut_outside(img: Image.Image, tol: int = 24, band: int = 26) -> Image.Image:
    """Make the paper outside a card's rounded corners transparent.

    Flood fill from the outside, but only inside a thin band along the crop
    edge: the printed frame stops it, and a printed "tear" streak can't carry it
    into inner frame lines or white interiors (Ja! ballot, President placard).
    One extra ring of fringe is removed, then colours are bled outward so
    resampling does not create halos.
    """
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    in_band = (np.minimum(xx, w - 1 - xx) < band) | (np.minimum(yy, h - 1 - yy) < band)
    near_paper = (paper_distance(rgb) < tol) & in_band
    lab, _ = ndi.label(near_paper)
    border_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(border_labels))
    outside = ndi.binary_dilation(outside, iterations=1)
    idx = ndi.distance_transform_edt(outside, return_distances=False, return_indices=True)
    bled = rgb[idx[0], idx[1]]
    rgba = np.dstack([bled, np.where(outside, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def save(img: Image.Image, name: str, width: int | None = None, quality: int = 90) -> None:
    if width and img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    img.save(path, "WEBP", quality=quality, alpha_quality=100, method=6)
    print(f"  {name:34s} {img.width:>5}x{img.height:<5} {path.stat().st_size / 1024:6.1f} KB")


def crop(img: Image.Image, box, pad: int = 0) -> Image.Image:
    x0, y0, x1, y1 = box
    return img.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))


def rotate_cw(img: Image.Image) -> Image.Image:
    return img.transpose(Image.Transpose.ROTATE_270)


def key_on_light(img: Image.Image, fg: tuple[int, int, int], bg=(253, 253, 253)) -> Image.Image:
    """Single-colour art on a light background -> `fg` with alpha (tints become partial alpha)."""
    g = np.asarray(img.convert("RGB"))[..., 1].astype(float)
    a = np.clip((bg[1] - g) / (bg[1] - fg[1]), 0, 1)
    out = np.zeros(g.shape + (4,), np.uint8)
    out[..., :3] = fg
    out[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def key_on_dark(img: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """White art on a flat coloured background -> white with alpha."""
    g = np.asarray(img.convert("RGB"))[..., 1].astype(float)
    a = np.clip((g - bg[1]) / (253 - bg[1]), 0, 1)
    out = np.zeros(g.shape + (4,), np.uint8)
    out[..., :3] = 255
    out[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def tight_alpha_box(img: Image.Image, pad: int = 6):
    a = np.asarray(img)[..., 3]
    ys, xs = np.where(a > 8)
    return (max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad, img.width), min(ys.max() + pad, img.height))


def sample(img: Image.Image, x: int, y: int):
    return tuple(int(v) for v in np.asarray(img.convert("RGB"))[y, x])


def icon_bbox(mask: np.ndarray, window, min_dim: int, min_thick: float = 8.0):
    """Bbox of the icon parts of `mask` inside `window`, plus a keep-mask.

    Parts are connected components that are big (`min_dim`) and thick somewhere
    (`min_thick` = max distance to the background, i.e. half the stroke width).
    That drops printed dotted divider lines and caption letters (strokes <= ~10 px
    wide, so half-thickness <= 5) without eroding the icon's own thin strokes.
    Returns the bbox and a keep-mask in absolute page coordinates (kept parts
    grown by a few px) so callers can blank anything else inside the crop.
    """
    x0, y0, x1, y1 = window
    sub = mask[y0:y1, x0:x1]
    lab, n = ndi.label(sub, structure=np.ones((3, 3)))
    dt = ndi.distance_transform_edt(sub)
    thick = ndi.maximum(dt, lab, index=np.arange(1, n + 1)) if n else []
    kept, boxes = [], []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if max(h, w) >= min_dim and thick[i - 1] >= min_thick:
            kept.append(i)
            boxes.append((x0 + sl[1].start, y0 + sl[0].start, x0 + sl[1].stop, y0 + sl[0].stop))
    if not boxes:
        raise RuntimeError(f"no component in {window}")
    grown = ndi.binary_dilation(np.isin(lab, kept), iterations=3)
    full = np.zeros_like(mask)
    full[y0:y1, x0:x1] = grown
    bbox = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    return bbox, full


def apply_keep(rgba: Image.Image, keep: np.ndarray, box, pad: int) -> Image.Image:
    """Zero the alpha of everything in the crop that is not part of the icon."""
    x0, y0, x1, y1 = box
    k = keep[y0 - pad : y1 + pad, x0 - pad : x1 + pad]
    arr = np.asarray(rgba).copy()
    arr[..., 3] = np.where(k, arr[..., 3], 0)
    return Image.fromarray(arr, "RGBA")


def drop_specks(img: Image.Image, big: int = 400, reach: int = 24) -> Image.Image:
    """Remove stray print specks: small blobs that are not close to the main art."""
    arr = np.asarray(img).copy()
    lab, n = ndi.label(arr[..., 3] > 40, structure=np.ones((3, 3)))
    sizes = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    main = np.isin(lab, [i for i, sz in enumerate(sizes, start=1) if sz >= big])
    near_main = ndi.binary_dilation(main, iterations=reach)
    for i, sz in enumerate(sizes, start=1):
        if sz < big and not near_main[lab == i].any():
            arr[lab == i, 3] = 0
    return Image.fromarray(arr, "RGBA")


def line_positions(profile: np.ndarray, threshold: float) -> list[int]:
    idx = np.where(profile > threshold)[0]
    groups, start, prev = [], None, None
    for v in idx:
        if start is None:
            start = prev = v
        elif v == prev + 1:
            prev = v
        else:
            groups.append((start + prev) // 2)
            start = prev = v
    if start is not None:
        groups.append((start + prev) // 2)
    return groups


# --------------------------------------------------------------------------- extraction
def extract_cards(raw: Path) -> None:
    print("policy tiles")
    tiles = load(raw / "pg-003.png")
    boxes = grid_order(find_boxes(tiles), row_tol=150)
    assert len(boxes) == 17, len(boxes)
    # first 11 in reading order by colour are Fascist, remaining 6 Liberal: classify by colour instead
    def is_red(b):
        c = np.asarray(tiles.crop(b)).reshape(-1, 3).mean(axis=0)
        return c[0] > c[2]
    fas = next(b for b in boxes if is_red(b))
    lib = next(b for b in boxes if not is_red(b))
    # Tiles are printed landscape with text running bottom-to-top: rotate to read upright.
    for name, b in (("tile-fascist.webp", fas), ("tile-liberal.webp", lib)):
        save(rotate_cw(cut_outside(crop(tiles, b, 3))), name, width=400)

    print("secret role cards")
    roles = load(raw / "pg-004.png")
    boxes = grid_order(find_boxes(roles), row_tol=300)
    assert len(boxes) == 10, len(boxes)
    # Sheet order: L L L H F / L L L F F
    save(cut_outside(crop(roles, boxes[0], 3)), "role-liberal.webp", width=540)
    save(cut_outside(crop(roles, boxes[3], 3)), "role-hitler.webp", width=540)
    save(cut_outside(crop(roles, boxes[4], 3)), "role-fascist.webp", width=540)

    print("party membership cards (hollow: use the printed cut-line grid)")
    party = load(raw / "pg-005.png")
    arr = paper_distance(np.asarray(party)) > 8
    # Cut lines run the full width/height of the grid; artwork never does.
    vlines = line_positions(arr[230:1920].mean(axis=0), 0.95)
    hlines = line_positions(arr[:, 140:3220].mean(axis=1), 0.95)
    assert len(vlines) == 6 and len(hlines) == 3, (vlines, hlines)
    inset = 7

    def cell(col: int, row: int):
        return (vlines[col] + inset, hlines[row] + inset, vlines[col + 1] - inset, hlines[row + 1] - inset)

    save(party.crop(cell(0, 0)), "party-liberal.webp", width=520)
    save(party.crop(cell(1, 0)), "party-fascist.webp", width=520)

    print("ballots")
    ja = load(raw / "pg-006.png")
    nein = load(raw / "pg-007.png")
    jb = grid_order(find_boxes(ja), row_tol=300)
    nb = grid_order(find_boxes(nein), row_tol=300)
    # Page 7/8 also yields inner glyph boxes for Ja!; keep the full-size card boxes only.
    jb = [b for b in jb if (b[2] - b[0]) > 500]
    nb = [b for b in nb if (b[2] - b[0]) > 500]
    assert len(jb) == 10 and len(nb) == 10, (len(jb), len(nb))
    # Printed with text running bottom-to-top: rotate upright (landscape cards).
    ja_img = rotate_cw(cut_outside(crop(ja, jb[0], 3)))
    nein_img = rotate_cw(cut_outside(crop(nein, nb[0], 3)))
    # The two sheets differ by <1% in size; normalise so the pair always matches.
    size = (780, 540)
    save(ja_img.resize(size, Image.LANCZOS), "ballot-ja.webp", width=520)
    save(nein_img.resize(size, Image.LANCZOS), "ballot-nein.webp", width=520)

    print("placards")
    pl = load(raw / "pg-001.png")
    mask = load(raw / "pg-002.png", "L")  # soft mask carries the printed distress specks
    flat = Image.composite(pl, Image.new("RGB", pl.size, tuple(int(v) for v in PAPER)), mask)
    boxes = [b for b in find_boxes(flat, min_area=300000) if (b[3] - b[1]) > 1500]
    boxes.sort(key=lambda b: b[0])
    assert len(boxes) == 2, boxes
    chancellor, president = boxes
    save(rotate_cw(cut_outside(crop(flat, chancellor, 3))), "placard-chancellor.webp", width=900)
    save(rotate_cw(cut_outside(crop(flat, president, 3))), "placard-president.webp", width=900)


def extract_board_icons(raw: Path) -> None:
    print("board icons")
    board = load(raw / "pg-000.png")
    arr = np.asarray(board)
    red_bg = sample(board, 2000, 500)  # slot 4 background (Fascist red)
    blue_bg = sample(board, 2700, 1900)  # Liberal win-slot background
    red_ink = (0xC5, 0x70, 0x70)  # icon red on the paper-coloured slots
    print("   red slot", red_bg, "blue slot", blue_bg)

    not_paper = paper_distance(arr) > 45
    # Search windows in the 3313x2353 page image. The thick board frame ends at y=209,
    # so the first window starts below it.
    def icon(name, mask, window, keyfn, bg_or_ink, min_dim=40, width=200, min_thick=8.0):
        box, keep = icon_bbox(mask, window, min_dim, min_thick)
        out = apply_keep(keyfn(crop(board, box, 6), bg_or_ink), keep, box, 6)
        save(drop_specks(out), name, width=width)

    # The stack's thin upper sheets need min_thick=0; its window is clear of dividers and captions.
    icon("icon-peek.webp", not_paper, (1300, 212, 1540, 358), key_on_light, red_ink, min_thick=0)
    icon("icon-special-election.webp", not_paper, (1300, 430, 1540, 548), key_on_light, red_ink)
    icon("icon-investigate.webp", not_paper, (840, 430, 1010, 580), key_on_light, red_ink)

    # White-on-red art: bullet and the skull + snake emblem.
    light = arr[..., 1].astype(int) > red_bg[1] + 25
    icon("icon-execute.webp", light, (1780, 340, 2040, 600), key_on_dark, red_bg)
    icon("emblem-fascist.webp", light, (2680, 300, 3100, 790), key_on_dark, red_bg, width=420)

    # White-on-blue dove and wreath (Liberal win slot). Window starts right of the
    # track's arrow bubble (x<=2420).
    lightb = arr[..., 1].astype(int) > blue_bg[1] + 25
    icon("emblem-liberal.webp", lightb, (2428, 1620, 2870, 2040), key_on_dark, blue_bg, min_dim=60, width=420)


def extract_wordmark(rulebook: Path, work: Path) -> None:
    print("wordmark + emblem (rulebook cover)")
    run("pdftoppm", "-r", "300", "-f", "1", "-l", "1", "-png", str(rulebook), str(work / "cover"))
    cover = load(next(work.glob("cover-*.png")))
    arr = np.asarray(cover).astype(int)
    dark = arr.sum(axis=2) < 450

    # Wordmark: big block, transparent outside / white letter faces kept.
    mark, _ = icon_bbox(dark, (200, 700, 2350, 2300), 600, min_thick=0)
    save(cut_outside(crop(cover, mark, 6), tol=40), "wordmark.webp", width=900)

    # Neutral emblem (sword + olive branch, the middle icon of the trio), tinted ink.
    trio_y0, trio_y1 = 2350, 2950
    mid, _ = icon_bbox(dark, (1000, trio_y0, 1500, trio_y1), 300, min_thick=0)
    sub = np.asarray(crop(cover, mid, 4).convert("L")).astype(float)
    alpha = np.clip((255 - sub) / (255 - 56), 0, 1)
    out = np.zeros(sub.shape + (4,), np.uint8)
    out[..., :3] = INK
    out[..., 3] = (alpha * 255).astype(np.uint8)
    emblem = Image.fromarray(out, "RGBA")
    save(emblem, "emblem-neutral.webp", width=360)
    return emblem


def make_backs(emblem: Image.Image) -> None:
    """Card backs: no back art exists in the PDFs, so build one from printed parts.

    Paper face, the Ja! ballot's double-line frame (outer heavy line + inner
    thin line), rounded corners, and the neutral sword/olive emblem in ink.
    """
    print("card backs (built from the printed frame + emblem)")
    S = 3  # supersample

    def back(w: int, h: int, name: str) -> None:
        from PIL import ImageDraw

        W, H = w * S, h * S
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        paper = (246, 241, 236, 255)
        brown = INK + (255,)
        r = int(0.045 * W)
        d.rounded_rectangle((0, 0, W - 1, H - 1), r, fill=paper)
        d.rounded_rectangle((0, 0, W - 1, H - 1), r, outline=brown, width=int(0.028 * W))
        m = int(0.075 * W)
        d.rounded_rectangle((m, m, W - 1 - m, H - 1 - m), int(0.02 * W), outline=brown, width=max(2, int(0.008 * W)))
        e = emblem.copy()
        scale = 0.46 * W / e.width
        e = e.resize((int(e.width * scale), int(e.height * scale)), Image.LANCZOS)
        img.alpha_composite(e, ((W - e.width) // 2, (H - e.height) // 2))
        save(img.resize((w, h), Image.LANCZOS), name)

    back(540, 789, "card-back.webp")  # role / party proportion
    back(400, 611, "tile-back.webp")  # policy tile proportion


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    colorized, rulebook = Path(sys.argv[1]), Path(sys.argv[2])
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        raw = work / "raw"
        raw.mkdir()
        run("pdfimages", "-png", str(colorized), str(raw / "pg"))
        extract_cards(raw)
        extract_board_icons(raw)
        emblem = extract_wordmark(rulebook, work)
        make_backs(emblem)
    print("done ->", OUT)


if __name__ == "__main__":
    main()

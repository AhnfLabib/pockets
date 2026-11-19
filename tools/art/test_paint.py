"""Checks on the committed artwork. File-only: nothing here imports the vendored drawing code.

Run from the repository root: python3 -m pytest tools/art -q
"""
import json

import numpy as np
from PIL import Image


def test_outputs():
    meta = json.load(open('assets/sprites/sprites.json'))
    assert set(meta['parts']) == {'head','body','tail','legUpper','legLower','paw','scarf'}
    sizes = {Image.open(f'assets/sprites/sheet-{i}.png').size for i in range(3)}
    assert len(sizes) == 1


def test_no_paper_fringe():           # spec fault 3
    im = np.asarray(Image.open('assets/sprites/sheet-0.png').convert('RGBA')).astype(float)
    edge = (im[..., 3] > 10) & (im[..., 3] < 200)
    assert im[edge][:, :3].mean() < 110          # edge pixels are ink, not cream paper


def test_icons():
    for n in (16, 32, 48, 128):
        im = Image.open(f'assets/icons/icon-{n}.png'); assert im.size == (n, n) and im.mode == 'RGBA'
    assert Image.open('assets/icons/icon-128.png').getpixel((0, 0))[3] == 0     # rounded corner is clear


# ---- additions beyond the brief's three tests

def _part(name, sheet=0):
    meta = json.load(open('assets/sprites/sprites.json'))
    p = meta['parts'][name]
    im = np.asarray(Image.open(f'assets/sprites/sheet-{sheet}.png').convert('RGBA')).astype(float)
    return meta['scale'], p, im[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']]


def test_tail_is_one_piece_56px_long():   # spec fault 1
    s, p, crop = _part('tail')
    row = crop[int(round(p['oy'] * s)), :, 3]          # the tail's centre line
    base = int(round(p['ox'] * s))
    tip = base - 56 * s
    assert tip > 0, 'crop holds the whole 56 px'
    assert (row[tip + 2:base] > 230).all(), 'opaque all the way from base to tip: one piece, no gaps'
    beyond = row[:max(0, tip - s)]                     # past the tip and its outline (under 1 px): clear
    assert beyond.size > 0 and beyond.max() < 10


def test_legs_are_painted_not_strokes():  # spec fault 2
    for name in ('legUpper', 'legLower'):
        s, p, crop = _part(name)
        solid = crop[..., 3] > 230
        lum = crop[..., :3].mean(-1)
        fur = solid & (lum > 70)                       # coloured paint, not just ink
        assert fur.sum() > 0.3 * solid.sum(), name


def test_sheets_differ_in_brushwork():
    a, b = (np.asarray(Image.open(f'assets/sprites/sheet-{i}.png').convert('RGBA')).astype(float) for i in (0, 1))
    assert np.abs(a - b).mean() > 0.5


def test_no_paper_inside_parts():         # spec fault 3: opaque cream slivers along the lines count too
    for i in range(3):
        a = np.asarray(Image.open(f'assets/sprites/sheet-{i}.png').convert('RGBA')).astype(int)
        r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
        paper = (al > 0) & (r - b > 20) & ((r + g + b) / 3 > 150)    # warm and pale, like the paper #f0e7d5
        assert paper.sum() == 0, (i, int(paper.sum()))


def test_crops_have_clear_gutters():      # rotated drawImage samples just outside a crop
    meta = json.load(open('assets/sprites/sprites.json'))
    for i in range(3):
        a = np.asarray(Image.open(f'assets/sprites/sheet-{i}.png').convert('RGBA'))[..., 3]
        for name, p in meta['parts'].items():
            c = a[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']]
            assert max(c[:2].max(), c[-2:].max(), c[:, :2].max(), c[:, -2:].max()) <= 1, (i, name)

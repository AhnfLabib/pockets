"""Paint the toolbar icon at 512 px for the promo video, with the same code and seed as assets/icons/icon-128.png
(tools/art/paint.py: icon_full, seed 12). Run from the repository root: python3 -I tools/promo-video/capture/icon512.py"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'art'))
import paint  # noqa: E402

out = os.path.join(ROOT, 'tools', 'promo-video', 'public', 'icon-512.png')
paint.shrink(*paint.render_icon(paint.icon_full, 12), 512).save(out, optimize=True)
print(out)

"""Builds the intro's storyboard.png, storyboard.md and LinkedIn stills from out/intro/frames (intro-stills.mjs)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

proj = Path(__file__).resolve().parent.parent
frames = proj / "out/intro/frames"
out = proj / "out/intro"
idx = json.loads((frames / "index.json").read_text())
fps = idx["fps"]
ts = lambda f: f"{f / fps:.1f} s"

def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for p in (f"/usr/share/fonts/opentype/inter/Inter-{weight}.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + ([cur] if cur else [])

# Storyboard: 5 x 2 grid of key frames, each labelled with its time, what it shows and the caption on screen.
tw, th, pad, lab = 360, 640, 28, 150
cols, sb = 5, idx["storyboard"]
rows = (len(sb) + cols - 1) // cols
sheet = Image.new("RGB", (pad + cols * (tw + pad), 120 + rows * (th + lab + pad)), "#ffffff")
d = ImageDraw.Draw(sheet)
d.text((pad, 34), f"Pockets intro: storyboard ({ts(idx['duration'])}, 1080x1920, 30 fps)", font=font("Bold", 40), fill="#1c2230")
for i, s in enumerate(sb):
    x, y = pad + (i % cols) * (tw + pad), 120 + (i // cols) * (th + lab + pad)
    im = Image.open(frames / s["file"]).convert("RGB").resize((tw, th), Image.LANCZOS)
    sheet.paste(im, (x, y))
    d.rectangle((x, y, x + tw - 1, y + th - 1), outline="#cfd4dc")
    d.text((x, y + th + 10), f"{i + 1}. {ts(s['frame'])} · {s['label']}", font=font("Bold", 21), fill="#c93c30")
    cap = s["caption"].replace("\n", " ")
    for k, ln in enumerate(wrap(d, f"“{cap}”", font("Medium", 20), tw)[:4]):
        d.text((x, y + th + 42 + k * 26), ln, font=font("Medium", 20), fill="#1c2230")
sheet.save(out / "storyboard.png")

# Stills: full portrait and a 1080 square cut at the still's chosen top, both PNG RGB.
st = out / "stills"
st.mkdir(exist_ok=True)
for s in idx["stills"]:
    im = Image.open(frames / f"still-{s['name']}.png").convert("RGB")
    im.save(st / f"{s['name']}-portrait-1080x1920.png")
    top = s["squareTop"]
    im.crop((0, top, 1080, top + 1080)).save(st / f"{s['name']}-square-1080x1080.png")

# storyboard.md: every scene and caption with its timing.
md = [f"# Pockets intro: storyboard", "", f"Composition `Intro-Portrait`, 1080x1920, 30 fps, {idx['duration']} frames ({ts(idx['duration'])}). "
      f"Scenes crossfade over {idx['fade']} frames. Music: Upbeat Inspiring Corporate (promo-video skill), volume 0.30, 0.2 s fade in, 1.5 s fade out. No voiceover.", "",
      "## Beats", "", "| Time | Scene | On screen | Caption |", "|---|---|---|---|"]
dm = idx["demo"]
what = {
    "Too many tabs?": "Real character page, 32 cramped favicon-only tabs. Opens close on the strip and pulls back; Pockets pokes in from the left with “You weren't using that, were you?” and climbs (1.5x, then about 1.8x).",
    "He gives you five seconds.": "Push in on the real warning card: “Mine in 5…” / Keep this tab. The countdown runs at real speed.",
    "Keep the tab, or it’s his.": "Countdown continues to “Mine in 1…”; the YouTube tab's icon has turned into Pockets.",
    "He takes it and runs.": "He grabs the tab and bolts with it in his mouth; the notice “Pockets took YouTube · Undo” appears.",
    "Undo brings it back.": "Pointer presses Undo; “YouTube is back on the bar.”",
    "Pockets never takes": "Three rows land in turn: Pinned tabs, Tabs you've typed in, Your last tab.",
    "Working mode": "The real toolbar popup; the pointer flips the Working switch on at 0.7 s.",
    "Everything stays in your browser.": "Lock badge.",
    "Pockets: the tab-stealing raccoon": "Icon, name, pill. Holds to the last frame.",
}
for l in idx["lines"]:
    end = l["absTo"] if l["absTo"] is not None else next(s["start"] + s["frames"] for s in idx["scenes"] if s["id"] == l["scene"])
    cap = l["text"] + (f" / {l['sub']}" if l.get("sub") else "")
    md.append(f"| {ts(l['absFrom'])}–{ts(end)} | {l['scene']} | {what.get(l['text'], '')} | {cap.replace(chr(10), ' ')} |")
md += ["", "## Key frames (storyboard.png)", ""]
md += [f"{i + 1}. {ts(s['frame'])}: {s['label']}" for i, s in enumerate(sb)]
md += ["", "## Stills (stills/)", ""]
md += [f"- `{s['name']}`: {ts(s['frame'])}, portrait 1080x1920 and square 1080x1080 (cut from y={s['squareTop']})" for s in idx["stills"]]
(out / "storyboard.md").write_text("\n".join(md) + "\n")
print("ok", out)

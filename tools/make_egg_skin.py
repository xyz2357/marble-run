"""Bake the user's egg photo (public/textures/egg.webp) into an equirectangular skin for the
lathe egg (public/textures/egg-skin.png). The photo is projected onto the front half of the egg;
everything else (back, rim, background pixels) is filled with the egg's own shell colour."""
import math
from PIL import Image

SRC = 'public/textures/egg.webp'
DST = 'public/textures/egg-skin.png'
WAIST, ROUND, POINT = 0.135, 0.15, 0.21  # must match src/game/marble.ts
W, H = 1024, 512

img = Image.open(SRC).convert('RGBA')
iw, ih = img.size
px = img.load()
print('source', iw, ih, img.mode)

def is_bg(p):
    r, g, b, a = p
    return a < 128 or (r > 235 and g > 235 and b > 235)

# Egg silhouette bbox and shell colour (median of non-ink egg pixels).
xs, ys, shell = [], [], []
for y in range(ih):
    for x in range(iw):
        p = px[x, y]
        if is_bg(p):
            continue
        xs.append(x)
        ys.append(y)
        r, g, b, _ = p
        if r + g + b > 300:  # skip the dark ink of the face
            shell.append((r, g, b))
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
shell.sort(key=lambda c: sum(c))
base = shell[len(shell) // 2]
print('bbox', x0, y0, x1, y1, 'base colour', base)

cx = (x0 + x1) / 2
halfw = (x1 - x0) / 2
top, bottom = y0, y1  # image y grows downward; the pointed end is at the top

out = Image.new('RGB', (W, H), base)
op = out.load()
for v_i in range(H):
    v = v_i / (H - 1)
    a = -math.pi / 2 + math.pi * v  # profile parameter, bottom (round) -> top (pointed)
    s = math.sin(a)
    y = s * ROUND if s < 0 else s * POINT
    r = WAIST * math.cos(a)
    # image row for this height: y in [-ROUND, POINT] -> [bottom, top]
    iy = bottom + (y + ROUND) / (POINT + ROUND) * (top - bottom)
    for u_i in range(W):
        u = u_i / W
        th = u * 2 * math.pi
        front = math.cos(th)  # +Z is the face
        if front <= 0.05:
            continue
        lateral = (r * math.sin(th)) / WAIST  # -1..1 across the egg
        ix = cx + lateral * halfw
        xi, yi = int(round(ix)), int(round(iy))
        if xi < 0 or xi >= iw or yi < 0 or yi >= ih:
            continue
        p = px[xi, yi]
        if is_bg(p):
            continue
        # fade into the shell colour near the rim so the seam is invisible
        k = min(1.0, (front - 0.05) / 0.25)
        op[u_i, H - 1 - v_i] = tuple(int(base[c] + (p[c] - base[c]) * k) for c in range(3))
out.save(DST)
print('wrote', DST, W, H)

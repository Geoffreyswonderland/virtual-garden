"""Generate the tileable textures and foliage cards used by the scene.

Everything here is procedural, so the repository has no third-party art and
the textures can be regenerated or tweaked:  python3 tools/make_textures.py
Output goes to textures/.  Requires numpy and Pillow.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'textures')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)
random.seed(11)


# ---------------------------------------------------------------- noise
def fractal(h, w, beta=2.0, seed=None, stretch=(1.0, 1.0)):
    """Tileable fractal noise made by shaping white noise in frequency space."""
    g = np.random.default_rng(seed) if seed is not None else rng
    fy = np.fft.fftfreq(h)[:, None] * stretch[0]
    fx = np.fft.fftfreq(w)[None, :] * stretch[1]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spec = np.fft.fft2(g.standard_normal((h, w))) / f ** (beta / 2)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    n -= n.min()
    return n / n.max()


def band(n, lo, hi):
    return np.clip((n - lo) / (hi - lo), 0, 1)


def normal_map(height, strength, size=512):
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    nz = np.ones_like(height)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    n = np.stack([-dx / l, dy / l, nz / l], -1)
    img = Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))
    return img.resize((size, size * height.shape[0] // height.shape[1]), Image.LANCZOS)


def mix(a, b, t):
    t = np.asarray(t, float)
    if t.ndim: t = t[..., None]
    return a * (1 - t) + b * t


def col(hexstr):
    return np.array([int(hexstr[i:i + 2], 16) for i in (1, 3, 5)], float) / 255


def save_rgb(arr, name, q=90):
    Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q)


def blobs(h, w, count, rmin, rmax, seed):
    """Tileable heightfield of small rounded stones / clods."""
    g = np.random.default_rng(seed)
    img = np.zeros((h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(count):
        cx, cy, r = g.uniform(0, w), g.uniform(0, h), g.uniform(rmin, rmax)
        e = g.uniform(0.6, 1.0)
        a = g.uniform(0, math.pi)
        x0, x1, y0, y1 = int(cx - r - 2), int(cx + r + 2), int(cy - r - 2), int(cy + r + 2)
        ys = np.arange(y0, y1) % h
        xs = np.arange(x0, x1) % w
        dx = (np.arange(x0, x1)[None, :] - cx)
        dy = (np.arange(y0, y1)[:, None] - cy)
        u = (dx * math.cos(a) + dy * math.sin(a)) / r
        v = (-dx * math.sin(a) + dy * math.cos(a)) / (r * e)
        d = 1 - (u * u + v * v)
        sub = np.sqrt(np.clip(d, 0, 1))
        img[np.ix_(ys, xs)] = np.maximum(img[np.ix_(ys, xs)], sub)
    return img


# ---------------------------------------------------------------- ground
def ground():
    s = 1024
    big, mid, fine = fractal(s, s, 2.6), fractal(s, s, 2.0), fractal(s, s, 1.2)
    base = mix(col('#4f6b30'), col('#7d8f45'), band(big, 0.3, 0.75))
    base = mix(base, col('#9a9356'), band(mid, 0.62, 0.85) * 0.6)  # dry patches
    base = mix(base, col('#5d4a32'), band(mid, 0.0, 0.18) * 0.5)  # bare earth
    clover = blobs(s, s, 2600, 1.5, 4, 3)
    base = mix(base, col('#3f5a26'), clover * 0.5)
    base *= (0.85 + 0.3 * fine)[..., None]
    save_rgb(base, 'ground.jpg')
    normal_map(big * 0.4 + clover * 0.5 + fine * 0.6, 6).save(os.path.join(OUT, 'ground_n.jpg'), quality=85)


def dirt():
    s = 1024
    big, mid, fine = fractal(s, s, 2.4), fractal(s, s, 1.8), fractal(s, s, 1.0)
    base = mix(col('#8a7152'), col('#a98f6b'), band(big, 0.25, 0.8))
    base = mix(base, col('#6e5a40'), band(mid, 0.0, 0.3) * 0.6)
    pebbles = blobs(s, s, 380, 3, 10, 5)
    pcol = mix(col('#7a7062'), col('#958a77'), fractal(s, s, 1.5, seed=9))
    base = mix(base, pcol * (0.7 + 0.3 * pebbles[..., None]), np.clip(pebbles * 3, 0, 1) * 0.85)
    grit = (fine > 0.7) * 0.08
    base = base * (0.9 + 0.2 * fine)[..., None] - grit[..., None]
    save_rgb(base, 'dirt.jpg')
    normal_map(big * 0.5 + pebbles * 1.2 + fine * 0.4, 7).save(os.path.join(OUT, 'dirt_n.jpg'), quality=85)


def soil():
    s = 512
    big, fine = fractal(s, s, 2.2), fractal(s, s, 1.0)
    clods = blobs(s, s, 1400, 2, 6, 7)
    base = mix(col('#3a2a1d'), col('#5c4430'), band(big, 0.2, 0.8))
    base = mix(base, col('#6b5139'), clods * 0.6)
    base *= (0.8 + 0.35 * fine)[..., None]
    save_rgb(base, 'soil.jpg')
    normal_map(clods * 1.2 + big * 0.5 + fine * 0.5, 7).save(os.path.join(OUT, 'soil_n.jpg'), quality=85)


# ---------------------------------------------------------------- built things
def bark():
    h, w = 1024, 512
    fib = fractal(h, w, 1.5, stretch=(1.0, 0.07))  # little change along y -> vertical fibres
    big = fractal(h, w, 2.6)
    cracks = band(np.percentile(fib, 30) - fib, -0.03, 0.08)
    base = mix(col('#6b5a48'), col('#8c7a63'), band(big, 0.2, 0.8))
    base = mix(base, col('#2e251d'), cracks)
    lichen = band(fractal(h, w, 2.2, seed=4), 0.7, 0.9)
    base = mix(base, col('#8f9a74'), lichen * 0.35)
    save_rgb(base, 'bark.jpg')
    normal_map(fib * 1.0 + big * 0.3, 9).save(os.path.join(OUT, 'bark_n.jpg'), quality=85)


def thatch():
    s = 1024
    img = Image.new('RGB', (s, s), (96, 82, 56))
    d = ImageDraw.Draw(img)
    hmap = Image.new('L', (s, s), 0)
    hd = ImageDraw.Draw(hmap)
    for _ in range(9000):
        x, y = random.uniform(0, s), random.uniform(-60, s)
        L = random.uniform(40, 140)
        dx = random.uniform(-6, 6)
        g = random.uniform(0.55, 1.0)
        c = (int(170 * g + random.uniform(-15, 15)), int(146 * g), int(96 * g))
        wdt = random.choice([1, 1, 2, 2, 3])
        for ox in (-s, 0, s):
            for oy in (-s, 0, s):
                d.line([(x + ox, y + oy), (x + dx + ox, y + L + oy)], fill=c, width=wdt)
                hd.line([(x + ox, y + oy), (x + dx + ox, y + L + oy)], fill=int(255 * g), width=wdt)
    # courses: darker horizontal bands where one layer of straw overlaps the next
    a = np.asarray(img).astype(float) / 255
    hy = np.asarray(hmap).astype(float) / 255
    yy = np.arange(s)[:, None] / s
    course = 0.5 + 0.5 * np.cos(yy * math.pi * 2 * 8)
    weather = fractal(s, s, 2.4)
    a = a * (0.7 + 0.3 * course)[..., None]
    a = mix(a, a.mean(-1, keepdims=True).repeat(3, -1) * np.array([0.95, 0.95, 0.92]), band(weather, 0.5, 0.9) * 0.6)
    save_rgb(a, 'thatch.jpg')
    normal_map(hy * 0.8 + course * 0.6, 5).save(os.path.join(OUT, 'thatch_n.jpg'), quality=85)


def earth_wall():
    s = 1024
    yy = np.arange(s)[:, None] / s * np.ones((1, s))
    layers = 0.5 + 0.5 * np.sin(yy * math.pi * 2 * 10 + fractal(s, s, 2.8) * 2.5)
    big, fine = fractal(s, s, 2.4), fractal(s, s, 1.0)
    pits = blobs(s, s, 700, 1, 3.5, 13)
    base = mix(col('#a88a64'), col('#c4a982'), band(big, 0.2, 0.8))
    base = mix(base, col('#8d7253'), band(layers, 0.75, 1.0) * 0.5)
    base = base * (0.88 + 0.22 * fine)[..., None] - (pits * 0.18)[..., None]
    straw = blobs(s, s, 500, 0.6, 1.2, 17)
    base = mix(base, col('#d9c48a'), straw * 0.7)
    save_rgb(base, 'earthwall.jpg')
    normal_map(layers * 0.4 + big * 0.4 - pits * 1.0 + fine * 0.4, 6).save(os.path.join(OUT, 'earthwall_n.jpg'), quality=85)


def wood():
    h, w = 512, 512
    grain = fractal(h, w, 2.0, stretch=(1.0, 0.05))
    rings = 0.5 + 0.5 * np.sin(grain * 40)
    big = fractal(h, w, 2.4)
    base = mix(col('#6f5843'), col('#957a5c'), band(big, 0.2, 0.8))
    base = mix(base, col('#4b3b2c'), band(rings, 0.8, 1.0) * 0.6)
    gray = base.mean(-1, keepdims=True).repeat(3, -1)
    base = mix(base, gray * np.array([1.0, 0.98, 0.94]), 0.35)
    save_rgb(base, 'wood.jpg')
    normal_map(rings * 0.4 + grain * 0.5, 5).save(os.path.join(OUT, 'wood_n.jpg'), quality=85)


# ---------------------------------------------------------------- foliage cards (RGBA)
def leaf_poly(cx, cy, length, width, angle, serr=0.0, n=18):
    pts = []
    for side in (1, -1):
        rng_ = range(n + 1) if side == 1 else range(n, -1, -1)
        for i in rng_:
            t = i / n
            wv = math.sin(math.pi * t) ** 0.8 * width * (1 + (serr * (i % 2)))
            x, y = t * length, side * wv
            ca, sa = math.cos(angle), math.sin(angle)
            pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts


def card(size, draw_fn, name, blur=0):
    S = size * 2
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(img), S)
    img = img.resize((size, size), Image.LANCZOS)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    # bleed colour into transparent pixels so mipmaps do not get dark fringes
    arr = np.asarray(img).astype(float)
    a = arr[..., 3:4] / 255
    rgb = arr[..., :3]
    avg = (rgb * a).sum((0, 1)) / max(a.sum(), 1)
    arr[..., :3] = np.where(a > 0.02, rgb, avg)
    Image.fromarray(arr.astype(np.uint8), 'RGBA').save(os.path.join(OUT, name))


def elm_leaves():
    def draw(d, S):
        for _ in range(170):
            r = math.sqrt(random.random()) * S * 0.42
            a = random.uniform(0, math.tau)
            cx, cy = S / 2 + math.cos(a) * r, S / 2 + math.sin(a) * r
            L = random.uniform(0.07, 0.11) * S
            ang = a + random.uniform(-0.8, 0.8)
            lt = random.uniform(0.6, 1.05)
            g = (int(70 * lt + random.uniform(-10, 10)), int(108 * lt + random.uniform(-10, 10)), int(44 * lt))
            d.polygon(leaf_poly(cx, cy, L, L * 0.28, ang, 0.08), fill=g + (255,))
            ex, ey = cx + math.cos(ang) * L * 0.9, cy + math.sin(ang) * L * 0.9
            d.line([(cx, cy), (ex, ey)], fill=(int(g[0] * 0.75), int(g[1] * 0.8), int(g[2] * 0.7), 255), width=2)
    card(512, draw, 'leaves_elm.png')


def willow_strand():
    W, H = 128, 1024
    S = 2
    img = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = W * S / 2
    pts = [(cx + math.sin(t / 90) * 6, t) for t in range(0, H * S, 8)]
    d.line(pts, fill=(96, 92, 58, 255), width=3)
    y = 20
    while y < H * S - 20:
        t = y / (H * S)
        x = cx + math.sin(y / 90) * 6
        for side in (1, -1):
            L = (70 - 30 * t) * random.uniform(0.75, 1.1)
            ang = math.pi / 2 + side * random.uniform(0.25, 0.6)
            lt = random.uniform(0.75, 1.1)
            c = (int(118 * lt), int(150 * lt), int(70 * lt), 255)
            d.polygon(leaf_poly(x, y, L, L * 0.13, ang, 0, 12), fill=c)
        y += random.uniform(14, 24)
    img = img.resize((W, H), Image.LANCZOS)
    arr = np.asarray(img).astype(float)
    a = arr[..., 3:4] / 255
    arr[..., :3] = np.where(a > 0.02, arr[..., :3], np.array([110, 140, 66]))
    Image.fromarray(arr.astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'willow_strand.png'))


def blossom():
    def flower(d, cx, cy, r, tint):
        rot = random.uniform(0, math.tau)
        for i in range(5):
            a = rot + i * math.tau / 5
            px, py = cx + math.cos(a) * r * 0.55, cy + math.sin(a) * r * 0.55
            c = (int(244 * tint), int(178 * tint + 20), int(196 * tint + 10), 255)
            d.ellipse([px - r * 0.55, py - r * 0.55, px + r * 0.55, py + r * 0.55], fill=c)
        d.ellipse([cx - r * 0.25, cy - r * 0.25, cx + r * 0.25, cy + r * 0.25], fill=(214, 92, 120, 255))
        for i in range(7):
            a = random.uniform(0, math.tau)
            d.line([(cx, cy), (cx + math.cos(a) * r * 0.45, cy + math.sin(a) * r * 0.45)], fill=(160, 60, 80, 255), width=2)

    def draw(d, S):
        for _ in range(8):  # twigs
            a = random.uniform(0, math.tau)
            d.line([(S / 2, S / 2), (S / 2 + math.cos(a) * S * 0.45, S / 2 + math.sin(a) * S * 0.45)], fill=(70, 52, 44, 255), width=5)
        for _ in range(40):  # young leaves
            r = math.sqrt(random.random()) * S * 0.4
            a = random.uniform(0, math.tau)
            L = S * random.uniform(0.05, 0.08)
            d.polygon(leaf_poly(S / 2 + math.cos(a) * r, S / 2 + math.sin(a) * r, L, L * 0.25, a + random.uniform(-1, 1)), fill=(110, 140, 70, 255))
        for _ in range(95):
            r = math.sqrt(random.random()) * S * 0.42
            a = random.uniform(0, math.tau)
            flower(d, S / 2 + math.cos(a) * r, S / 2 + math.sin(a) * r, S * random.uniform(0.022, 0.034), random.uniform(0.85, 1.02))
    card(512, draw, 'blossom.png')


def grass_tuft():
    """A tuft of weeds for the vegetable bed (wild grass with seed heads)."""
    def draw(d, S):
        for _ in range(60):
            bx = random.uniform(S * 0.25, S * 0.75)
            h = random.uniform(S * 0.4, S * 0.95)
            lean = random.uniform(-S * 0.2, S * 0.2)
            lt = random.uniform(0.6, 1.1)
            c = (int(92 * lt), int(122 * lt), int(48 * lt), 255)
            pts = [(bx + lean * (t / 10) ** 2, S - h * t / 10) for t in range(11)]
            for i in range(10):
                w = int(7 * (1 - i / 10)) + 1
                d.line([pts[i], pts[i + 1]], fill=c, width=w)
            if random.random() < 0.25:
                x, y = pts[-1]
                d.ellipse([x - 5, y - 16, x + 5, y + 4], fill=(170, 160, 110, 255))
    card(256, draw, 'weed.png')


if __name__ == '__main__':
    for fn in (ground, dirt, soil, bark, thatch, earth_wall, wood, elm_leaves, willow_strand, blossom, grass_tuft):
        fn()
        print('made', fn.__name__)

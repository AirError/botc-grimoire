"""Готовит арт к вёрстке: вырезает белый фон, подгоняет рамки под A4, собирает рамку листа ночей."""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "src"
OUT = ROOT / "art" / "cut"
OUT.mkdir(parents=True, exist_ok=True)

A4 = 297 / 210


def clean(src, dst, edge_thr=240, inner_thr=250, min_area=8):
    """1) фон, связанный с краем кадра  2) замкнутые дырки чистого белого."""
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(int)
    nw = (a.min(axis=2) > edge_thr)
    lab, _ = ndimage.label(nw)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]); edge.discard(0)
    al = np.where(np.isin(lab, list(edge)), 0, 255).astype(np.uint8)
    m = (al > 0) & (a.min(axis=2) > inner_thr)
    lab2, n = ndimage.label(m)
    holes = 0
    if n:
        sizes = ndimage.sum(m, lab2, range(1, n + 1))
        big = [i + 1 for i, s in enumerate(sizes) if s >= min_area]
        holes = len(big)
        al[np.isin(lab2, big)] = 0
    al = np.asarray(Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.7)))
    out = im.convert("RGBA"); out.putalpha(Image.fromarray(al))
    out = out.crop(out.getbbox())
    out.save(dst)
    return out.size, holes


def fit_a4(im, keep=170):
    """Сжимает середину по высоте до пропорций A4; верх и низ (углы, арка) не трогает."""
    w, h = im.size
    th = round(w * A4)
    top, bot = im.crop((0, 0, w, keep)), im.crop((0, h - keep, w, h))
    mid = im.crop((0, keep, w, h - keep)).resize((w, th - 2 * keep), Image.LANCZOS)
    out = Image.new("RGB", (w, th))
    out.paste(top, (0, 0)); out.paste(mid, (0, keep)); out.paste(bot, (0, th - keep))
    return out


def inner_edge(im, thr=150):
    """Медианное расстояние (px) от края листа до внутреннего края рамки: по горизонтали и по вертикали."""
    a = np.asarray(im).astype(int).min(axis=2) < thr
    w, h = im.size
    xs = [np.where(a[y, : w // 4])[0].max() for y in range(h // 4, 3 * h // 4, 8) if a[y, : w // 4].any()]
    ys = [np.where(a[: h // 4, x])[0].max() for x in range(w // 4, 3 * w // 4, 8) if a[: h // 4, x].any()]
    return float(np.median(xs)), float(np.median(ys))


def thin(im, target_mm=7.5):
    """Растягивает рамку от центра, так что внешняя часть уходит за обрез, а внутренний край
    оказывается в target_mm от края листа (рамка «врастает» в лист и становится тоньше)."""
    w, h = im.size
    x_in, y_in = inner_edge(im)
    tx, ty = target_mm / 210 * w, target_mm / 297 * h
    sx, sy = (w / 2 - tx) / (w / 2 - x_in), (h / 2 - ty) / (h / 2 - y_in)
    big = im.resize((round(w * sx), round(h * sy)), Image.LANCZOS)
    left, top = (big.width - w) // 2, (big.height - h) // 2
    return big.crop((left, top, left + w, top + h))


def match_paper(im, ref):
    """Подгоняет тон бумаги im под ref (по центру листа), чтобы стык рамок был незаметен."""
    w, h = im.size
    box = (w // 4, h // 4, 3 * w // 4, 3 * h // 4)
    k = (np.asarray(ref.crop(box)).reshape(-1, 3).mean(0) / np.asarray(im.crop(box)).reshape(-1, 3).mean(0))
    a = np.asarray(im).astype(float) * k
    return Image.fromarray(a.clip(0, 255).round().astype(np.uint8))


def night_frame(front, back, fade=48):
    """Верх — дневная рамка, низ — верх ночной рамки, повёрнутый на 180° (как игральная карта)."""
    w, h = front.size
    half = h // 2
    top = np.asarray(front.crop((0, 0, w, half + fade))).astype(float)
    bot = np.asarray(back.crop((0, 0, w, h - half + fade)).rotate(180)).astype(float)
    out = np.zeros((h, w, 3))
    out[:half - fade] = top[:half - fade]
    out[half + fade:] = bot[2 * fade:]
    t = np.linspace(0, 1, 2 * fade)[:, None, None]
    out[half - fade:half + fade] = top[half - fade:half + fade] * (1 - t) + bot[:2 * fade] * t
    return Image.fromarray(out.round().astype(np.uint8))


if __name__ == "__main__":
    for name in ["header_front", "header_back", "sec_townsfolk", "sec_outsider", "sec_minion",
                 "sec_demon", "night_center", "dusk", "dawn", "minioninfo", "demoninfo", "title_1",
                 "win_good", "win_evil", "ui_nominate", "ui_vote", "ui_execute", "ui_dead", "sec_traveller", "sec_fabled"]:
        p = SRC / f"{name}.png"
        if not p.exists():
            print(f"{name:14s} — нет файла")
            continue
        size, holes = clean(p, OUT / f"{name}.png")
        print(f"{name:14s} {size}  замкнутых белых областей вырезано: {holes}")

    # тонкие рамки от края листа (v2); старые bg_front/bg_back.png больше не используются
    front = thin(fit_a4(Image.open(SRC / "bg_thin_front.png").convert("RGB")))
    back = thin(fit_a4(Image.open(SRC / "bg_thin_back.png").convert("RGB")))
    back = match_paper(back, front)
    print("внутренний край рамки, мм:",
          [round(v, 1) for v in (inner_edge(front)[0] / front.width * 210, inner_edge(front)[1] / front.height * 297)])
    front.save(OUT / "bg_front.jpg", quality=92)
    back.save(OUT / "bg_back.jpg", quality=92)
    night_frame(front, back).save(OUT / "bg_night.jpg", quality=92)
    print("рамки:", front.size)

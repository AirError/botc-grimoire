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


def white_alpha(src, edge_thr=240, inner_thr=250, min_area=8):
    """То же, что clean, но без обрезки: RGBA во весь кадр (чтобы обрезать пару картинок одинаково)."""
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(int)
    lab, _ = ndimage.label(a.min(axis=2) > edge_thr)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]); edge.discard(0)
    al = np.where(np.isin(lab, list(edge)), 0, 255).astype(np.uint8)
    m = (al > 0) & (a.min(axis=2) > inner_thr)
    lab2, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab2, range(1, n + 1))
        al[np.isin(lab2, [i + 1 for i, s in enumerate(sizes) if s >= min_area])] = 0
    al = np.asarray(Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.7)))
    out = im.convert("RGBA"); out.putalpha(Image.fromarray(al))
    return out


def light_mask(src, gamma=1.0, lift=0):
    """«Свет» белым по чёрному → белый RGBA, где прозрачность = яркость; цвет задаёт приложение (CSS mask)."""
    a = np.asarray(Image.open(src).convert("L")).astype(float) / 255
    a = np.clip((a - lift / 255) / (1 - lift / 255), 0, 1) ** gamma
    out = np.zeros(a.shape + (4,), np.uint8); out[..., :3] = 255; out[..., 3] = (a * 255).round()
    return Image.fromarray(out, "RGBA")


def seamless_x(im):
    """Полоса для повтора по горизонтали без шва: картинка + её зеркальная копия."""
    out = Image.new("RGBA", (im.width * 2, im.height)); out.paste(im, (0, 0)); out.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (im.width, 0))
    return out


def beauty():
    """Графика стены жребия и яда (раздел 8 промптов приложения) → art/cut + размеры для вёрстки (art/cut/meta.json)."""
    import json
    meta = {}
    def have(*names): return all((SRC / f"{n}.png").exists() for n in names)
    if have("wall_bg"):
        Image.open(SRC / "wall_bg.png").convert("RGB").save(OUT / "wall_bg.jpg", quality=90)
    if have("wall_edge"):  # край стены: только полоса камня, повторяется по горизонтали
        e = white_alpha(SRC / "wall_edge.png"); e = e.crop(e.getbbox())
        seamless_x(e).save(OUT / "wall_edge.png")
    if have("wall_tablet", "wall_tablet_cracked"):  # целая и треснувшая — одинаковая обрезка, чтобы подменялись без сдвига
        t1, t2 = white_alpha(SRC / "wall_tablet.png"), white_alpha(SRC / "wall_tablet_cracked.png")
        b1, b2 = t1.getbbox(), t2.getbbox()
        box = (min(b1[0], b2[0]), min(b1[1], b2[1]), max(b1[2], b2[2]), max(b1[3], b2[3]))
        t1.crop(box).save(OUT / "tablet.png"); t2.crop(box).save(OUT / "tablet_cracked.png")
    if have("runes"):  # 24 руны сеткой 4×6: строки и столбцы — по пустым промежуткам между символами
        g = np.asarray(Image.open(SRC / "runes.png").convert("L")) > 90
        def bands(proj, want):
            on = proj > 0; runs, start = [], None
            for i, v in enumerate(on):
                if v and start is None: start = i
                if not v and start is not None: runs.append([start, i]); start = None
            if start is not None: runs.append([start, len(on)])
            while len(runs) > want:  # склеиваем самые близкие куски одного символа (полумесяц с точкой)
                k = min(range(len(runs) - 1), key=lambda j: runs[j + 1][0] - runs[j][1])
                runs[k:k + 2] = [[runs[k][0], runs[k + 1][1]]]
            return runs
        rows, cols = bands(g.sum(axis=1), 6), bands(g.sum(axis=0), 4)
        mask = light_mask(SRC / "runes.png", gamma=0.8, lift=40)
        k = 0
        for y0, y1 in rows:
            for x0, x1 in cols:
                sub = g[y0:y1, x0:x1]
                if not sub.any(): continue
                ys, xs = np.where(sub); by0, by1, bx0, bx1 = y0 + ys.min(), y0 + ys.max() + 1, x0 + xs.min(), x0 + xs.max() + 1
                side = max(by1 - by0, bx1 - bx0) + 16; cy, cx = (by0 + by1) // 2, (bx0 + bx1) // 2
                mask.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)).resize((160, 160), Image.LANCZOS).save(OUT / f"rune{k}.png")
                k += 1
        meta["runes"] = k
        print("рун:", k, "строк", len(rows), "столбцов", len(cols))
    for name, gamma in (("wall_glow", 1.0), ("fx_open", 1.0), ("fx_circle", 0.9)):
        if have(name): light_mask(SRC / f"{name}.png", gamma=gamma, lift=8).save(OUT / f"{name}.png")
    if have("poison_drop"):
        d = white_alpha(SRC / "poison_drop.png"); d.crop(d.getbbox()).save(OUT / "poison_drop.png")
    if have("poison_drips"):
        d = white_alpha(SRC / "poison_drips.png"); d = d.crop(d.getbbox())
        seamless_x(d).save(OUT / "poison_drips.png")
    if have("poison_frame"):  # рамка для border-image: толщина — по средней строке и столбцу
        f = white_alpha(SRC / "poison_frame.png"); f = f.crop(f.getbbox())
        f = f.resize((600, round(600 * f.height / f.width)), Image.LANCZOS)
        al = np.asarray(f)[..., 3]
        row, col = al[al.shape[0] // 2], al[:, al.shape[1] // 2]
        def inner(line):  # от края: первый непрозрачный пиксель, потом первый прозрачный — это внутренний край рамки
            a = int(np.argmax(line >= 128)); return a + int(np.argmax(line[a:] < 20))
        tx, ty = inner(row), inner(col)
        meta["frame_slice"] = max(tx, ty) + 2
        f.save(OUT / "poison_frame.png")
        print("рамка: толщина", tx, ty)
    meta["cards"] = cards()
    meta["marks"] = marks()
    meta["digits"] = digits()
    (OUT / "meta.json").write_text(json.dumps(meta), encoding="utf-8")


def digits():
    """Цифры 0–9 (digits.png, 2 строки по 5): каждая — по своей клетке; высота — по строке, чтобы все цифры были одного роста."""
    if not (SRC / "digits.png").exists():
        return 0
    im = white_alpha(SRC / "digits.png", edge_thr=215, inner_thr=205)  # в золотых цифрах белого нет — режем и светлую кайму в «дырках»
    al = np.asarray(im)[..., 3] > 40
    h, w = al.shape
    on = al.any(axis=1); runs, start = [], None
    for y, v in enumerate(on):
        if v and start is None: start = y
        if not v and start is not None: runs.append([start, y]); start = None
    if start is not None: runs.append([start, h])
    runs = sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[:2]; runs.sort()
    lab, _ = ndimage.label(al)
    cols = {}
    for idx, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or (lab[sl] == idx).sum() < 200: continue
        cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        r = next((i for i, (a, b) in enumerate(runs) if a <= cy < b), None)
        if r is None: continue
        k = r * 5 + min(4, int(cx // (w / 5)))
        x0, x1 = cols.get(k, (sl[1].start, sl[1].stop)); cols[k] = (min(x0, sl[1].start), max(x1, sl[1].stop))
    for k, (x0, x1) in sorted(cols.items()):
        y0, y1 = runs[k // 5]
        d = im.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4)); d = d.resize((round(d.width * 220 / d.height), 220), Image.LANCZOS)
        d.save(OUT / f"digit{k}.png")
    print("цифр:", len(cols))
    return len(cols)


def marks():
    """Значки Гримуара: саван и лист 4×5 (marks.png). Каждый значок — связные куски, чей центр попал в клетку сетки
    (две маски, две чашки, нимб с пером, пар над чашкой — несколько кусков одного значка)."""
    n = 0
    if (SRC / "shroud.png").exists():
        s = white_alpha(SRC / "shroud.png"); s.crop(s.getbbox()).save(OUT / "shroud.png")
    if not (SRC / "marks.png").exists():
        return n
    # белые блики внутри значков не вырезаем: только фон с краёв и крупные замкнутые белые области (петля)
    im = white_alpha(SRC / "marks.png", inner_thr=252, min_area=400)
    al = np.asarray(im)[..., 3] > 40
    h, w = al.shape
    rows_on = al.any(axis=1); runs, start = [], None
    for y, v in enumerate(rows_on):
        if v and start is None: start = y
        if not v and start is not None: runs.append([start, y]); start = None
    if start is not None: runs.append([start, h])
    while len(runs) > 5:  # пар над чашкой и т. п. — склеиваем ближайшие полосы
        k = min(range(len(runs) - 1), key=lambda j: runs[j + 1][0] - runs[j][1])
        runs[k:k + 2] = [[runs[k][0], runs[k + 1][1]]]
    lab, cnt = ndimage.label(al)
    boxes, parts = {}, {}
    for idx, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None: continue
        ys, xs = sl; area = (lab[sl] == idx).sum()
        if area < 30: continue
        cy, cx = (ys.start + ys.stop) / 2, (xs.start + xs.stop) / 2
        r = next((i for i, (a, b) in enumerate(runs) if a <= cy < b), None)
        if r is None: continue
        c = min(3, int(cx // (w / 4)))
        b = boxes.setdefault(r * 4 + c, [ys.start, xs.start, ys.stop, xs.stop]); parts.setdefault(r * 4 + c, []).append(idx)
        b[:] = [min(b[0], ys.start), min(b[1], xs.start), max(b[2], ys.stop), max(b[3], xs.stop)]
    rgba = np.asarray(im).copy()
    for k, (y0, x0, y1, x1) in sorted(boxes.items()):
        # только свои куски: соседние значки, попавшие в квадрат, — прозрачные
        own = rgba.copy(); own[..., 3] = np.where(np.isin(lab, parts[k]), own[..., 3], 0)
        side = max(y1 - y0, x1 - x0) + 8; cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
        cell = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        cell.paste(Image.fromarray(own, "RGBA").crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)), (0, 0))
        cell.resize((96, 96), Image.LANCZOS).save(OUT / f"mark{k}.png")
        n += 1
    print("значков:", n, "строк", len(runs))
    return n


CARDS = ["card_demon", "card_minions", "card_notinplay", "card_youare", "card_selected", "card_thisplayer",
         "card_yourrole", "card_yes", "card_no", "card_good", "card_evil"]


def cards():
    """Карточки для показа игрокам: вырезаем белый фон и меряем поле под надпись — от низа медальона до нижней рамки,
    между боковыми рамками (доли ширины и высоты картинки), чтобы приложение писало фразу точно в поле."""
    out = {}
    for name in CARDS:
        if not (SRC / f"{name}.png").exists():
            continue
        im = white_alpha(SRC / f"{name}.png"); im = im.crop(im.getbbox())
        a = np.asarray(im.convert("RGB")).astype(int); lum = a.mean(axis=2); w, h = im.size
        bright = lum > 110  # золото рамки
        row = bright[int(h * 0.7)]; col = bright[:, int(w * 0.25)]
        left = int(np.where(row[: w // 5])[0].max()) + 1; right = int(w * 4 // 5 + np.where(row[w * 4 // 5:])[0].min())
        top = int(np.where(col[: h // 2])[0].max()) + 1
        bottom = int(h - 1 - np.where(col[::-1][: h // 4])[0].max())  # внутренний край нижней рамки — снизу вверх
        # низ медальона — геометрически: над табличкой видна только дуга круга; по её высоте и ширине находим радиус
        al = np.asarray(im)[..., 3] > 128
        plaque = next(y for y in range(h) if al[y].sum() > 0.8 * w)  # верхняя кромка таблички
        y0, ys = 0, plaque - 3
        xs = np.where(al[ys])[0]; c = (xs.max() - xs.min()) / 2; d = ys - y0
        r = (d * d + c * c) / (2 * d)
        med = int(y0 + 2 * r) + 6
        out[name] = [left / w, med / h, right / w, bottom / h]
        im.save(OUT / f"{name}.png")
    # все карточки сделаны правкой одной — раскладка общая; медиана гасит сбои замера (нимб над медальоном, тёмный низ)
    box = [round(float(np.median([v[i] for v in out.values()])), 4) for i in range(4)] if out else None
    print("карточек:", len(out), "поле под надпись (доли):", box)
    return {"names": list(out), "box": box}


if __name__ == "__main__":
    beauty()
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

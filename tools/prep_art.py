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
    # пьянство — как яд (раздел 8 промптов): значок-кружка, пена по верхнему краю, рамка для border-image
    if have("drunk_mug"):
        d = white_alpha(SRC / "drunk_mug.png"); d.crop(d.getbbox()).save(OUT / "drunk_mug.png")
    if have("drunk_foam"):
        d = white_alpha(SRC / "drunk_foam.png"); d = d.crop(d.getbbox())
        seamless_x(d).save(OUT / "drunk_foam.png")
    if have("drunk_frame"):
        f = white_alpha(SRC / "drunk_frame.png"); f = f.crop(f.getbbox())
        f = f.resize((600, round(600 * f.height / f.width)), Image.LANCZOS)
        al = np.asarray(f)[..., 3]
        row, col = al[al.shape[0] // 2], al[:, al.shape[1] // 2]
        def inner2(line):
            a = int(np.argmax(line >= 128)); return a + int(np.argmax(line[a:] < 20))
        meta["drunk_slice"] = max(inner2(row), inner2(col)) + 2
        f.save(OUT / "drunk_frame.png")
        print("рамка пьянства: толщина", meta["drunk_slice"])
    meta["cards"] = cards()
    meta["marks"] = marks()
    meta["digits"] = digits()
    meta["d_digits"] = digits("d_digits", "d_digit"); meta["h_digits"] = digits("h_digits", "h_digit", light=True)  # цифры оформлений
    meta["skins"] = skins()
    meta["hallow"] = halloween()
    meta["vitr"] = vitrage()
    (OUT / "meta.json").write_text(json.dumps(meta), encoding="utf-8")


def vitrage():
    """«Витраж во тьме»: выдача ролей витражом (prompts_vitrage.md, просьба пользователя 2026-10-23) → art/cut, сведения — в meta.vitr.
    Окна-ланцеты на двух листах 5×2 (чёрный фон между окнами — прозрачный), каменная рама с пустым проёмом и она же разбитая
    (белый фон — прозрачный, и в проёме тоже), неф собора (фон), витраж за ролью. Трещины рисует приложение — от точки удара, по краям осколков."""
    out = {}
    if (SRC / "d_nave.png").exists():
        Image.open(SRC / "d_nave.png").convert("RGB").save(OUT / "d_nave.jpg", quality=88)
    if (SRC / "d_reveal.png").exists():
        Image.open(SRC / "d_reveal.png").convert("RGB").save(OUT / "d_reveal.jpg", quality=88)
    # рама: белое снаружи и в проёме — прозрачное (white_alpha вырезает и белые «дыры» внутри). Разбитая — правка целой и стоит
    # на том же месте кадра, поэтому обе обрезаются по рамке целой; проём целой — место стекла (out["glass"])
    box = None
    for k in ("d_arch", "d_arch_broken"):
        if not (SRC / f"{k}.png").exists(): continue
        a = white_alpha(SRC / f"{k}.png", edge_thr=235, inner_thr=245, min_area=400)
        if box is None:
            ys, xs = np.where(np.asarray(a)[..., 3] > 10); box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        a = a.crop(box); a.save(OUT / f"{k}.png"); out[k] = list(a.size)
        if k == "d_arch":
            g = arch_glass(a)
            if g: out["glass"] = g
    # окна стекла тянутся под форму проёма: все — одного размера, ширина/высота как у стекла в раме
    asp = out["glass"]["w"] * out["glass"]["fa"] / out["glass"]["h"] if "glass" in out else None
    n = 0
    # по 10 окон: 5 столбцов × 2 ряда. Не по клеткам сетки: окна заходят за середину листа (верхушки нижнего ряда — в верхнюю половину).
    # Силуэт окна: стёкла (ярче 40) склеиваются через тонкий свинец (замыкание 9 px), дыры заливаются; между окнами — ≥ 28 px чёрного.
    # Окна — по рядам и слева направо
    for sheet in ("d_panes1", "d_panes2"):
        if not (SRC / f"{sheet}.png").exists(): continue
        a = np.asarray(Image.open(SRC / f"{sheet}.png").convert("RGB")).astype(float); H = a.shape[0]
        sil = ndimage.binary_fill_holes(ndimage.binary_closing(a.max(axis=2) >= 40, structure=np.ones((9, 9))))
        win, k = ndimage.label(sil)
        size = ndimage.sum(np.ones_like(win), win, range(1, k + 1))
        boxes = ndimage.find_objects(win)
        big = sorted(np.argsort(size)[::-1][:10], key=lambda i: ((boxes[i][0].start + boxes[i][0].stop) / 2 > H / 2, boxes[i][1].start))
        for i in big:
            sy, sx = boxes[i]
            al = np.where(win[sy, sx] == i + 1, 255, 0)  # вне силуэта и чужие окна — прозрачные
            p = Image.fromarray(np.dstack([a[sy, sx], al]).round().astype(np.uint8), "RGBA")
            if asp:  # есть рама — окно режет clip-path проёма, прозрачность не нужна: на чёрном, без неё в странице втрое легче
                p = p.resize((210, round(210 / asp)), Image.LANCZOS)
                blk = Image.new("RGBA", p.size, (0, 0, 0, 255)); blk.alpha_composite(p); p = blk.convert("RGB")
            p.save(OUT / f"d_pane{n}.png"); n += 1
    out["panes"] = n
    # этап 2 (заметка пользователя 2026-10-24): ночной витраж за ролью (правка дневного — совпадает с ним линия в линию), ореол —
    # сильно размытый дневной, медальон под знак роли → out["medal"]; цветные лучи и вспышка удара — свет на чёрном
    if (SRC / "d_reveal_dark.png").exists():
        Image.open(SRC / "d_reveal_dark.png").convert("RGB").save(OUT / "d_reveal_dark.jpg", quality=88)
    if (SRC / "d_reveal.png").exists():
        lit = Image.open(SRC / "d_reveal.png").convert("RGB")
        lit.resize((160, round(160 * lit.height / lit.width)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5)).save(OUT / "d_reveal_glow.jpg", quality=82)
        md = medallion(lit)
        if md: out["medal"] = md
    if (SRC / "d_beams.png").exists():
        light_rgba(SRC / "d_beams.png", lift=10).save(OUT / "d_beams.png")
    if (SRC / "d_impact.png").exists():  # квадрат вокруг вспышки (центр картинки)
        im = light_rgba(SRC / "d_impact.png", lift=10); x0, y0, x1, y1 = im.getbbox(); c = im.width / 2
        s = max(c - x0, x1 - c, c - y0, y1 - c) + 8; im.crop((round(c - s), round(c - s), round(c + s), round(c + s))).save(OUT / "d_impact.png")
    # нарисованные трещины: картинка — свет (прозрачность = яркость); куски между линиями — многоугольники: осколки бьются по ним
    cracks = []
    for k in ("d_crack1", "d_crack2"):
        if not (SRC / f"{k}.png").exists(): continue
        light_rgba(SRC / f"{k}.png", lift=16).save(OUT / f"{k}.png")
        c = crack_pieces(SRC / f"{k}.png"); c["k"] = k; cracks.append(c)
        print(f"{k}: центр удара {c['c']}, кусков {len(c['p'])}")
    if cracks: out["cracks"] = cracks
    if n: print("витраж: окон", n, "стекло", out.get("glass"), "медальон", out.get("medal"))
    return out


def medallion(im):
    """Пустой медальон под знак роли на витраже за ролью: самое большое ровное тёмно-синее пятно → центр и радиус (пиксели картинки)."""
    a = np.asarray(im).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (b > r + 50) & (b > g + 30) & (a.max(axis=2) < 150)
    lab, n = ndimage.label(m)
    if not n: return None
    size = ndimage.sum(m, lab, range(1, n + 1)); i = int(size.argmax()) + 1
    if size[i - 1] < m.size * .01: return None
    ys, xs = np.where(lab == i)
    return {"x": round(float(xs.mean()), 1), "y": round(float(ys.mean()), 1), "r": round(float(np.sqrt(size[i - 1] / np.pi)), 1), "w": im.width, "h": im.height}


def crack_pieces(src, thr=100, dil=2, min_frac=.0008, eps=3):
    """Нарисованные трещины (белым по чёрному) → центр удара и куски между линиями: многоугольники в долях картинки
    (обход границы куска + упрощение Дугласа — Пекера). Линии утолщаются на dil px — щели между кусками; крошки меньше min_frac
    площади пропускаем: там, у точки удара, — вспышка и сама трещина."""
    m = np.asarray(Image.open(src).convert("RGB")).astype(float).max(axis=2); H, W = m.shape
    dens = ndimage.gaussian_filter((m > 200).astype(float), 18)  # центр удара — где гуще всего яркие линии (у середины)
    y0, x0 = int(H * .3), int(W * .3); iy, ix = np.unravel_index(dens[y0:H - y0, x0:W - x0].argmax(), dens[y0:H - y0, x0:W - x0].shape)
    lab, n = ndimage.label(~ndimage.binary_dilation(m > thr, iterations=dil))
    polys = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None: continue
        reg = lab[sl] == i + 1
        if reg.sum() < W * H * min_frac: continue
        pts = rdp(trace_boundary(reg), eps)
        if len(pts) < 3: continue
        polys.append([round(float(v), 4) for x, y in pts for v in ((x + sl[1].start) / W, (y + sl[0].start) / H)])
    return {"c": [round((ix + x0) / W, 4), round((iy + y0) / H, 4)], "p": polys}


def trace_boundary(reg):
    """Обход границы связной области (Мур, по часовой стрелке) → точки контура (x, y) по порядку."""
    m = np.pad(reg, 1)
    ys, xs = np.nonzero(m); k = np.lexsort((xs, ys))[0]; y, x = int(ys[k]), int(xs[k])
    D = ((0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1))  # (dy, dx) по часовой, начиная с запада
    back, pts, first = 0, [(x - 1, y - 1)], None  # верхняя левая точка: слева от неё пусто — «пришли с запада»
    for _ in range(8 * int(m.sum()) + 8):
        for j in range(1, 9):
            d = (back + j) % 8
            if m[y + D[d][0], x + D[d][1]]: break
        else:
            return pts  # одна точка
        by, bx = y + D[(d + 7) % 8][0], x + D[(d + 7) % 8][1]  # последняя пустая клетка перед найденной
        y, x = y + D[d][0], x + D[d][1]; back = D.index((by - y, bx - x))
        if first is None: first = (y, x, back)
        elif (y, x, back) == first: break
        pts.append((x - 1, y - 1))
    return pts


def rdp(pts, eps):
    """Упрощение замкнутого контура (Дуглас — Пекер): делим по самой дальней от первой точке, каждую половину упрощаем."""
    if len(pts) < 4: return pts
    P = np.asarray(pts, float)
    def simp(A):
        keep = np.zeros(len(A), bool); keep[0] = keep[-1] = True; st = [(0, len(A) - 1)]
        while st:
            i, j = st.pop()
            if j <= i + 1: continue
            a, ab = A[i], A[j] - A[i]; L = float(np.hypot(*ab)) or 1e-9
            dd = np.abs(ab[0] * (A[i + 1:j, 1] - a[1]) - ab[1] * (A[i + 1:j, 0] - a[0])) / L; k = int(dd.argmax())
            if dd[k] > eps: keep[i + 1 + k] = True; st += [(i, i + 1 + k), (i + 1 + k, j)]
        return [tuple(p) for p in A[keep]]
    far = int(np.argmax(((P - P[0]) ** 2).sum(1)))
    return simp(P[:far + 1])[:-1] + simp(np.vstack([P[far:], P[:1]]))[:-1]


def arch_glass(im, mx=.03, mt=.012, mb=.01):
    """Проём рамы (самая большая прозрачная область внутри камня) → где стекло, в % рамы: l, t, w, h — проём с запасом под камень
    (mx — с боков, mt/mb — сверху/снизу, доли проёма: край рисованного окна уходит под камень); fa — ширина/высота рамы;
    arch — доля высоты стекла под стрельчатый верх (до строки, где проём набирает полную ширину)."""
    al = np.asarray(im)[..., 3] > 128
    H, W = al.shape
    lab, k = ndimage.label(~al)
    edge = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1])
    inner = [i for i in range(1, k + 1) if i not in edge]
    if not inner: return None
    hole = lab == max(inner, key=lambda i: (lab == i).sum())
    ys, xs = np.where(hole)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    wid = hole.sum(axis=1)
    spring = int(np.argmax(wid >= .995 * wid.max()))  # дуга входит в бок по касательной — порог почти полный
    ow, oh = x1 - x0, y1 - y0
    gx0, gx1, gy0, gy1 = x0 - mx * ow, x1 + mx * ow, y0 - mt * oh, y1 + mb * oh
    return {"l": round(float(gx0 / W * 100), 2), "t": round(float(gy0 / H * 100), 2), "w": round(float((gx1 - gx0) / W * 100), 2),
            "h": round(float((gy1 - gy0) / H * 100), 2), "fa": round(W / H, 4), "arch": round(float((spring - gy0) / (gy1 - gy0)), 3)}


def light_rgba(src, lift=10):
    """Цветной свет на чёрном (призрак) → RGBA: прозрачность = яркость, цвет без затемнения (ложится на любой фон)."""
    a = np.asarray(Image.open(src).convert("RGB")).astype(float)
    m = a.max(axis=2)
    al = np.clip((m - lift) / (255 - lift), 0, 1)
    rgb = np.clip(a / np.maximum(m[..., None], 1) * 255, 0, 255)
    rgb[al < .01] = 0  # цвет под полной прозрачностью — шум, только раздувает файл
    return Image.fromarray(np.dstack([rgb, al * 255]).round().astype(np.uint8), "RGBA")


def black_alpha(src, thr=40):
    """Предметы на чёрном (эмблемы): фон, связанный с краем кадра, — прозрачный с мягким краем; тёмное внутри предмета остаётся."""
    a = np.asarray(Image.open(src).convert("RGB")).astype(float)
    m = a.max(axis=2)
    lab, _ = ndimage.label(m < thr)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]); edge.discard(0)
    bg = np.isin(lab, list(edge))
    al = np.where(bg, np.clip((m - 8) / (thr - 8), 0, 1) * 255, 255)
    return Image.fromarray(np.dstack([a, al]).round().astype(np.uint8), "RGBA")


def grid_frames(im, cols, rows, pad=6):
    """Кадры покадровой анимации: клетки сетки обрезаются одной общей рамкой — тело не прыгает между кадрами."""
    W, H = im.size; a = np.asarray(im)[..., 3] > 24; cells, box = [], [10**9, 10**9, -1, -1]
    for r in range(rows):
        for c in range(cols):
            x0, y0 = round(c * W / cols), round(r * H / rows); x1, y1 = round((c + 1) * W / cols), round((r + 1) * H / rows)
            ys, xs = np.where(a[y0:y1, x0:x1]); cells.append((x0, y0))
            if len(xs): box = [min(box[0], xs.min()), min(box[1], ys.min()), max(box[2], xs.max()), max(box[3], ys.max())]
    bx0, by0, bx1, by1 = box[0] - pad, box[1] - pad, box[2] + pad + 1, box[3] + pad + 1
    return [im.crop((x0 + bx0, y0 + by0, x0 + bx1, y0 + by1)) for x0, y0 in cells]


def strip(frames, h):
    """Кадры в одну горизонтальную полосу одинаковой высоты (для CSS steps())."""
    fr = [f.resize((round(f.width * h / f.height), h), Image.LANCZOS) for f in frames]
    out = Image.new("RGBA", (sum(f.width for f in fr), h), (255, 255, 255, 0)); x = 0
    for f in fr: out.paste(f, (x, 0)); x += f.width
    return out


def sprite_frames(im, cols, rows, pad=24):
    """Кадры взмаха: каждый — только из своей клетки (без кончиков крыльев соседа), выровнены по телу — самой «толстой» части
    силуэта (по карте расстояний до края; крылья тоньше). GPT ставит фигурки в клетках на разной высоте — без выравнивания тело
    прыгает между кадрами."""
    W, H = im.size; A = np.asarray(im); cells = []
    for r in range(rows):
        for c in range(cols):
            x0, y0, x1, y1 = round(c * W / cols), round(r * H / rows), round((c + 1) * W / cols), round((r + 1) * H / rows)
            cell = A[y0:y1, x0:x1].copy(); a = cell[..., 3] > 24
            lab, n = ndimage.label(a)
            if n > 1: a = lab == 1 + int(np.argmax(ndimage.sum(a, lab, range(1, n + 1)))); cell[..., 3] *= ndimage.binary_dilation(a, iterations=3)
            d = ndimage.distance_transform_edt(a); cy, cx = ndimage.center_of_mass(d > d.max() * .6)
            ys, xs = np.where(cell[..., 3] > 24)
            cells.append((cell, cx, cy, xs.min() - cx, ys.min() - cy, xs.max() - cx, ys.max() - cy))
    l, t = min(c[3] for c in cells) - pad, min(c[4] for c in cells) - pad
    w, h = int(np.ceil(max(c[5] for c in cells) + pad - l)), int(np.ceil(max(c[6] for c in cells) + pad - t))
    frames = []
    for cell, cx, cy, *_ in cells:
        fr = Image.new("RGBA", (w, h), (255, 255, 255, 0)); fr.alpha_composite(Image.fromarray(cell, "RGBA"), (round(-l - cx), round(-t - cy))); frames.append(fr)
    return frames


def halo(im, rgb=(255, 150, 60), sigma=3.0, k=.6):
    """Тёплый отсвет свечей вокруг тёмного силуэта — нарисован в картинке: CSS drop-shadow на летящем спрайте телефон
    перерисовывает каждый кадр (заметка пользователя 2026-10-18: «анимации рваные»)."""
    src = np.asarray(im).astype(float) / 255
    g = np.clip(ndimage.gaussian_filter(ndimage.maximum_filter(src[..., 3], size=3), sigma) * 2.2, 0, 1)[..., None] * k
    sa = src[..., 3:4]; oa = sa + g * (1 - sa)
    oc = (src[..., :3] * sa + np.array(rgb) / 255 * g * (1 - sa)) / np.maximum(oa, 1e-6)
    return Image.fromarray((np.dstack([oc, oa]) * 255).round().clip(0, 255).astype(np.uint8), "RGBA")


def sprite_grid(im, grid_old, grid_new):
    """Сетка листа: новая (больше кадров), если её границы клеток пусты — ни один предмет их не пересекает; иначе старая.
    (Сравнивать «чья пустее» нельзя: у ворона линии сетки 4×1 входят в 4×2.)"""
    a = np.asarray(im)[..., 3] > 24; H, W = a.shape
    c, r = grid_new; bw, bh = max(2, W // 100), max(2, H // 100)
    lines = [a[:, round(W * k / c) - bw:round(W * k / c) + bw].mean() for k in range(1, c)]
    lines += [a[round(H * k / r) - bh:round(H * k / r) + bh, :].mean() for k in range(1, r)]
    return grid_new if max(lines) < .03 else grid_old


def alpha_pad(im, thr=8):
    """Кадр из общей рамки: всё, что слабее порога (туман от соседней клетки, шум), — прозрачное."""
    a = np.asarray(im).copy(); a[a[..., 3] < thr] = 0
    return Image.fromarray(a, "RGBA")


def defringe(im, band=4, lo=185, hi=235):
    """Светлая кайма у края вырезки (белый фон между прядями волос, между лапами) — прозрачнее, чем светлее."""
    A = np.asarray(im).copy(); t = A[..., 3] < 24
    near = ndimage.distance_transform_edt(~t) <= band
    k = np.clip((hi - A[..., :3].min(axis=2).astype(float)) / (hi - lo), 0, 1)
    A[..., 3] = np.where(near & ~t, A[..., 3] * k, A[..., 3]).round().astype(np.uint8)
    return Image.fromarray(A, "RGBA")


def blob_poses(im, n=2, dil=6):
    """Позы на листе, заходящие за середину (сеткой не разрезать): n самых крупных кусков слева направо, мелкие куски (кончики лап) —
    к ближайшему крупному. Каждая поза — по центру общего холста: масштаб твари при смене поз не меняется."""
    A = np.asarray(im); a = A[..., 3] > 24
    lab, k = ndimage.label(ndimage.binary_dilation(a, iterations=dil)); objs = ndimage.find_objects(lab)
    big = sorted((np.argsort(ndimage.sum(a, lab, range(1, k + 1)))[::-1][:n] + 1).tolist(), key=lambda i: objs[i - 1][1].start)
    def gap(i, b):
        s, t = objs[i - 1], objs[b - 1]
        dx = max(t[1].start - s[1].stop, 0, s[1].start - t[1].stop); dy = max(t[0].start - s[0].stop, 0, s[0].start - t[0].stop)
        return dx * dx + dy * dy
    owner = {i: i if i in big else min(big, key=lambda b: gap(i, b)) for i in range(1, k + 1)}
    res = []
    for b in big:
        m = ndimage.binary_dilation(np.isin(lab, [i for i, o in owner.items() if o == b]) & a, iterations=2)
        X = A.copy(); X[..., 3] = np.where(m, X[..., 3], 0); res.append(alpha_bbox(Image.fromarray(X, "RGBA"), thr=8))
    W, H = max(r.width for r in res), max(r.height for r in res); out = []
    for r in res:
        c = Image.new("RGBA", (W, H), (255, 255, 255, 0)); c.alpha_composite(r, ((W - r.width) // 2, (H - r.height) // 2)); out.append(c)
    return out


def facing(im):
    """Куда смотрит летящая фигура: голова (верхняя треть силуэта) правее середины — вправо (1), левее — влево (−1)."""
    a = np.asarray(im)[..., 3].astype(float); ys, xs = np.nonzero(a > 40)
    top = ys < ys.min() + (ys.max() - ys.min()) * .3
    return 1 if xs[top].mean() >= xs.mean() else -1


def halloween():
    """Стиль «Хэллоуин» (prompts_halloween.md, файлы h_*) → art/cut; геометрия сундука — в meta.hallow."""
    out = {}
    def have(n): return (SRC / f"{n}.png").exists()
    def save(name, im, fmt="png"):
        if fmt == "jpg": im.convert("RGB").save(OUT / f"{name}.jpg", quality=90)
        else: im.save(OUT / f"{name}.png")
        out[name] = list(im.size)
    if have("h_tabs"):  # 4×2: крест, луна, котёл, книга с зубами / книга некромантии, маска, три глаза, тыква
        for k, im in zip(["day", "night", "setup", "table", "log", "roles", "menu", "pumpkin"], grid_pieces(white_alpha(SRC / "h_tabs.png"), 4, 2)):
            save("h_tab_" + k, im)
    for n in ("h_crypt", "h_splash"):
        if have(n): save(n, Image.open(SRC / f"{n}.png"), "jpg")
    for n in ("h_header_day", "h_header_night"):  # шапки: средняя полоса
        if have(n): im = Image.open(SRC / f"{n}.png"); w, h = im.size; save(n, im.crop((0, round(h * .26), w, round(h * .74))), "jpg")
    for n in ("h_win_good", "h_win_evil"):  # на светлом экране конца игры — с умножением (белое становится прозрачным)
        if have(n): save(n, Image.open(SRC / f"{n}.png"), "jpg")
    for n in ("h_ring", "h_frame", "h_skull", "h_chest_open"):
        if have(n): save(n, alpha_bbox(white_alpha(SRC / f"{n}.png"), thr=20))
    if have("h_emblems"):
        keys = ["demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yourrole", "yes", "no", "good", "evil",
                "general_good", "general_evil", "general_neither", "moon"]
        for k, im in zip(keys, grid_pieces(black_alpha(SRC / "h_emblems.png"), 5, 3, thr=60)): save("h_em_" + k, im)
    if have("h_glyphs"):
        for k, im in zip(["dusk", "dawn", "minioninfo", "demoninfo", "nominate", "vote", "execute", "dead"], grid_pieces(white_alpha(SRC / "h_glyphs.png"), 4, 2)):
            save("h_g_" + k, im)
    if have("h_decor"):  # тушь: 4 уголка паутины сверху; паук, разделитель-мышь, венок снизу
        o = dark_mask(Image.open(SRC / "h_decor.png"), lo=40, hi=230); bs = sheet_pieces(o, dil=12)
        top = sorted([b for b in bs if b[3] < o.height * .4], key=lambda b: b[0])
        low = sorted([b for b in bs if b[1] >= o.height * .35], key=lambda b: b[0])
        for k, b in zip(["tl", "tr", "bl", "br"], top): save("h_web_" + k, o.crop(b))
        for k, b in zip(["spider", "batline", "wreath"], low): save("h_" + k, o.crop(b))
        if (OUT / "h_wreath.png").exists():  # венок у значка ночного шага — осенним оранжевым (фон — картинка, не маска)
            w = np.asarray(Image.open(OUT / "h_wreath.png")).copy(); w[..., 0], w[..., 1], w[..., 2] = 214, 120, 44
            save("h_wreath", Image.fromarray(w, "RGBA"))
        print("украшения Хэллоуина:", len(top), "уголка,", len(low), "нижних")
    if have("h_chest1"):  # сундук: закрытый, короб без крышки, крышка — по x; крышка и короб ставятся по закрытому
        c = white_alpha(SRC / "h_chest1.png"); bs = sorted(sheet_pieces(c, dil=8), key=lambda b: b[0])[:3]
        closed, box, lid = [c.crop(b) for b in bs]
        save("h_chest_closed", closed); save("h_chest_box", box); save("h_chest_lid", lid)
        cw, ch = closed.size
        # короб — по низу и центру закрытого сундука, крышка — по верху и центру (доли размера закрытого сундука)
        out["chest"] = {"w": cw, "h": ch,
                        "box": [round((cw - box.width) / 2 / cw, 4), round((ch - box.height) / ch, 4), round(box.width / cw, 4), round(box.height / ch, 4)],
                        "lid": [round((cw - lid.width) / 2 / cw, 4), 0, round(lid.width / cw, 4), round(lid.height / ch, 4)]}
        print("сундук:", out["chest"])
    if have("h_ghost"):  # призрак — цветной свет на чёрном: 3 позы в ряд (первый лист) или 4 позы сеткой 2×2 (страшный, с броском)
        g = light_rgba(SRC / "h_ghost.png"); cols, rows = sprite_grid(g, (3, 1), (2, 2))
        for f in OUT.glob("h_ghost[0-9].png"): f.unlink()
        # позы — в одной общей рамке (а не каждая по своему контуру): при смене поз фигура не меняет размер
        poses = [alpha_pad(p) for p in grid_frames(g, cols, rows, pad=0)]
        # «тает» (4-я поза) должна лететь туда же, куда «летит» (2-я): на листе пользователя 2026-10-18 она смотрела влево
        if len(poses) >= 4 and facing(poses[3]) != facing(poses[1]): poses[3] = poses[3].transpose(Image.FLIP_LEFT_RIGHT)
        for i, im in enumerate(poses, 1): save(f"h_ghost{i}", im)
        out["ghost_n"] = len(poses)
    # взмахи крыльев: 6 / 4 кадра (первые листы) или 12 / 8 (плавнее); отсвет свечей — в картинке
    # мышь пролетает у самого лица (крупнее в 3 раза) — кадры высотой 200; ворон в склепе больше не летает (2026-10-18), лист режется про запас
    for n, old, new, h, key in (("h_bat", (3, 2), (4, 3), 200, "bat"), ("h_raven", (4, 1), (4, 2), 140, "raven")):
        if have(n):
            im = white_alpha(SRC / f"{n}.png"); cols, rows = sprite_grid(im, old, new)
            fr = sprite_frames(im, cols, rows, pad=26); st = halo(strip(fr, h), sigma=h / 40)
            save(f"{n}_strip", st); out[key] = {"n": cols * rows, "w": round(st.width / (cols * rows)), "h": h}
    if have("h_skull_turn"):  # череп поворачивается к зрителю (этап 5): 3 вида в общей рамке — размер не скачет при смене
        for i, im in enumerate(grid_frames(white_alpha(SRC / "h_skull_turn.png"), 3, 1, pad=0), 2): save(f"h_skull{i}", alpha_pad(im))
    if have("h_skull_fire"):  # пламя спереди, белым по чёрному; пустой круг (туда встаёт череп) — центр и радиус в долях ширины
        f = light_mask(SRC / "h_skull_fire.png", lift=12); a = np.asarray(f)[..., 3]; h, w = a.shape
        # огонь расширен, чтобы щели между языками не соединили круг с чёрным фоном вокруг
        lab, _ = ndimage.label(~ndimage.binary_dilation(a >= 40, iterations=8)); ys, xs = np.nonzero(lab == lab[h // 2, w // 2])
        out["skfire"] = {"cx": round(xs.mean() / w, 4), "cy": round(ys.mean() / h, 4), "r": round((float(np.sqrt(len(xs) / np.pi)) + 8) / w, 4)}
        save("h_skull_fire", f)
    if have("h_souls"):  # души вместо болотных огоньков: лица-черепа в пламени, белым по чёрному (цвет — руны)
        for i, im in enumerate(grid_pieces(light_mask(SRC / "h_souls.png", lift=12), 3, 2, thr=20), 1): save(f"h_soul{i}", im)
    if have("h_flame"): save("h_flame", alpha_bbox(light_mask(SRC / "h_flame.png", lift=14), thr=8))
    if have("h_burst"): save("h_burst", alpha_bbox(light_mask(SRC / "h_burst.png", lift=12), thr=8))
    for n, cols, rows, k in (("h_wisps", 3, 2, "h_wisp"), ("h_smoke", 4, 1, "h_smoke"), ("h_candle_flame", 4, 1, "h_cflame")):
        if have(n):
            for i, im in enumerate(grid_pieces(light_mask(SRC / f"{n}.png", lift=12), cols, rows, thr=20), 1): save(f"{k}{i}", im)
    for n, k in (("h_candles", "h_candle"), ("h_pumpkins", "h_pumpkin")):
        if have(n):
            for i, im in enumerate(grid_pieces(white_alpha(SRC / f"{n}.png"), 4, 1), 1): save(f"{k}{i}", im)
    if have("h_fog"):
        f = light_mask(SRC / "h_fog.png", lift=10); w, h = f.size; save("h_fog", f.crop((0, h // 2 - 40, w, h)))
    # этап 6 (идеи пользователя 2026-10-25): пауки и паутина, шарик и клоун, девочка с табличкой, паразит
    if have("h_spider_walk"):  # паук сверху, 8 кадров бега 4×2 — как кадры мыши (тело в одной точке), с отсветом свечей
        fr = sprite_frames(white_alpha(SRC / "h_spider_walk.png"), 4, 2, pad=10); st = halo(strip(fr, 140), sigma=3.5)
        save("h_spider_strip", st); out["spider"] = {"n": len(fr), "w": round(st.width / len(fr)), "h": 140}
    if have("h_web_full"): save("h_web_full", light_mask(SRC / "h_web_full.png", lift=14))
    if have("h_balloon"):  # шарик на нитке; где сам шар (центр и радиус в долях высоты картинки) — чтобы лопнуть его в нужном месте
        b = alpha_bbox(white_alpha(SRC / "h_balloon.png"), thr=20); a = np.asarray(b)[..., 3] > 128
        rows = np.nonzero(a.sum(axis=1) > a.shape[1] * .2)[0]; bulb = rows[rows < rows.min() + a.shape[0] * .5]
        out["balloon"] = {"cy": round(float((bulb.min() + bulb.max()) / 2 / b.height), 4), "r": round(float((bulb.max() - bulb.min()) / 2 / b.height), 4)}
        save("h_balloon", b)
    if have("h_clown"):  # лицо на чёрном; волосы упираются в край кадра — край растворяется
        c = black_alpha(SRC / "h_clown.png"); A = np.asarray(c).copy(); h, w = A.shape[:2]
        e = np.minimum.outer(np.minimum(np.arange(h), np.arange(h)[::-1]), np.minimum(np.arange(w), np.arange(w)[::-1]))
        A[..., 3] = (A[..., 3] * np.clip(e / (w * .04), 0, 1)).round().astype(np.uint8); save("h_clown", Image.fromarray(A, "RGBA"))
    if have("h_girl"):  # две позы по половинам; белый фон между прядями — прозрачный; табличка — самая большая тёплая песочная область
        g = defringe(white_alpha(SRC / "h_girl.png", inner_thr=232, min_area=12))
        p1, p2 = [alpha_bbox(alpha_pad(p), thr=8) for p in grid_frames(g, 2, 1, pad=0)]
        save("h_girl1", p1); save("h_girl2", p2)
        P2 = np.asarray(p2).astype(int); r, gg, bl = P2[..., 0], P2[..., 1], P2[..., 2]
        warm = (P2[..., 3] > 200) & (r > 140) & (r - bl > 28) & (r >= gg) & (gg > bl)
        lab, n = ndimage.label(ndimage.binary_opening(warm, iterations=2))
        if n:
            ys, xs = np.nonzero(lab == 1 + int(np.argmax(ndimage.sum(warm, lab, range(1, n + 1))))); H, W = warm.shape
            out["sign"] = {"l": round(float(xs.min() / W), 4), "t": round(float(ys.min() / H), 4), "w": round(float((xs.max() - xs.min()) / W), 4), "h": round(float((ys.max() - ys.min()) / H), 4)}
            print("табличка девочки:", out["sign"])
    if have("h_hugger"):  # поза прыжка заходит за середину листа — позы по кускам; блики на спине не трогаем (min_area)
        for i, im in enumerate(blob_poses(defringe(white_alpha(SRC / "h_hugger.png", inner_thr=232, min_area=200))), 1): save(f"h_hugger{i}", im)
    if have("h_acid"):  # этап 7: кляксы кислотной крови на чёрном → полупрозрачный свет (как на стекле); центр шлепка — самая толстая
        # часть кляксы (потёки и брызги тоньше), в долях картинки — от него клякса разрастается
        out["acid"] = []
        for i, im in enumerate(grid_pieces(light_rgba(SRC / "h_acid.png", lift=12), 3, 2, thr=20), 1):
            a = np.asarray(im)[..., 3] > 60; d = ndimage.distance_transform_edt(a); cy, cx = ndimage.center_of_mass(d > d.max() * .55)
            out["acid"].append([round(float(cx / im.width), 3), round(float(cy / im.height), 3)]); save(f"h_acid{i}", im)
    return out


def dark_mask(im, lo=40, hi=225):
    """Тушь (чёрное на белом) → белый RGBA, непрозрачность = темнота; цвет задаёт приложение (CSS mask): днём чернила, ночью серебро."""
    L = np.asarray(im.convert("L")).astype(float)
    a = np.clip((hi - L) / (hi - lo), 0, 1)
    out = np.zeros(L.shape + (4,), np.uint8); out[..., :3] = 255; out[..., 3] = (a * 255).round()
    return Image.fromarray(out, "RGBA")


def alpha_bbox(im, thr=10, pad=0):
    ys, xs = np.where(np.asarray(im)[..., 3] > thr)
    return im.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + pad + 1), min(im.height, ys.max() + pad + 1)))


def sheet_pieces(im, dil=10, min_px=400):
    """Отдельные предметы на листе (по непрозрачному с расширением, чтобы части одного предмета склеились) → рамки (x0, y0, x1, y1)."""
    a = np.asarray(im)[..., 3] > 20
    lab, _ = ndimage.label(ndimage.binary_dilation(a, iterations=dil))
    res = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        m = (lab[sl] == i + 1) & a[sl]
        if m.sum() < min_px: continue
        ys, xs = np.where(m)
        res.append((sl[1].start + xs.min(), sl[0].start + ys.min(), sl[1].start + xs.max() + 1, sl[0].start + ys.max() + 1))
    return res


def grid_pieces(mask, cols, rows, thr=24, pad=8):
    """Лист предметов ровной сеткой. Каждый связный кусок относится к клетке, где лежит его центр (предмет может заходить
    за границу клетки, а части предмета — лежать отдельно: три ромба, звезда у месяца); чужое в рамку не попадает → квадрат."""
    W, H = mask.size; arr = np.asarray(mask); a = arr[..., 3]
    lab, n = ndimage.label(ndimage.binary_dilation(a > thr, iterations=3))
    cent = ndimage.center_of_mass(a > thr, lab, range(1, n + 1))
    cell = {}
    for i, (cy, cx) in enumerate(cent, 1):
        if np.isnan(cy): continue
        cell.setdefault(min(rows - 1, int(cy / H * rows)) * cols + min(cols - 1, int(cx / W * cols)), []).append(i)
    out = []
    for k in range(cols * rows):
        m = np.isin(lab, cell.get(k, [])) & (a > 0)
        if not m.any(): out.append(Image.new("RGBA", (8, 8), (255, 255, 255, 0))); continue
        ys, xs = np.where(m)
        x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + 1 + pad), min(H, ys.max() + 1 + pad)
        sub = arr[y0:y1, x0:x1].copy(); sub[..., 3] = np.where(m[y0:y1, x0:x1], sub[..., 3], 0)
        crop = Image.fromarray(sub, "RGBA"); s = max(crop.size); sq = Image.new("RGBA", (s, s), (255, 255, 255, 0))
        sq.paste(crop, ((s - crop.width) // 2, (s - crop.height) // 2)); out.append(sq)
    return out


def skins():
    """Стили оформления (раздел 9–10 промптов): «Лунная гравюра» (c_…) и «Витраж во тьме» (d_…) → art/cut, размеры — в meta.skins."""
    out = {}
    def save(name, im):
        im.save(OUT / f"{name}.png"); out[name] = list(im.size)
    if (SRC / "c_engraving.png").exists():  # шапка дня: средняя полоса гравюры, маска туши
        e = Image.open(SRC / "c_engraving.png"); w, h = e.size
        save("c_engr", dark_mask(e.crop((0, round(h * .24), w, round(h * .767))), lo=30, hi=235))
    if (SRC / "c_frontis.png").exists():  # заставка: белое от края кадра — прозрачно, внутри арки — позитив холодным серебром
        L = np.asarray(Image.open(SRC / "c_frontis.png").convert("L")).astype(float)
        lab, _ = ndimage.label(L > 238)
        edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]); edge.discard(0)
        al = np.asarray(Image.fromarray(np.where(np.isin(lab, list(edge)), 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
        rgb = (L[..., None] / 255 * np.array([0.80, 0.84, 0.93]) * 235).clip(0, 255).astype(np.uint8)
        save("c_frontis", alpha_bbox(Image.fromarray(np.dstack([rgb, al]), "RGBA")))
    if (SRC / "c_ornaments.png").exists():  # лист: 3 разделителя сверху, венок и 4 уголка снизу
        o = dark_mask(Image.open(SRC / "c_ornaments.png"), lo=40, hi=230)
        bs = sheet_pieces(o)
        top = sorted([b for b in bs if b[3] < o.height * .35], key=lambda b: b[0])
        low = [b for b in bs if b[1] >= o.height * .3]
        wr = max(low, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        cor = sorted([b for b in low if b != wr], key=lambda b: (round(b[1] / 120), b[0]))
        for n, b in zip(["c_fl_short", "c_fl_mid", "c_fl_long"], top): save(n, o.crop(b))
        save("c_wreath", o.crop(wr))
        for n, b in zip(["c_cor_tl", "c_cor_tr", "c_cor_bl", "c_cor_br"], cor): save(n, o.crop(b))
        print("украшения гравюры:", len(top), "разделителя,", len(cor), "уголка")
    if (SRC / "c_night.png").exists():  # ночная шапка: белым по чёрному → маска света (серебро задаёт CSS)
        n = light_mask(SRC / "c_night.png", lift=22); w, h = n.size
        save("c_night", n.crop((0, round(h * .21), w, round(h * .775))))
    names = {"c_tabs": (4, 2, ["setup_day", "night", "setup", "table", "log", "roles", "menu", "candle"]),
             "c_glyphs": (4, 2, ["dusk", "dawn", "minioninfo", "demoninfo", "nominate", "vote", "execute", "dead"])}
    for src, (cols, rows, keys) in names.items():  # листы тушью: по сетке, каждый предмет — в квадрат
        if not (SRC / f"{src}.png").exists(): continue
        pre = "c_tab_" if src == "c_tabs" else "c_g_"
        for k, im in zip(keys, grid_pieces(dark_mask(Image.open(SRC / f"{src}.png"), lo=40, hi=225), cols, rows)):
            save(pre + ("day" if k == "setup_day" else k), im)
    if (SRC / "c_emblems.png").exists():  # эмблемы карточек показа: белым по чёрному, 5×3
        keys = ["demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yourrole", "yes", "no", "good", "evil",
                "general_good", "general_evil", "general_neither", "moon"]
        for k, im in zip(keys, grid_pieces(light_mask(SRC / "c_emblems.png", lift=26), 5, 3, thr=40)):
            save("c_em_" + k, im)
    for k in ("c_win_good", "c_win_evil"):  # экраны победы: тушь цветом чернил (экран конца игры всегда светлый)
        if (SRC / f"{k}.png").exists():
            m = alpha_bbox(dark_mask(Image.open(SRC / f"{k}.png"), lo=30, hi=232), thr=30, pad=4)
            a = np.asarray(m).copy(); a[..., 0], a[..., 1], a[..., 2] = 26, 26, 32
            save(k, Image.fromarray(a, "RGBA"))
    if (SRC / "c_dial.png").exists():  # кольцо-циферблат под кругом Гримуара
        save("c_dial", alpha_bbox(dark_mask(Image.open(SRC / "c_dial.png"), lo=40, hi=230), thr=30))
    if (SRC / "d_tabs.png").exists():  # витражные значки вкладок: на белом, 4×2
        for k, im in zip(["day", "night", "setup", "table", "log", "roles", "menu", "candle"], grid_pieces(white_alpha(SRC / "d_tabs.png"), 4, 2)):
            save("d_tab_" + k, im)
    for n in ("d_rose2", "d_rose"):  # роза: приглушённая (d_rose2), пока её нет — пробная
        if (SRC / f"{n}.png").exists():
            save("d_rose", alpha_bbox(white_alpha(SRC / f"{n}.png"))); break
    return out


def digits(name="digits", prefix="digit", light=False):
    """Цифры 0–9 (digits.png, 2 строки по 5): каждая — по своей клетке; высота — по строке, чтобы все цифры были одного роста.
    Свои цифры оформлений: d_digits — витражные (на белом, как основные), h_digits — пламя тёмной магии на чёрном (light: свет →
    прозрачность, клетки ровной сеткой — свечение соседних цифр может слипаться; кусок — в клетку своего центра, как grid_pieces,
    но рамка — по ширине самой цифры (не квадрат: в «12» цифры стояли бы врозь) и по высоте всей строки (все одного роста))."""
    if not (SRC / f"{name}.png").exists():
        return 0
    if light:
        arr = np.asarray(light_rgba(SRC / f"{name}.png", lift=12)).copy(); a = arr[..., 3]; H, W = a.shape
        lab, n = ndimage.label(ndimage.binary_dilation(a > 30, iterations=3))
        idx = range(1, n + 1); cent = ndimage.center_of_mass(a > 30, lab, idx); area = ndimage.sum(a > 30, lab, idx)
        cell, box = {}, {}
        for i, (cy, cx) in enumerate(cent, 1):
            if np.isnan(cy): continue
            k = min(1, int(cy / H * 2)) * 5 + min(4, int(cx / W * 5)); cell.setdefault(k, []).append(i)
            if area[i - 1] < 400: continue  # искры по краям рамку не раздувают (внутри неё остаются)
            ys, xs = np.where(lab == i); b = box.get(k, (W, H, 0, 0))
            box[k] = (min(b[0], xs.min()), min(b[1], ys.min()), max(b[2], xs.max() + 1), max(b[3], ys.max() + 1))
        band = [(min(b[1] for k, b in box.items() if k // 5 == r), max(b[3] for k, b in box.items() if k // 5 == r)) for r in (0, 1)]
        for k, (x0, _, x1, _) in sorted(box.items()):
            y0, y1 = band[k // 5]
            sub = arr[y0:y1, x0:x1].copy(); sub[..., 3] = np.where(np.isin(lab[y0:y1, x0:x1], cell[k]), sub[..., 3], 0)
            d = Image.fromarray(sub, "RGBA"); d.resize((round(d.width * 220 / d.height), 220), Image.LANCZOS).save(OUT / f"{prefix}{k}.png")
        print(f"цифр ({name}):", len(box))
        return len(box)
    im = white_alpha(SRC / f"{name}.png", edge_thr=215, inner_thr=205)  # в золотых цифрах белого нет — режем и светлую кайму в «дырках»
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
        d.save(OUT / f"{prefix}{k}.png")
    print(f"цифр ({name}):", len(cols))
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
         "card_yourrole", "card_yes", "card_no", "card_good", "card_evil",
         "card_general_good", "card_general_evil", "card_general_neither"]


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

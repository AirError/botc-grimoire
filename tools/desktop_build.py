"""Собирает настольные версии «Гримуара»: Windows (x64) и macOS (Intel, Apple Silicon).

Windows — через @electron/packager (иконка и сведения о программе прописываются в .exe).
macOS — сборка прямо из официального архива Electron: приложение кладётся в Contents/Resources/app,
иконка и имя меняются в Info.plist. Архив пишется заново с сохранением символических ссылок и прав,
поэтому фреймворки Electron остаются целыми (упаковщик на Windows этого не умеет).
"""
import hashlib
import os
import plistlib
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
# тяжёлое — вне проекта (он в OneDrive); окружение готовит tools/setup_env.py
HOME = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "botc-grimoire"
DESK = HOME / "desktop"                      # рабочая папка сборки: package.json, main.js, index.html, node_modules
BUILD = DESK / "build"
OUT = ROOT / "out" / "desktop"
CACHE = HOME / "electron_cache"
for d in (BUILD, OUT, CACHE):
    d.mkdir(parents=True, exist_ok=True)

ELECTRON = "44.5.1"
NAME = "Гримуар"
NODE = next((HOME / "node").glob("node-v24*"))
APP_FILES = ["package.json", "main.js", "index.html"]

# 1. файлы приложения в рабочую папку
for f in ("package.json", "main.js"):
    shutil.copy2(ROOT / "app" / "desktop" / f, DESK / f)
shutil.copy2(ROOT / "app" / "dist" / "preview.html", DESK / "index.html")

# 2. иконки: Windows — квадрат со слегка скруглёнными углами, macOS — по сетке Apple (824 из 1024, радиус ~185)
src = Image.open(ROOT / "art" / "src" / "app_icon.png").convert("RGBA").resize((1024, 1024), Image.LANCZOS)


def rounded(im, size, inner, radius):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    art = im.resize((inner, inner), Image.LANCZOS)
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, inner - 1, inner - 1), radius=radius, fill=255)
    off = (size - inner) // 2
    canvas.paste(art, (off, off), mask)
    return canvas


win_icon = rounded(src, 1024, 1024, 120)
win_icon.save(BUILD / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
mac_icon = rounded(src, 1024, 824, 185)
mac_icon.save(BUILD / "icon.icns")
mac_icon.save(BUILD / "icon.png")

# 3. Windows через упаковщик
env = dict(os.environ, PATH=str(NODE) + os.pathsep + os.environ["PATH"])
win_dir = OUT / f"{NAME}-win32-x64"
subprocess.run(
    [str(NODE / "npx.cmd"), "--no-install", "electron-packager", ".", NAME,
     "--platform=win32", "--arch=x64", f"--electron-version={ELECTRON}", f"--out={OUT}", "--overwrite",
     f"--icon={BUILD / 'icon.ico'}", f"--executable-name={NAME}", "--app-version=1.0.0",
     "--win32metadata.CompanyName=Alex", "--win32metadata.FileDescription=Гримуар рассказчика",
     "--win32metadata.ProductName=Гримуар рассказчика", "--ignore=^/build", "--ignore=^/node_modules",
     "--prune=false"],
    cwd=DESK, env=env, check=True)
win_zip = OUT / f"{NAME}-Windows.zip"
if win_zip.exists():
    win_zip.unlink()
shutil.make_archive(str(win_zip.with_suffix("")), "zip", OUT, win_dir.name)


# 4. macOS из официальных архивов
def fetch(name):
    dst = CACHE / name
    if not dst.exists():
        url = f"https://github.com/electron/electron/releases/download/v{ELECTRON}/{name}"
        urllib.request.urlretrieve(url, dst)
    return dst


sums = {}
for line in fetch("SHASUMS256.txt").read_text().splitlines():
    h, _, fname = line.partition(" ")
    sums[fname.lstrip("*").strip()] = h


def build_mac(arch, label):
    zname = f"electron-v{ELECTRON}-darwin-{arch}.zip"
    zpath = fetch(zname)
    digest = hashlib.sha256(zpath.read_bytes()).hexdigest()
    assert digest == sums[zname], f"контрольная сумма не совпала: {zname}"
    out = OUT / f"{NAME}-Mac-{label}.zip"
    icns = (BUILD / "icon.icns").read_bytes()
    with zipfile.ZipFile(zpath) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if not info.filename.startswith("Electron.app/"):
                continue  # LICENSE, version и прочее рядом с .app не нужны
            rest = info.filename[len("Electron.app/"):]
            if rest == "Contents/Resources/default_app.asar":
                continue  # демо-приложение Electron
            data = zin.read(info)
            if rest == "Contents/Info.plist":
                pl = plistlib.loads(data)
                pl["CFBundleName"] = NAME
                pl["CFBundleDisplayName"] = NAME
                pl["CFBundleShortVersionString"] = "1.0.0"
                pl["CFBundleVersion"] = "1.0.0"
                data = plistlib.dumps(pl, fmt=plistlib.FMT_XML)
            elif rest == "Contents/Resources/electron.icns":
                data = icns
            new = zipfile.ZipInfo(f"{NAME}.app/{rest}", info.date_time)
            new.external_attr, new.create_system, new.compress_type = info.external_attr, 3, info.compress_type
            zout.writestr(new, data)
        for f in APP_FILES:
            new = zipfile.ZipInfo(f"{NAME}.app/Contents/Resources/app/{f}", (2026, 10, 4, 12, 0, 0))
            new.external_attr, new.create_system, new.compress_type = 0o100644 << 16, 3, zipfile.ZIP_DEFLATED
            zout.writestr(new, (DESK / f).read_bytes())
    return out


macs = [build_mac("arm64", "AppleSilicon"), build_mac("x64", "Intel")]

for f in [win_zip, *macs]:
    print(f"{f.name}: {f.stat().st_size / 1024 / 1024:.0f} МБ")

"""Восстанавливает окружение сборки одной командой:  python tools\\setup_env.py

Всё тяжёлое кладётся ВНЕ папки проекта (она в OneDrive — синхронизировать тысячи файлов незачем):
  %LOCALAPPDATA%\\botc-grimoire\\venv      — Python-окружение: pillow, numpy, scipy, pymupdf
  %LOCALAPPDATA%\\botc-grimoire\\node      — портативный Node.js (для Electron-сборок)
  %LOCALAPPDATA%\\botc-grimoire\\git       — портативный MinGit
  %LOCALAPPDATA%\\botc-grimoire\\desktop   — рабочая папка Electron-сборки (+ node_modules)
Скачивает только недостающее; контрольные суммы проверяются.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "botc-grimoire"
VENV, NODE_DIR, GIT_DIR, DESK = HOME / "venv", HOME / "node", HOME / "git", HOME / "desktop"
NODE_VER = "v24.21.0"
HOME.mkdir(parents=True, exist_ok=True)


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def get(url, dst):
    if not dst.exists():
        print("  скачиваю", url)
        urllib.request.urlretrieve(url, dst)
    return dst


# 1. Python-окружение
py = VENV / "Scripts" / "python.exe"
if not py.exists():
    print("venv:", VENV)
    subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
subprocess.run([str(py), "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                "pillow", "numpy", "scipy", "pymupdf"], check=True)
print("Python-пакеты: ок")

# 2. Node.js
node_home = NODE_DIR / f"node-{NODE_VER}-win-x64"
if not (node_home / "node.exe").exists():
    NODE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"node-{NODE_VER}-win-x64.zip"
    z = get(f"https://nodejs.org/dist/{NODE_VER}/{name}", NODE_DIR / name)
    sums = urllib.request.urlopen(f"https://nodejs.org/dist/{NODE_VER}/SHASUMS256.txt", timeout=30).read().decode()
    assert sha256(z) in sums, "контрольная сумма Node.js не совпала"
    with zipfile.ZipFile(z) as f:
        f.extractall(NODE_DIR)
print("Node.js:", node_home)

# 3. MinGit
git = GIT_DIR / "cmd" / "git.exe"
if not git.exists():
    final = urllib.request.urlopen("https://github.com/git-for-windows/git/releases/latest", timeout=30).geturl()
    tag = final.rstrip("/").split("/")[-1]                       # v2.56.0.windows.1
    ver = re.sub(r"\.windows\.\d+$", "", tag.lstrip("v"))        # 2.56.0
    name = f"MinGit-{ver}-64-bit.zip"
    z = get(f"https://github.com/git-for-windows/git/releases/download/{tag}/{name}", HOME / name)
    page = urllib.request.urlopen(f"https://github.com/git-for-windows/git/releases/tag/{tag}", timeout=30).read().decode("utf-8", "replace")
    assert sha256(z) in page, "контрольная сумма MinGit не совпала"
    with zipfile.ZipFile(z) as f:
        f.extractall(GIT_DIR)
print("git:", git)

# 4. Рабочая папка Electron + упаковщик
DESK.mkdir(parents=True, exist_ok=True)
for f in ("package.json", "package-lock.json", "main.js"):
    if (ROOT / "app" / "desktop" / f).exists():
        shutil.copy2(ROOT / "app" / "desktop" / f, DESK / f)
if not (DESK / "node_modules" / "@electron" / "packager").exists():
    env = dict(os.environ, PATH=str(node_home) + os.pathsep + os.environ["PATH"])
    subprocess.run([str(node_home / "npm.cmd"), "install", "--no-audit", "--no-fund"], cwd=DESK, env=env, check=True)
print("Electron-упаковщик: ок")
print("\nГотово. Python для сборки:", py)

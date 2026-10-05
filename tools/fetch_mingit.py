"""Скачивает портативный MinGit (официальный Git для Windows без установки) и распаковывает в tools/git."""
import hashlib
import re
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DL = ROOT / "tools" / "git_dl"
DST = ROOT / "tools" / "git"
DL.mkdir(parents=True, exist_ok=True)

final = urllib.request.urlopen("https://github.com/git-for-windows/git/releases/latest", timeout=30).geturl()
tag = final.rstrip("/").split("/")[-1]                      # v2.xx.y.windows.N
ver = re.sub(r"\.windows\.\d+$", "", tag.lstrip("v"))
name = f"MinGit-{ver}-64-bit.zip"
url = f"https://github.com/git-for-windows/git/releases/download/{tag}/{name}"
dst = DL / name
if not dst.exists():
    urllib.request.urlretrieve(url, dst)
digest = hashlib.sha256(dst.read_bytes()).hexdigest()
page = urllib.request.urlopen(f"https://github.com/git-for-windows/git/releases/tag/{tag}", timeout=30).read().decode("utf-8", "replace")
print(f"{tag}: {name}, {dst.stat().st_size / 1024 / 1024:.1f} МБ, контрольная сумма указана в релизе: {digest in page}")
with zipfile.ZipFile(dst) as z:
    z.extractall(DST)
print("git:", DST / "cmd" / "git.exe")

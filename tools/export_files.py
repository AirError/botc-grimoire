"""Раскладывает готовые файлы в «Загрузки\\Гримуар»: сборки, листы PDF, сайт, JSON сценария, промпты.

python tools\\export_files.py      (без зависимостей; запускать после сборок — берёт то, что уже лежит в out/)
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DL = Path.home() / "Downloads" / "Гримуар"
DL.mkdir(parents=True, exist_ok=True)

FILES = [
    *[(z, z.name) for z in sorted((OUT / "desktop").glob("*.zip"))],
    (OUT / "roles.pdf", "Everyone Can Be Evil — роли.pdf"),
    (OUT / "night.pdf", "Everyone Can Be Evil — ночной порядок.pdf"),
    (ROOT / "four_demons_script.json", "Everyone Can Be Evil.json"),
    (ROOT / "gpt_art_prompts.md", "Промпты для GPT.md"),
]
for src, name in FILES:
    if src.exists():
        shutil.copy2(src, DL / name)
        print("  ", name)
    else:
        print("   нет (не собрано):", src.relative_to(ROOT))

site = OUT / "site"
if site.exists():
    dst = DL / "Сайт для GitHub Pages"
    # чистим содержимое, а не саму папку: Windows иногда не даёт удалить пустую папку
    dst.mkdir(exist_ok=True)
    for f in dst.iterdir():
        shutil.rmtree(f) if f.is_dir() else f.unlink()
    shutil.copytree(site, dst, dirs_exist_ok=True)
    print("   Сайт для GitHub Pages/")
else:
    print("   нет (не собрано): out/site")
print("Загрузки:", DL)

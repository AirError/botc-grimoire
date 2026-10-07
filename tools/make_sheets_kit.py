"""Архив для переноса работы над сценарием в новый чат: инструкция, сценарий, скрипты листов, готовый арт, иконки, текущие PDF.

python tools\\make_sheets_kit.py  →  Downloads\\Гримуар\\Перенос\\
"""
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DST = Path.home() / "Downloads" / "Гримуар" / "Перенос"
DST.mkdir(parents=True, exist_ok=True)
ZIP = DST / "Сценарий — набор для нового чата.zip"
MD = "ПЕРЕНОС_сценарий.md"

files = [(ROOT / MD, MD), (ROOT / "CLAUDE.md", "CLAUDE.md"),
         (ROOT / "four_demons_script.json", "Everyone Can Be Evil.json"),
         (ROOT / "gpt_art_prompts.md", "gpt_art_prompts.md")]
for name in ("build_sheets.py", "sheet_data.py", "render.py", "prep_art.py", "zoom_pdf.py", "peek.py",
             "probe_sizes.py", "setup_env.py"):
    files.append((ROOT / "tools" / name, f"tools/{name}"))
files += [(p, f"art/cut/{p.name}") for p in sorted((ROOT / "art" / "cut").iterdir()) if p.is_file()]
files += [(p, f"app/icons/{p.name}") for p in sorted((ROOT / "app" / "icons").glob("*.webp"))]
files += [(ROOT / "sheets" / "roles.pdf", "sheets/roles.pdf"), (ROOT / "sheets" / "night.pdf", "sheets/night.pdf")]

with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    for src, arc in files:
        if src.exists():
            z.write(src, arc)
shutil.copy2(ROOT / MD, DST / MD)
print(f"{ZIP.name}: {ZIP.stat().st_size / 1024 / 1024:.1f} МБ, файлов: {len(files)}")
print("инструкция:", DST / MD)

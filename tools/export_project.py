"""1) Раскладывает готовые файлы в «Загрузки\\Гримуар».  2) Собирает постоянную папку проекта (будущий git-репозиторий).

python tools/export_project.py <папка проекта>
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DL = Path.home() / "Downloads" / "Гримуар"
PROJ = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Documents" / "botc-grimoire"

# --- 1. готовые файлы для пользователя
DL.mkdir(parents=True, exist_ok=True)
site_dl = DL / "Сайт для GitHub Pages"
if site_dl.exists():
    shutil.rmtree(site_dl)
shutil.copytree(ROOT / "out" / "site", site_dl)
for z in (ROOT / "out" / "desktop").glob("*.zip"):
    shutil.copy2(z, DL / z.name)
shutil.copy2(ROOT / "out" / "roles.pdf", DL / "Everyone Can Be Evil — роли.pdf")
shutil.copy2(ROOT / "out" / "night.pdf", DL / "Everyone Can Be Evil — ночной порядок.pdf")
shutil.copy2(ROOT / "four_demons_script.json", DL / "Everyone Can Be Evil.json")
shutil.copy2(ROOT / "gpt_art_prompts.md", DL / "Промпты для GPT.md")
print("Загрузки:", DL)

# --- 2. папка проекта: исходники, данные, арт, инструменты; собранный сайт — в docs/ (для GitHub Pages)
PROJ.mkdir(parents=True, exist_ok=True)
COPY = [
    "app/src", "app/data", "app/test", "app/icons",
    "app/desktop/package.json", "app/desktop/package-lock.json", "app/desktop/main.js",
    "art/src", "tools", "four_demons_script.json", "gpt_art_prompts.md", ".claude/launch.json",
]
SKIP_DIRS = {"node_dl", "git_dl", "git", "electron_cache", "__pycache__"}


def ignore(dirpath, names):
    return [n for n in names if n in SKIP_DIRS or n.endswith(".pyc")]


for rel in COPY:
    src, dst = ROOT / rel, PROJ / rel
    if not src.exists():
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=ignore)
    else:
        shutil.copy2(src, dst)
docs = PROJ / "docs"
if docs.exists():
    shutil.rmtree(docs)
shutil.copytree(ROOT / "out" / "site", docs)
for pdf in ("roles.pdf", "night.pdf"):
    (PROJ / "sheets").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "out" / pdf, PROJ / "sheets" / pdf)

(PROJ / ".gitignore").write_text("""# окружение и скачиваемые инструменты — восстанавливаются скриптами (см. CLAUDE.md)
.venv/
node_modules/
tools/node_dl/
tools/git_dl/
tools/git/
tools/electron_cache/
__pycache__/
# промежуточные и большие файлы сборки
out/
app/dist/
app/desktop/index.html
app/desktop/build/
art/cut/
art/*.jpg
""", encoding="utf-8")
print("Проект:", PROJ)

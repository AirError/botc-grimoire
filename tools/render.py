"""HTML → PDF через headless Edge (как печать в браузере) → PNG для осмотра; печатает итог автоподгонки."""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE = Path(tempfile.gettempdir()) / "ecbe_edge_profile"


def edge(*args):
    cmd = [EDGE, "--headless=new", "--disable-gpu", f"--user-data-dir={PROFILE}",
           "--no-first-run", "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw", *args]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)


def render(name, dpi=70):
    html = OUT / f"{name}.html"
    pdf = OUT / f"{name}.pdf"
    url = html.resolve().as_uri()
    edge("--no-pdf-header-footer", f"--print-to-pdf={pdf.resolve()}", url)
    dom = edge("--dump-dom", url).stdout
    fit = re.search(r'data-fit="([^"]*)"', dom)
    doc = fitz.open(pdf)
    print(f"{name}: страниц {doc.page_count}; автоподгонка: {fit.group(1) if fit else 'нет данных'}")
    for i, page in enumerate(doc):
        page.get_pixmap(dpi=dpi).save(OUT / f"{name}_p{i + 1}.png")


if __name__ == "__main__":
    for n in sys.argv[1:] or ["roles", "night"]:
        render(n)

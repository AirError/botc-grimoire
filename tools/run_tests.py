"""Запускает app/test/test.html в headless Edge и печатает результаты."""
import html
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
url = (ROOT / "app" / "test" / "test.html").resolve().as_uri()
out = subprocess.run([EDGE, "--headless=new", "--disable-gpu", f"--user-data-dir={Path(tempfile.gettempdir()) / 'ecbe_edge_test'}",
                      "--allow-file-access-from-files", "--virtual-time-budget=5000", "--dump-dom", url],
                     capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120).stdout
m = re.search(r'<pre id="out">(.*?)</pre>', out, re.S)
text = html.unescape(m.group(1)) if m else out[:2000]
print(text)
lines = text.splitlines()
print(f"\nИтого: {sum(l.startswith('PASS') for l in lines)} PASS, {sum(l.startswith(('FAIL', 'ERROR')) for l in lines)} FAIL/ERROR")

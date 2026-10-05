"""Одноразовый патч: вставляет одностраничную вёрстку ролей в build_sheets.py."""
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
p = TOOLS / "build_sheets.py"
s = p.read_text(encoding="utf-8")
a = s.index("# ---------------------------------------------------------------- лист ролей")
b = s.index("# ---------------------------------------------------------------- лист ночей")
s = s[:a] + (TOOLS / "roles_one_page.py").read_text(encoding="utf-8") + s[b:]
s = s.replace("roles.html (2 стороны) и night.html", "roles.html (одна страница, злая рамка снизу) и night.html")
old_main = '''    build_roles()
    build_night()
    for f in ("roles.html", "night.html"):'''
new_main = '''    build_roles("roles", 48)
    build_roles("roles_nowin", 0)
    build_night()
    for f in ("roles.html", "roles_nowin.html", "night.html"):'''
assert old_main in s
s = s.replace(old_main, new_main)
p.write_text(s, encoding="utf-8")
print("ok")

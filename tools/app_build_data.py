"""Собирает app/src/data.js из официальных данных (botc-release + botc-translations/ru).

Берём все роли из официальных данных: базовая коробка (Trouble Brewing, Bad Moon Rising, Sects & Violets),
экспериментальные (Carousel), Странники, Сказочники и Лорики. Встроенные сценарии — из коробки и Catfishing.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "app" / "data"
EDITIONS = ("tb", "bmr", "snv")

roles_en = json.loads((D / "roles.json").read_text(encoding="utf-8"))
night = json.loads((D / "nightsheet.json").read_text(encoding="utf-8"))
jinx_en = json.loads((D / "jinxes.json").read_text(encoding="utf-8"))
ru = json.loads((D / "ru.json").read_text(encoding="utf-8"))


def rkey(label):
    return re.sub(r"[^a-z0-9]", "", label.lower())


def ru_reminder(label):
    return ru["reminders"].get(rkey(label), label)


# Свойства ролей, которые меняют общий ход игры. Логика движка смотрит на свойство, а не на конкретную роль.
# prevents_evil_meeting — пока роль в игре и её способность работает, Приспешники и Демон не знакомятся;
#   Демон в 1-ю ночь получает только блефы; после смерти (трезвым) злые знакомятся в ту же ночь.
PROPS = {"poppygrower": {"prevents_evil_meeting": True}}
# опечатки официального перевода
TEXT_FIX = {
    ("widow", "first"): "Показывайте Вдове Гримуар столько, сколько ей нужно. Вдова выбирает игрока. :reminder: "
                        "Усыпите Вдову. Разбудите игрока с меткой *РАСКРЫТЫЙ* и покажите ему жетон Вдовы. :reminder:",
}


# справочник: «как вести», «важно», «советы» — пересказ вики своими словами (app/data/guide/*.json);
# для ролей без официального перевода там же неофициальные name/ability
guide = {}
for f in sorted((D / "guide").glob("*.json")):
    guide.update(json.loads(f.read_text(encoding="utf-8")))

# В данные идут все роли: базовая коробка, экспериментальные (Carousel), Странники, Сказочники и Лорики —
# справочник и свои сценарии. Встроенные сценарии — только из коробки (+ Catfishing). box — роль из базовой коробки.
roles = {}
for r in roles_en:
    t = ru["roles"].get(r["id"], {})
    rid, g = r["id"], guide.get(r["id"], {})
    roles[rid] = {
        "id": rid,
        "name": t.get("name") or g.get("name") or r["name"],
        "en": r["name"],
        "team": r["team"],
        "edition": r["edition"],
        "box": r["edition"] in EDITIONS or r["team"] == "fabled" and r["edition"] == "fabled",
        "ability": t.get("ability") or g.get("ability") or r["ability"],
        "unofficial": not t.get("name"),  # нет официального перевода — название и способность переведены нами
        "first": (t.get("first") or r.get("firstNightReminder")) if r.get("firstNightReminder") else None,
        "other": (t.get("other") or r.get("otherNightReminder")) if r.get("otherNightReminder") else None,
        "reminders": [ru_reminder(x) for x in r.get("reminders", [])],
        "setup": bool(r.get("setup")),
        "props": PROPS.get(rid, {}),
    }
    for (fid, part), text in TEXT_FIX.items():
        if fid == rid:
            roles[rid][part] = text

special = {k: ru["roles"][k] for k in ("dusk", "dawn", "minioninfo", "demoninfo")}

keep = set(roles) | set(special)
order = {
    "first": [x for x in night["firstNight"] if x in keep],
    "other": [x for x in night["otherNight"] if x in keep],
}

# джинксы между ролями базовой коробки (в ней их почти нет, но для своих сценариев пригодится)
jinxes = {}
for entry in jinx_en:
    a = entry["id"]
    for j in entry["jinx"]:
        b = j["id"]
        if a in roles and b in roles:
            text = ru["jinxes"].get(f"{a}-{b}") or ru["jinxes"].get(f"{b}-{a}") or j["reason"]
            jinxes[f"{a}|{b}"] = text

def edition_script(ed):
    return [rid for rid, r in roles.items() if r["edition"] == ed and r["team"] in ("townsfolk", "outsider", "minion", "demon")]


travellers = [rid for rid, r in roles.items() if r["team"] == "traveller"]
fabled = [rid for rid, r in roles.items() if r["team"] == "fabled"]

scripts = {
    "ecbe": {"name": "Everyone Can Be Evil", "roles": [
        "librarian", "clockmaker", "grandmother", "fortuneteller", "tealady", "monk", "undertaker",
        "gambler", "artist", "courtier", "seamstress", "mayor", "fool",
        "barber", "recluse", "moonchild", "klutz",
        "eviltwin", "devilsadvocate", "witch", "godfather",
        "imp", "pukka", "nodashii", "fanggu"]},
    # Catfishing 11.1 by Emily (botcscripts.com/script/3/11.1.0); Странники — рекомендованные сценарием
    "catfishing": {"name": "Catfishing", "roles": [
        "investigator", "chef", "grandmother", "balloonist", "dreamer", "fortuneteller", "snakecharmer",
        "gambler", "savant", "philosopher", "ravenkeeper", "amnesiac", "cannibal",
        "drunk", "recluse", "sweetheart", "mutant", "lunatic",
        "godfather", "cerenovus", "pithag", "widow",
        "imp", "vigormortis", "fanggu"],
        "travellers": ["beggar", "barista", "apprentice", "harlot", "bonecollector"]},
    "tb": {"name": "Trouble Brewing", "roles": edition_script("tb")},
    "bmr": {"name": "Bad Moon Rising", "roles": edition_script("bmr")},
    "snv": {"name": "Sects & Violets", "roles": edition_script("snv")},
}
for s in scripts.values():
    missing = [x for x in s["roles"] + s.get("travellers", []) if x not in roles]
    assert not missing, missing

no_guide = [rid for rid in roles if rid not in guide]
assert not no_guide, f"нет справки для ролей: {no_guide}"
guide = {rid: {k: g[k] for k in ("how", "rules", "tips") if k in g} for rid, g in guide.items() if rid in roles}

data = {"roles": roles, "special": special, "order": order, "jinxes": jinxes, "scripts": scripts,
        "travellers": travellers, "fabled": fabled, "guide": guide}
out = ROOT / "app" / "src" / "data.js"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("const DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
               encoding="utf-8")
print(f"ролей: {len(roles)}, первая ночь: {len(order['first'])} шагов, последующие: {len(order['other'])}, "
      f"джинксов: {len(jinxes)}, размер: {out.stat().st_size // 1024} КБ")

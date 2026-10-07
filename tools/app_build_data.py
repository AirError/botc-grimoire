"""Собирает app/src/data.js из официальных данных (botc-release + botc-translations/ru).

Берём роли базовой коробки: Trouble Brewing, Bad Moon Rising, Sects & Violets — и отдельные роли
не из коробки, которые нужны сценариям или свойствам (EXTRA).
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
# роли не из базовой коробки, которые нужны сценариям (Catfishing — по просьбе пользователя, роли из Carousel)
CATFISHING_EXTRA = {"balloonist", "amnesiac", "cannibal", "widow"}
EXTRA = set(PROPS) | CATFISHING_EXTRA  # такие роли берём в данные, даже если они не из базовой коробки
# опечатки официального перевода
TEXT_FIX = {
    ("widow", "first"): "Показывайте Вдове Гримуар столько, сколько ей нужно. Вдова выбирает игрока. :reminder: "
                        "Усыпите Вдову. Разбудите игрока с меткой *РАСКРЫТЫЙ* и покажите ему жетон Вдовы. :reminder:",
}


def wanted(r):
    if r["id"] in EXTRA:
        return True
    if r["team"] == "fabled":
        return r.get("edition") == "fabled"
    if r["team"] == "traveller":
        return r.get("edition") in EDITIONS
    return r.get("edition") in EDITIONS and r["team"] in ("townsfolk", "outsider", "minion", "demon")


roles = {}
for r in roles_en:
    if not wanted(r):
        continue
    t = ru["roles"].get(r["id"], {})
    rid = r["id"]
    roles[rid] = {
        "id": rid,
        "name": t.get("name", r["name"]),
        "en": r["name"],
        "team": r["team"],
        "edition": r["edition"],
        "ability": t.get("ability", r["ability"]),
        "first": t.get("first") if r.get("firstNightReminder") else None,
        "other": t.get("other") if r.get("otherNightReminder") else None,
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

# справочник: «как вести», «важно», «советы» — пересказ вики своими словами (app/data/guide/*.json)
guide = {}
for f in sorted((D / "guide").glob("*.json")):
    guide.update(json.loads(f.read_text(encoding="utf-8")))
no_guide = [rid for rid in roles if rid not in guide]
assert not no_guide, f"нет справки для ролей: {no_guide}"
guide = {rid: g for rid, g in guide.items() if rid in roles}

data = {"roles": roles, "special": special, "order": order, "jinxes": jinxes, "scripts": scripts,
        "travellers": travellers, "fabled": fabled, "guide": guide}
out = ROOT / "app" / "src" / "data.js"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("const DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
               encoding="utf-8")
print(f"ролей: {len(roles)}, первая ночь: {len(order['first'])} шагов, последующие: {len(order['other'])}, "
      f"джинксов: {len(jinxes)}, размер: {out.stat().st_size // 1024} КБ")

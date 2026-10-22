# -*- coding: utf-8 -*-
"""导出视图模型：PDF / Word / Excel 三种格式共用同一份数据。

两种来源：
  * 会话（练习/模拟/正式考试）—— 只读 session_items 快照，所以"导出的题号与正确答案"
    必然与页面所见一致，也不会被题库后续修改影响；
  * 重难错题（按题库整份导出）—— 读 hard_questions 的题目快照。
"""
from __future__ import annotations

from services import grading, session

MODE_TITLE = {"practice": "练习", "mock": "模拟考试", "exam": "正式考试"}
HARD_TITLE = "重难错题"


def _group_items(items: list[dict], with_score: bool) -> list[dict]:
    groups = []
    pos = 0
    for t in grading.QTYPES:
        rows = [i for i in items if i["qtype"] == t]
        if not rows:
            continue
        gi = []
        for i in rows:
            pos += 1
            gi.append(
                {
                    "pos": pos,
                    "stem": i["stem"],
                    "qtype": t,
                    "options": [
                        {"label": chr(65 + k), "text": txt} for k, txt in enumerate(i["options"])
                    ]
                    if t != "judge"
                    else [],
                    "option_count": 0 if t == "judge" else len(i["options"]),
                    "score": float(i.get("score") or 0) if with_score else 0.0,
                    "answer_text": i["answer_text"],
                }
            )
        groups.append(
            {
                "name": grading.group_title(len(groups), t),
                "type": t,
                "type_label": grading.QTYPE_LABEL[t],
                "score": (float(rows[0].get("score") or 0) if with_score else 0.0),
                "items": gi,
            }
        )
    return groups


def build(session_id: int, with_answer: bool = True) -> dict:
    data = session.get_for_export(session_id)
    groups = _group_items(data["items"], with_score=True)
    total = sum(len(g["items"]) for g in groups)
    score_total = round(sum(it["score"] for g in groups for it in g["items"]), 2)
    mode_title = MODE_TITLE.get(data["mode"], data["mode_label"])
    return {
        "session_id": data["session_id"],
        "mode": data["mode"],
        "mode_title": mode_title,
        # 卷面标题统一用题库名，不缀「练习 / 模拟考试 / 正式考试」
        "title": data["bank_name"],
        "bank_name": data["bank_name"],
        "candidate": data["candidate"],
        # 卷头四项固定全给：题量、满分、考生信息、得分（练习卷也保留考生信息）
        "show_candidate": True,
        "show_score": True,
        "total": total,
        "scores": data.get("scores") or {},
        "score_total": score_total,
        "groups": groups,
        "answer_sheet": [
            {"pos": it["pos"], "answer_text": it["answer_text"]} for g in groups for it in g["items"]
        ],
        "with_answer": bool(with_answer),
    }


def build_hard(bank_id: int, with_answer: bool = True) -> dict:
    data = session.list_hard({"bank_id": bank_id})
    raw = data.get("items") or []
    # list_hard 的 options 是 [{label,text}]，这里统一成纯文本数组交给 _group_items
    items = [
        {
            "qtype": i["qtype"],
            "stem": i["stem"],
            "options": [o["text"] for o in (i.get("options") or [])],
            "score": 0,
            "answer_text": i["answer_text"],
        }
        for i in raw
    ]
    groups = _group_items(items, with_score=False)
    total = sum(len(g["items"]) for g in groups)
    return {
        "session_id": 0,
        "mode": "hard",
        "mode_title": HARD_TITLE,
        # 同样只用题库名做标题
        "title": data.get("bank_name") or "题库",
        "bank_name": data.get("bank_name") or "",
        "candidate": "",
        "show_candidate": True,
        "show_score": True,
        "total": total,
        "scores": {},
        "score_total": 0,
        "groups": groups,
        "answer_sheet": [
            {"pos": it["pos"], "answer_text": it["answer_text"]} for g in groups for it in g["items"]
        ],
        "with_answer": bool(with_answer),
    }


def group_subtitle(group: dict) -> str:
    n = len(group["items"])
    score = float(group.get("score") or 0)
    if score <= 0:
        return "共 %d 题" % n
    return "每题 %s 分，共 %d 题，共 %s 分" % (grading.fmt_score(score), n, grading.fmt_score(score * n))

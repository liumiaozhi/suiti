# -*- coding: utf-8 -*-
"""记录统计：做题记录（练习+模拟+正式）与考试记录（仅正式考试）。

口径一律以 session_items.is_correct 为准：
  done（做题数）= is_correct 非空的行数
  right = 1，wrong = 0
  missing（漏答）= is_correct 为空 且 模式属模拟/正式 且 已交卷
  正确率：做题记录 = 正确/做题数；考试记录 = 正确/题量
"""
from __future__ import annotations

import db
from services import grading

_BY_BANK_SQL = """
SELECT s.bank_id                                   AS bank_id,
       COALESCE(b.name, s.bank_name)                AS bank_name,
       SUM(CASE WHEN i.is_correct = 1 THEN 1 ELSE 0 END) AS right_cnt,
       SUM(CASE WHEN i.is_correct = 0 THEN 1 ELSE 0 END) AS wrong_cnt,
       SUM(CASE WHEN i.is_correct IS NULL AND s.mode IN ('mock','exam') AND s.status='submitted'
                THEN 1 ELSE 0 END)                 AS missing_cnt,
       SUM(CASE WHEN i.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS done_cnt,
       COUNT(DISTINCT s.id)                        AS session_cnt,
       MAX(COALESCE(s.submitted_at, s.started_at)) AS last_at
FROM sessions s
JOIN session_items i ON i.session_id = s.id
LEFT JOIN banks b    ON b.id = s.bank_id
WHERE s.status IN ('submitted','abandoned')
GROUP BY s.bank_id
HAVING done_cnt > 0
ORDER BY last_at DESC
"""

_ALL_BANKS_SQL = "SELECT COUNT(*) c FROM banks WHERE deleted_at IS NULL"


def practice_records(payload: dict | None = None) -> dict:
    """做题记录：顶部整体 + 按题库分行。"""
    with db.ro() as con:
        rows = [dict(r) for r in con.execute(_BY_BANK_SQL)]
        bank_total = int(con.execute(_ALL_BANKS_SQL).fetchone()["c"] or 0)

    by_bank = []
    right = wrong = missing = done = 0
    for r in rows:
        item = {
            "bank_id": r["bank_id"],
            "bank_name": r["bank_name"],
            "done_cnt": int(r["done_cnt"] or 0),
            "right": int(r["right_cnt"] or 0),
            "wrong": int(r["wrong_cnt"] or 0),
            "missing": int(r["missing_cnt"] or 0),
            "session_cnt": int(r["session_cnt"] or 0),
            "last_at": r["last_at"] or "",
        }
        item["accuracy"] = grading.accuracy(item["right"], item["done_cnt"])
        by_bank.append(item)
        right += item["right"]
        wrong += item["wrong"]
        missing += item["missing"]
        done += item["done_cnt"]

    return {
        "overall": {
            "bank_cnt": len(by_bank),
            "bank_total": bank_total,
            "done_cnt": done,
            "right": right,
            "wrong": wrong,
            "missing": missing,
            "accuracy": grading.accuracy(right, done),
        },
        "by_bank": by_bank,
    }


_EXAM_OVERALL_SQL = """
SELECT COUNT(*)                              AS exam_cnt,
       COUNT(DISTINCT s.bank_id)             AS bank_cnt,
       COALESCE(SUM(s.total), 0)             AS total_q,
       COALESCE(SUM(s.right_cnt), 0)         AS right_cnt,
       COALESCE(SUM(s.wrong_cnt), 0)         AS wrong_cnt,
       COALESCE(SUM(s.missing_cnt), 0)       AS missing_cnt,
       COALESCE(SUM(s.score), 0)             AS score
FROM sessions s
WHERE s.mode='exam' AND s.status='submitted'
"""

_EXAM_ROWS_SQL = """
SELECT s.id, s.bank_name, s.candidate, s.total, s.right_cnt, s.wrong_cnt, s.missing_cnt,
       s.score, s.score_total, s.score_per_q, s.started_at, s.submitted_at, s.duration_sec
FROM sessions s
WHERE s.mode='exam' AND s.status='submitted'
ORDER BY COALESCE(s.submitted_at, s.started_at) DESC, s.id DESC
LIMIT ? OFFSET ?
"""


def exam_records(payload: dict | None = None) -> dict:
    """考试记录：只含正式考试，一次考试一行。"""
    p = payload or {}
    try:
        size = min(200, max(5, int(p.get("size") or 50)))
    except (TypeError, ValueError):
        size = 50
    try:
        page = max(1, int(p.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    offset = (page - 1) * size

    with db.ro() as con:
        o = dict(con.execute(_EXAM_OVERALL_SQL).fetchone())
        rows = [dict(r) for r in con.execute(_EXAM_ROWS_SQL, (size, offset))]

    total_q = int(o["total_q"] or 0)
    right = int(o["right_cnt"] or 0)
    out_rows = []
    for r in rows:
        out_rows.append(
            {
                "session_id": r["id"],
                "bank_name": r["bank_name"],
                "candidate": r["candidate"] or "",
                "total": int(r["total"] or 0),
                "right": int(r["right_cnt"] or 0),
                "wrong": int(r["wrong_cnt"] or 0),
                "missing": int(r["missing_cnt"] or 0),
                "score": float(r["score"] or 0),
                "score_total": float(r["score_total"] or 0),
                "score_per_q": float(r["score_per_q"] or 0),
                "started_at": r["started_at"] or "",
                "submitted_at": r["submitted_at"] or "",
                "duration_sec": int(r["duration_sec"] or 0),
                "accuracy": grading.accuracy(int(r["right_cnt"] or 0), int(r["total"] or 0)),
            }
        )

    return {
        "overall": {
            "exam_cnt": int(o["exam_cnt"] or 0),
            "bank_cnt": int(o["bank_cnt"] or 0),
            "total_q": total_q,
            "right": right,
            "wrong": int(o["wrong_cnt"] or 0),
            "missing": int(o["missing_cnt"] or 0),
            "score": float(o["score"] or 0),
            "accuracy": grading.accuracy(right, total_q),
        },
        "rows": out_rows,
        "page": page,
        "size": size,
    }

# -*- coding: utf-8 -*-
"""题库仓储：创建（含重名自动改名）、列表、软删除。"""
from __future__ import annotations

import json
import logging
import os
import re

import db

log = logging.getLogger("bank")


def _name_key(name: str) -> str:
    return re.sub(r"\s+", "", (name or "")).lower()


def create_bank(name: str, source_file: str, questions: list[dict]) -> dict:
    """一个文件 = 一个题库。重名时自动追加 (2)(3)…"""
    base = (name or "未命名题库").strip() or "未命名题库"
    base = base[:80]

    with db.tx() as con:
        key = _name_key(base)
        final = base
        n = 2
        while con.execute("SELECT 1 FROM banks WHERE name_key=?", (key,)).fetchone():
            final = "%s (%d)" % (base, n)
            key = _name_key(final)
            n += 1
            if n > 999:
                raise ValueError("题库重名过多")

        cur = con.execute(
            "INSERT INTO banks(name, name_key, source_file, created_at) VALUES(?,?,?,?)",
            (final, key, os.path.basename(source_file or ""), db.now_str()),
        )
        bank_id = cur.lastrowid

        rows = []
        for seq, q in enumerate(questions, start=1):
            rows.append(
                (
                    bank_id,
                    q["qtype"],
                    q["stem"],
                    json.dumps(q["options"], ensure_ascii=False),
                    json.dumps(q["answer"]),
                    q["answer_text"],
                    seq,
                    q.get("source_row"),
                    q.get("raw_type"),
                )
            )
        con.executemany(
            "INSERT INTO questions(bank_id, qtype, stem, options_json, answer_json, answer_text, seq, source_row, raw_type)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            rows,
        )

    counts = {"total": len(questions), "single": 0, "multi": 0, "judge": 0}
    for q in questions:
        counts[q["qtype"]] = counts.get(q["qtype"], 0) + 1
    log.info("题库已创建 id=%s name=%s 题数=%s", bank_id, final, len(questions))
    return {"bank_id": bank_id, "name": final, "renamed": final != base, "counts": counts}


def list_banks(include_deleted: bool = False) -> list[dict]:
    where = "" if include_deleted else "WHERE b.deleted_at IS NULL"
    sql = f"""
        SELECT b.id, b.name, b.source_file, b.created_at, b.deleted_at,
               COUNT(q.id) AS total,
               SUM(CASE WHEN q.qtype='single' THEN 1 ELSE 0 END) AS single_cnt,
               SUM(CASE WHEN q.qtype='multi'  THEN 1 ELSE 0 END) AS multi_cnt,
               SUM(CASE WHEN q.qtype='judge'  THEN 1 ELSE 0 END) AS judge_cnt
        FROM banks b LEFT JOIN questions q ON q.bank_id=b.id
        {where}
        GROUP BY b.id ORDER BY b.id DESC
    """
    with db.ro() as con:
        out = []
        for r in con.execute(sql):
            out.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "source_file": r["source_file"] or "",
                    "created_at": r["created_at"],
                    "deleted": bool(r["deleted_at"]),
                    "counts": {
                        "total": int(r["total"] or 0),
                        "single": int(r["single_cnt"] or 0),
                        "multi": int(r["multi_cnt"] or 0),
                        "judge": int(r["judge_cnt"] or 0),
                    },
                }
            )
        return out


def get_bank(bank_id: int) -> dict | None:
    with db.ro() as con:
        r = con.execute("SELECT * FROM banks WHERE id=? AND deleted_at IS NULL", (bank_id,)).fetchone()
        return dict(r) if r else None


def delete_bank(bank_id: int) -> bool:
    """软删除题库，同时清掉它的重难错题归集（用户要求：题库删了，重难错题也一起删）。"""
    with db.tx() as con:
        cur = con.execute("UPDATE banks SET deleted_at=? WHERE id=? AND deleted_at IS NULL", (db.now_str(), bank_id))
        removed = cur.rowcount > 0
        if removed:
            n = con.execute("DELETE FROM hard_questions WHERE bank_id=?", (bank_id,)).rowcount
            if n:
                log.info("随题库 %s 一起清理重难错题 %d 条", bank_id, n)
        return removed


def bank_question_counts(bank_id: int) -> dict:
    with db.ro() as con:
        rows = con.execute(
            "SELECT qtype, COUNT(*) c FROM questions WHERE bank_id=? GROUP BY qtype", (bank_id,)
        ).fetchall()
    counts = {"single": 0, "multi": 0, "judge": 0}
    for r in rows:
        counts[r["qtype"]] = r["c"]
    counts["total"] = sum(counts.values())
    return counts

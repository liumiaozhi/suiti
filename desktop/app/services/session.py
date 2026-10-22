# -*- coding: utf-8 -*-
"""做题会话：抽题、建卷、作答、标记、交卷、评卷、结果。

三种模式的差别只体现在"什么时候判分"和"统计归属"：
  练习  —— 作答即判（单选/判断点选即判、多选点「完成」即判），不产生漏答；
  模拟  —— 只落库不判分，交卷时统一评卷，计入做题记录、不计入考试记录；
  正式  —— 同模拟，且交卷后写入考试记录。
"""
from __future__ import annotations

import json
import logging
import random
import time

import db
from errors import UserError
from services import bank_repo, grading

log = logging.getLogger("session")

MODE_LABEL = {"practice": "练习模式", "mock": "模拟考试", "exam": "正式考试"}
EXAM_MODES = ("mock", "exam")


# ---------------------------------------------------------------- 设置
def normalize_settings(payload: dict) -> dict:
    p = payload or {}
    try:
        bank_id = int(p.get("bank_id") or 0)
    except (TypeError, ValueError):
        raise UserError("请先选择题库")
    if bank_id <= 0:
        raise UserError("请先选择题库")

    types = [t for t in grading.QTYPES if t in (p.get("types") or [])]
    if not types:
        raise UserError("请至少勾选一种题型")

    mode_amount = p.get("amount_mode") or "all"
    if mode_amount not in ("all", "num"):
        mode_amount = "all"
    raw_amount = p.get("amount") or {}
    amount = {}
    for t in grading.QTYPES:
        try:
            amount[t] = max(0, int(raw_amount.get(t) or 0))
        except (TypeError, ValueError):
            amount[t] = 0

    # 分值：按题型分别设置。老调用方只传 score_per_q 时，按同一分值铺到各题型。
    scores: dict[str, float] = {}
    raw_scores = p.get("score")
    if isinstance(raw_scores, dict) and raw_scores:
        for t in grading.QTYPES:
            try:
                v = float(raw_scores.get(t) or 0)
            except (TypeError, ValueError):
                v = 0.0
            scores[t] = round(v, 2) if v > 0 else 0.0
    else:
        try:
            legacy = float(p.get("score_per_q") or 2)
        except (TypeError, ValueError):
            legacy = 2.0
        scores = {t: round(legacy, 2) for t in grading.QTYPES}

    for t in types:
        if scores.get(t, 0) <= 0:
            raise UserError("请为%s填写大于 0 的分值" % grading.QTYPE_LABEL[t])
        if scores[t] > 1000:
            raise UserError("分值过大，请检查")

    q_order = p.get("q_order") if p.get("q_order") in ("asc", "desc", "random") else "asc"
    a_order = "shuffle" if p.get("a_order") == "shuffle" else "keep"

    return {
        "bank_id": bank_id,
        "types": types,
        "amount_mode": mode_amount,
        "amount": amount,
        "scores": scores,
        "score_per_q": scores.get(types[0], 0.0),  # 兼容字段：仅代表第一个题型的分值
        "q_order": q_order,
        "a_order": a_order,
    }


def _pools(con, bank_id: int) -> dict[str, list]:
    rows = con.execute(
        "SELECT id, qtype, stem, options_json, answer_json FROM questions WHERE bank_id=? ORDER BY seq, id",
        (bank_id,),
    ).fetchall()
    pools: dict[str, list] = {t: [] for t in grading.QTYPES}
    for r in rows:
        pools.setdefault(r["qtype"], []).append(
            {"qid": r["id"], "qtype": r["qtype"], "stem": r["stem"], "options_json": r["options_json"], "answer_json": r["answer_json"]}
        )
    return pools


def _hard_pools(con, bank_id: int) -> dict[str, list]:
    """重难错题作为题源：字段与 questions 对齐，qid 记原始题目 id。"""
    rows = con.execute(
        "SELECT qid, qtype, stem, options_json, answer_json FROM hard_questions WHERE bank_id=? ORDER BY id",
        (bank_id,),
    ).fetchall()
    pools: dict[str, list] = {t: [] for t in grading.QTYPES}
    for r in rows:
        pools.setdefault(r["qtype"], []).append(
            {"qid": r["qid"], "qtype": r["qtype"], "stem": r["stem"], "options_json": r["options_json"], "answer_json": r["answer_json"]}
        )
    return pools


def _pick_count(st: dict, t: str, available: int) -> int:
    if st["amount_mode"] == "all":
        return available
    n = st["amount"].get(t, 0)
    if n <= 0:  # 用户没填就按全量
        return available
    return min(n, available)


def preview(payload: dict) -> dict:
    st = normalize_settings(payload)
    source = _source_of(payload)
    bank = bank_repo.get_bank(st["bank_id"])
    if not bank:
        raise UserError("题库不存在或已被删除")
    with db.ro() as con:
        pools = _hard_pools(con, st["bank_id"]) if source == "hard" else _pools(con, st["bank_id"])

    by_type = {}
    warnings = []
    total = 0
    score_total = 0.0
    for t in st["types"]:
        available = len(pools.get(t, []))
        if st["amount_mode"] == "num":
            requested = st["amount"].get(t, 0) or available
        else:
            requested = available
        picked = min(requested, available)
        by_type[t] = {"available": available, "picked": picked, "score": st["scores"][t]}
        total += picked
        score_total += picked * st["scores"][t]
        if available == 0:
            warnings.append(
                ("该题库还没有重难错题中的" if source == "hard" else "该题库没有") + grading.QTYPE_LABEL[t] + "，已自动跳过"
            )
        elif requested > available:
            warnings.append(
                "%s只够 %d 题，已按 %d 题出卷" % (grading.QTYPE_LABEL[t], available, available)
            )

    if total == 0:
        raise UserError(
            "重难错题里还没有可练习的题目" if source == "hard" else "按当前设置没有抽到任何题目，请调整题型或数量"
        )

    return {
        "bank_id": st["bank_id"],
        "bank_name": bank["name"],
        "source": source,
        "total": total,
        "by_type": by_type,
        "scores": st["scores"],
        "score_per_q": st["score_per_q"],
        "score_total": round(score_total, 2),
        "warnings": warnings,
        "settings": st,
    }


def _source_of(payload: dict) -> str:
    return "hard" if (payload or {}).get("source") == "hard" else "bank"


# ---------------------------------------------------------------- 建卷
def create_session(payload: dict) -> dict:
    st = normalize_settings(payload)
    mode = payload.get("mode") or "practice"
    if mode not in MODE_LABEL:
        raise UserError("做题模式不正确")
    candidate = (payload.get("candidate") or "").strip()
    if mode in EXAM_MODES:
        if not candidate:
            raise UserError("请填写考生信息")
        if len(candidate) > 50:
            raise UserError("考生信息不能超过 50 个字符")

    bank = bank_repo.get_bank(st["bank_id"])
    if not bank:
        raise UserError("题库不存在或已被删除")

    source = _source_of(payload)
    with db.ro() as con:
        pools = _hard_pools(con, st["bank_id"]) if source == "hard" else _pools(con, st["bank_id"])

    rng = random.Random()
    picked = []
    for t in st["types"]:
        arr = list(pools.get(t, []))
        if not arr:
            continue
        n = _pick_count(st, t, len(arr))
        if n <= 0:
            continue
        if st["q_order"] == "random":
            rng.shuffle(arr)
        elif st["q_order"] == "desc":
            arr.reverse()
        picked.extend(arr[:n])

    if not picked:
        raise UserError(
            "重难错题里还没有可练习的题目" if source == "hard" else "按当前设置没有抽到任何题目，请调整题型或数量"
        )

    items = []
    for pos, r in enumerate(picked, start=1):
        options = json.loads(r["options_json"])
        answer = json.loads(r["answer_json"])
        qtype = r["qtype"]
        # 判断题固定 正确/错误 顺序，不做选项打乱（避免出现"错误/正确"的怪异排布）
        shuffle = st["a_order"] == "shuffle" and qtype != "judge"
        order = grading.build_display_order(len(options), shuffle, rng)
        answer_disp = grading.map_answer(answer, order)
        options_disp = grading.display_options(options, order)
        items.append(
            {
                "qid": r["qid"],
                "pos": pos,
                "qtype": qtype,
                "stem": r["stem"],
                "options": options,
                "order": order,
                "options_disp": options_disp,
                "answer_disp": answer_disp,
                "answer_text": grading.answer_text(qtype, options_disp, answer_disp),
                "score": st["scores"][qtype],
            }
        )

    total = len(items)
    score_total = round(sum(it["score"] for it in items), 2)
    with db.tx() as con:
        cur = con.execute(
            "INSERT INTO sessions(bank_id, bank_name, mode, candidate, settings_json, total, score_per_q,"
            " score_total, source, status, started_at) VALUES(?,?,?,?,?,?,?,?,?,'ongoing',?)",
            (
                st["bank_id"],
                bank["name"],
                mode,
                candidate,
                json.dumps(st, ensure_ascii=False),
                total,
                st["score_per_q"],
                score_total,
                source,
                db.now_str(),
            ),
        )
        session_id = cur.lastrowid
        con.executemany(
            "INSERT INTO session_items(session_id, qid, pos, qtype, stem, options_json, option_order_json,"
            " answer_disp_json, answer_disp_text, score, marked, chosen_json, is_correct, answered_cnt)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,0)",
            [
                (
                    session_id,
                    it["qid"],
                    it["pos"],
                    it["qtype"],
                    it["stem"],
                    json.dumps(it["options"], ensure_ascii=False),
                    json.dumps(it["order"]),
                    json.dumps(it["answer_disp"]),
                    it["answer_text"],
                    it["score"],
                )
                for it in items
            ],
        )

    log.info(
        "建卷 session=%s mode=%s source=%s bank=%s 题数=%s 满分=%s",
        session_id,
        mode,
        source,
        bank["name"],
        total,
        score_total,
    )

    return {
        "session_id": session_id,
        "mode": mode,
        "mode_label": MODE_LABEL[mode],
        "source": source,
        "bank_id": st["bank_id"],
        "bank_name": bank["name"],
        "candidate": candidate,
        "total": total,
        "scores": st["scores"],
        "score_per_q": st["score_per_q"],
        "score_total": score_total,
        "started_at": db.now_str(),
        "items": [
            {
                "pos": it["pos"],
                "qid": it["qid"],
                "qtype": it["qtype"],
                "qtype_label": grading.QTYPE_LABEL[it["qtype"]],
                "stem": it["stem"],
                "score": it["score"],
                "options": [
                    {"label": chr(65 + i), "text": txt} for i, txt in enumerate(it["options_disp"])
                ],
                "answered": False,
                "marked": False,
            }
            for it in items
        ],
    }


# ---------------------------------------------------------------- 作答
def _get_session(con, session_id: int):
    s = con.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not s:
        raise UserError("这次做题的记录不存在", "SESSION_NOT_FOUND")
    return s


def _get_item(con, session_id: int, pos: int):
    it = con.execute(
        "SELECT * FROM session_items WHERE session_id=? AND pos=?", (session_id, pos)
    ).fetchone()
    if not it:
        raise UserError("题号不存在")
    return it


def _done_cnt(con, session_id: int, mode: str) -> int:
    if mode == "practice":
        sql = "SELECT COUNT(*) c FROM session_items WHERE session_id=? AND is_correct IS NOT NULL"
    else:
        sql = "SELECT COUNT(*) c FROM session_items WHERE session_id=? AND chosen_json IS NOT NULL"
    return int(con.execute(sql, (session_id,)).fetchone()["c"] or 0)


def answer(payload: dict) -> dict:
    session_id = int(payload.get("session_id") or 0)
    pos = int(payload.get("pos") or 0)
    chosen_raw = payload.get("chosen") or []
    if not isinstance(chosen_raw, list):
        chosen_raw = []
    try:
        chosen = sorted({int(x) for x in chosen_raw})
    except (TypeError, ValueError):
        raise UserError("选项格式不正确")

    with db.tx() as con:
        s = _get_session(con, session_id)
        if s["status"] != "ongoing":
            raise UserError("本次做题已结束，不能再作答")
        it = _get_item(con, session_id, pos)
        options = json.loads(it["options_json"])
        if any(c < 0 or c >= len(options) for c in chosen):
            raise UserError("选项超出范围")
        ans = json.loads(it["answer_disp_json"])

        if s["mode"] == "practice":
            if it["is_correct"] is not None:
                raise UserError("本题已作答，不能修改")
            if not chosen:
                raise UserError("请先选择答案")
            correct = grading.is_correct(chosen, ans, it["qtype"])
            con.execute(
                "UPDATE session_items SET chosen_json=?, is_correct=?, answered_cnt=answered_cnt+1, answered_at=?"
                " WHERE id=?",
                (json.dumps(chosen), 1 if correct else 0, db.now_str(), it["id"]),
            )
            con.execute(
                "INSERT INTO attempts(session_id, pos, chosen_json, is_correct, created_at) VALUES(?,?,?,?,?)",
                (session_id, pos, json.dumps(chosen), 1 if correct else 0, db.now_str()),
            )
            return {
                "graded": True,
                "is_correct": correct,
                "answer_disp": ans,
                "answer_text": it["answer_disp_text"],
                "done_cnt": _done_cnt(con, session_id, "practice"),
            }

        # 模拟/正式：只落库
        con.execute(
            "UPDATE session_items SET chosen_json=?, answered_cnt=answered_cnt+1, answered_at=? WHERE id=?",
            (json.dumps(chosen) if chosen else None, db.now_str(), it["id"]),
        )
        return {"graded": False, "saved": True, "done_cnt": _done_cnt(con, session_id, s["mode"])}


def toggle_mark(payload: dict) -> dict:
    session_id = int(payload.get("session_id") or 0)
    pos = int(payload.get("pos") or 0)
    marked = bool(payload.get("marked"))
    with db.tx() as con:
        s = _get_session(con, session_id)
        if s["status"] != "ongoing":
            raise UserError("本次做题已结束")
        _get_item(con, session_id, pos)
        con.execute(
            "UPDATE session_items SET marked=? WHERE session_id=? AND pos=?",
            (1 if marked else 0, session_id, pos),
        )
    return {"pos": pos, "marked": marked}


def get_state(payload: dict) -> dict:
    session_id = int(payload.get("session_id") or 0)
    with db.ro() as con:
        s = _get_session(con, session_id)
        rows = con.execute(
            "SELECT pos, qtype, marked, chosen_json, is_correct FROM session_items WHERE session_id=? ORDER BY pos",
            (session_id,),
        ).fetchall()
        items = []
        for r in rows:
            chosen = json.loads(r["chosen_json"]) if r["chosen_json"] else []
            items.append(
                {
                    "pos": r["pos"],
                    "qtype": r["qtype"],
                    "marked": bool(r["marked"]),
                    "chosen": chosen,
                    "graded": r["is_correct"] is not None,
                    "is_correct": None if r["is_correct"] is None else bool(r["is_correct"]),
                    "done": (r["is_correct"] is not None) if s["mode"] == "practice" else bool(chosen),
                }
            )
        return {
            "session_id": session_id,
            "mode": s["mode"],
            "status": s["status"],
            "total": s["total"],
            "candidate": s["candidate"] or "",
            "done_cnt": sum(1 for i in items if i["done"]),
            "marked_cnt": sum(1 for i in items if i["marked"]),
            "items": items,
        }


# ---------------------------------------------------------------- 交卷 / 放弃
def submit(payload: dict) -> dict:
    session_id = int(payload.get("session_id") or 0)
    with db.tx() as con:
        s = _get_session(con, session_id)
        if s["status"] == "submitted":
            return _summary(con, session_id)
        if s["status"] == "abandoned":
            raise UserError("本次做题已放弃，不能交卷")

        rows = con.execute(
            "SELECT * FROM session_items WHERE session_id=? ORDER BY pos", (session_id,)
        ).fetchall()

        right = wrong = missing = 0
        right_score = 0.0
        score_total = 0.0
        for r in rows:
            item_score = float(r["score"] or 0)
            score_total += item_score
            chosen = json.loads(r["chosen_json"]) if r["chosen_json"] else []
            ans = json.loads(r["answer_disp_json"])
            if not chosen:
                if s["mode"] in EXAM_MODES:
                    missing += 1
                continue
            correct = grading.is_correct(chosen, ans, r["qtype"])
            con.execute("UPDATE session_items SET is_correct=? WHERE id=?", (1 if correct else 0, r["id"]))
            con.execute(
                "INSERT INTO attempts(session_id, pos, chosen_json, is_correct, created_at) VALUES(?,?,?,?,?)",
                (session_id, r["pos"], json.dumps(chosen), 1 if correct else 0, db.now_str()),
            )
            if correct:
                right += 1
                right_score += item_score
            else:
                wrong += 1

        score = round(right_score, 2)
        started = s["started_at"]
        duration = _duration_sec(started)
        con.execute(
            "UPDATE sessions SET status='submitted', submitted_at=?, duration_sec=?, score=?, score_total=?,"
            " right_cnt=?, wrong_cnt=?, missing_cnt=? WHERE id=?",
            (db.now_str(), duration, score, round(score_total, 2), right, wrong, missing, session_id),
        )
        log.info("交卷 session=%s 对=%s 错=%s 漏=%s 得分=%s", session_id, right, wrong, missing, score)
        return _summary(con, session_id)


def _duration_sec(started_at: str) -> int:
    try:
        from datetime import datetime

        t0 = datetime.strptime(started_at, "%Y-%m-%d %H:%M:%S")
        return max(0, int(time.time() - t0.timestamp()))
    except Exception:
        return 0


def abandon(payload: dict) -> dict:
    session_id = int(payload.get("session_id") or 0)
    with db.tx() as con:
        s = _get_session(con, session_id)
        if s["status"] == "ongoing":
            con.execute(
                "UPDATE sessions SET status='abandoned', submitted_at=? WHERE id=?",
                (db.now_str(), session_id),
            )
    return {"session_id": session_id, "status": "abandoned"}


def _summary(con, session_id: int) -> dict:
    s = _get_session(con, session_id)
    rows = con.execute(
        "SELECT is_correct, chosen_json, score FROM session_items WHERE session_id=?", (session_id,)
    ).fetchall()
    done = sum(1 for r in rows if r["is_correct"] is not None)
    score_total = round(sum(float(r["score"] or 0) for r in rows), 2)
    right = s["right_cnt"] or 0
    wrong = s["wrong_cnt"] or 0
    missing = s["missing_cnt"] or 0
    base = s["total"] if s["mode"] in EXAM_MODES else (done or 0)
    try:
        settings = json.loads(s["settings_json"] or "{}")
    except ValueError:
        settings = {}
    scores = settings.get("scores") or {}
    return {
        "session_id": session_id,
        "mode": s["mode"],
        "mode_label": MODE_LABEL.get(s["mode"], ""),
        "source": (s["source"] or "bank"),
        "bank_id": s["bank_id"],
        "bank_name": s["bank_name"],
        "candidate": s["candidate"] or "",
        "total": s["total"],
        "right": right,
        "wrong": wrong,
        "missing": missing,
        "done_cnt": done,
        "score": s["score"] if s["score"] is not None else 0,
        "scores": scores,
        "score_per_q": s["score_per_q"],
        "score_total": score_total,
        "accuracy": grading.accuracy(right, base),
        "started_at": s["started_at"],
        "submitted_at": s["submitted_at"] or "",
        "duration_sec": s["duration_sec"] or 0,
        "status": s["status"],
    }


# ---------------------------------------------------------------- 结果 / 错题
def get_result(payload: dict) -> dict:
    session_id = int(payload.get("session_id") or 0)
    with db.ro() as con:
        s = _get_session(con, session_id)
        summary = _summary(con, session_id)
        rows = con.execute(
            "SELECT * FROM session_items WHERE session_id=? ORDER BY pos", (session_id,)
        ).fetchall()

        need_wrong = bool(payload.get("with_wrong", True))
        wrong = []
        if need_wrong:
            for r in rows:
                if r["is_correct"] == 1:
                    continue
                if r["is_correct"] is None and s["mode"] == "practice":
                    continue
                order = json.loads(r["option_order_json"])
                options = [json.loads(r["options_json"])[i] for i in order]
                chosen = json.loads(r["chosen_json"]) if r["chosen_json"] else []
                ans = json.loads(r["answer_disp_json"])
                wrong.append(
                    {
                        "pos": r["pos"],
                        "qid": r["qid"],
                        "qtype": r["qtype"],
                        "qtype_label": grading.QTYPE_LABEL.get(r["qtype"], ""),
                        "stem": r["stem"],
                        "options": [
                            {"label": chr(65 + i), "text": t} for i, t in enumerate(options)
                        ],
                        "chosen": chosen,
                        "chosen_text": grading.sel_text(r["qtype"], options, chosen),
                        "answer_disp": ans,
                        "answer_text": r["answer_disp_text"],
                        "answered": bool(chosen),
                        "missing": not chosen,
                    }
                )
        summary["wrong_items"] = wrong
        return summary


# ---------------------------------------------------------------- 导出用全量数据
def get_for_export(session_id: int) -> dict:
    with db.ro() as con:
        s = _get_session(con, session_id)
        rows = con.execute(
            "SELECT * FROM session_items WHERE session_id=? ORDER BY pos", (session_id,)
        ).fetchall()
        items = []
        for r in rows:
            order = json.loads(r["option_order_json"])
            raw_options = json.loads(r["options_json"])
            options = [raw_options[i] for i in order]
            items.append(
                {
                    "pos": r["pos"],
                    "qtype": r["qtype"],
                    "stem": r["stem"],
                    "options": options,
                    "score": float(r["score"] or 0),
                    "answer_disp": json.loads(r["answer_disp_json"]),
                    "answer_text": r["answer_disp_text"],
                }
            )
        try:
            settings = json.loads(s["settings_json"] or "{}")
        except ValueError:
            settings = {}
        return {
            "session_id": session_id,
            "mode": s["mode"],
            "mode_label": MODE_LABEL.get(s["mode"], ""),
            "source": s["source"] or "bank",
            "bank_name": s["bank_name"],
            "candidate": s["candidate"] or "",
            "total": s["total"],
            "scores": settings.get("scores") or {},
            "score_per_q": s["score_per_q"],
            "score_total": round(sum(i["score"] for i in items), 2),
            "started_at": s["started_at"],
            "submitted_at": s["submitted_at"] or "",
            "items": items,
        }


def ongoing_count() -> int:
    with db.ro() as con:
        r = con.execute("SELECT COUNT(*) c FROM sessions WHERE status='ongoing'").fetchone()
        return int(r["c"] or 0)


def abandon_all_ongoing() -> int:
    """关窗时把未交卷的会话标记为放弃（已答的题仍计入做题记录）。"""
    with db.tx() as con:
        cur = con.execute(
            "UPDATE sessions SET status='abandoned', submitted_at=? WHERE status='ongoing'", (db.now_str(),)
        )
        return cur.rowcount


def cleanup_stale(hours: int = 12) -> int:
    """清理长时间未交卷的僵尸会话，避免每次关窗都提示。"""
    from datetime import datetime, timedelta

    cut = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    with db.tx() as con:
        cur = con.execute(
            "UPDATE sessions SET status='abandoned' WHERE status='ongoing' AND started_at < ?", (cut,)
        )
        n = cur.rowcount
    if n:
        log.info("清理超时会话 %d 条", n)
    return n


# ---------------------------------------------------------------- 重难错题
def _question_snapshot(con, item_row) -> dict:
    """取题目的原始快照（原始选项顺序与答案），用于存进重难错题。"""
    qid = item_row["qid"]
    if qid:
        q = con.execute(
            "SELECT qtype, stem, options_json, answer_json, answer_text FROM questions WHERE id=?", (qid,)
        ).fetchone()
        if q:
            return {
                "qid": qid,
                "qtype": q["qtype"],
                "stem": q["stem"],
                "options_json": q["options_json"],
                "answer_json": q["answer_json"],
                "answer_text": q["answer_text"],
            }
    # 题库已被删除等情况：用会话快照反推原始顺序
    order = json.loads(item_row["option_order_json"])
    raw_options = json.loads(item_row["options_json"])
    ans_disp = json.loads(item_row["answer_disp_json"])
    inv = {disp: orig for disp, orig in enumerate(order)}
    ans_orig = sorted(inv[a] for a in ans_disp)
    return {
        "qid": qid,
        "qtype": item_row["qtype"],
        "stem": item_row["stem"],
        "options_json": json.dumps(raw_options, ensure_ascii=False),
        "answer_json": json.dumps(ans_orig),
        "answer_text": item_row["answer_disp_text"],
    }


def hard_qids(payload: dict) -> dict:
    bank_id = int((payload or {}).get("bank_id") or 0)
    with db.ro() as con:
        rows = con.execute("SELECT qid FROM hard_questions WHERE bank_id=?", (bank_id,)).fetchall()
    return {"bank_id": bank_id, "qids": [r["qid"] for r in rows], "count": len(rows)}


def hard_counts(payload: dict) -> dict:
    """一次拿到所有题库的重难错题 qid 列表，供做题页一次性打标。"""
    with db.ro() as con:
        rows = con.execute("SELECT bank_id, qid FROM hard_questions").fetchall()
    out: dict[str, list] = {}
    for r in rows:
        out.setdefault(str(r["bank_id"]), []).append(r["qid"])
    return {"map": out, "total": len(rows)}


def toggle_hard(payload: dict) -> dict:
    session_id = int((payload or {}).get("session_id") or 0)
    pos = int((payload or {}).get("pos") or 0)
    hard = bool((payload or {}).get("hard"))
    with db.tx() as con:
        s = _get_session(con, session_id)
        if not s["bank_id"]:
            raise UserError("题库已删除，无法归集重难错题")
        item = _get_item(con, session_id, pos)
        snap = _question_snapshot(con, item)
        if not snap["qid"]:
            raise UserError("这道题缺少原始题号，无法归集")
        if hard:
            con.execute(
                "INSERT OR IGNORE INTO hard_questions(bank_id, bank_name, qid, qtype, stem, options_json,"
                " answer_json, answer_text, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    s["bank_id"],
                    s["bank_name"],
                    snap["qid"],
                    snap["qtype"],
                    snap["stem"],
                    snap["options_json"],
                    snap["answer_json"],
                    snap["answer_text"],
                    db.now_str(),
                ),
            )
        else:
            con.execute(
                "DELETE FROM hard_questions WHERE bank_id=? AND qid=?", (s["bank_id"], snap["qid"])
            )
        cnt = con.execute(
            "SELECT COUNT(*) c FROM hard_questions WHERE bank_id=?", (s["bank_id"],)
        ).fetchone()["c"]
    return {"hard": hard, "bank_id": s["bank_id"], "count": int(cnt or 0)}


def hard_overview(payload: dict | None = None) -> dict:
    """重难错题模块首页：按题库汇总。"""
    with db.ro() as con:
        rows = con.execute(
            "SELECT bank_id, MAX(bank_name) bank_name, COUNT(*) total,"
            " SUM(CASE WHEN qtype='single' THEN 1 ELSE 0 END) single_cnt,"
            " SUM(CASE WHEN qtype='multi' THEN 1 ELSE 0 END) multi_cnt,"
            " SUM(CASE WHEN qtype='judge' THEN 1 ELSE 0 END) judge_cnt,"
            " MAX(created_at) last_at"
            " FROM hard_questions GROUP BY bank_id ORDER BY last_at DESC"
        ).fetchall()
        banks = []
        for r in rows:
            banks.append(
                {
                    "bank_id": r["bank_id"],
                    "bank_name": r["bank_name"],
                    "total": int(r["total"] or 0),
                    "single": int(r["single_cnt"] or 0),
                    "multi": int(r["multi_cnt"] or 0),
                    "judge": int(r["judge_cnt"] or 0),
                    "last_at": r["last_at"] or "",
                }
            )
        total = sum(b["total"] for b in banks)
    return {"banks": banks, "total": total, "bank_cnt": len(banks)}


def list_hard(payload: dict) -> dict:
    bank_id = int((payload or {}).get("bank_id") or 0)
    with db.ro() as con:
        rows = con.execute(
            "SELECT id, qid, qtype, stem, options_json, answer_json, answer_text, bank_name"
            " FROM hard_questions WHERE bank_id=? ORDER BY"
            " CASE qtype WHEN 'single' THEN 1 WHEN 'multi' THEN 2 ELSE 3 END, id",
            (bank_id,),
        ).fetchall()
        items = []
        for r in rows:
            opts = json.loads(r["options_json"])
            items.append(
                {
                    "hid": r["id"],
                    "qid": r["qid"],
                    "qtype": r["qtype"],
                    "qtype_label": grading.QTYPE_LABEL.get(r["qtype"], ""),
                    "stem": r["stem"],
                    "options": [
                        {"label": chr(65 + i), "text": t} for i, t in enumerate([] if r["qtype"] == "judge" else opts)
                    ],
                    "answer_text": r["answer_text"],
                }
            )
        return {"bank_id": bank_id, "bank_name": rows[0]["bank_name"] if rows else "", "items": items}


def remove_hard(payload: dict) -> dict:
    p = payload or {}
    with db.tx() as con:
        if p.get("all") and p.get("bank_id"):
            n = con.execute("DELETE FROM hard_questions WHERE bank_id=?", (int(p["bank_id"]),)).rowcount
            return {"removed": n}
        if p.get("hid"):
            con.execute("DELETE FROM hard_questions WHERE id=?", (int(p["hid"]),))
            return {"removed": 1}
        if p.get("bank_id") is not None and p.get("qid") is not None:
            con.execute(
                "DELETE FROM hard_questions WHERE bank_id=? AND qid=?", (int(p["bank_id"]), int(p["qid"]))
            )
            return {"removed": 1}
        raise UserError("缺少要移除的题目")

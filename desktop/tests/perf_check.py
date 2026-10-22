# -*- coding: utf-8 -*-
"""性能自检：1000 题库导入、200 题建卷、交卷、统计的耗时。
用法： .venv-build\\Scripts\\python.exe tests\\perf_check.py
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "app"))

DEV = os.path.join(ROOT, ".devperf")
os.makedirs(DEV, exist_ok=True)
os.environ["APPDATA"] = DEV

import db  # noqa: E402

db.init_db()

from api import Api  # noqa: E402

A = Api()


def t(label, fn):
    t0 = time.perf_counter()
    r = fn()
    dt = (time.perf_counter() - t0) * 1000
    print("  %-34s %7.1f ms" % (label, dt))
    return r, dt


def build_xlsx(path, n_single, n_multi, n_judge):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "题库"
    ws.append(["题型", "题干", "选项", "正确答案"])
    for i in range(n_single):
        ws.append(["单选", "【压测】第 %d 道单选题：下列关于银行业务的说法正确的是（　）。" % i,
                   "选项甲%d|选项乙%d|选项丙%d|选项丁%d" % (i, i, i, i), "ABCD"[i % 4]])
    for i in range(n_multi):
        ws.append(["多选", "【压测】第 %d 道多选题：下列属于流动性资产的有（　）。" % i,
                   "库存现金%d|存放央行款项%d|固定资产%d|拆放同业%d" % (i, i, i, i), "ABD"])
    for i in range(n_judge):
        ws.append(["判断", "【压测】第 %d 道判断题：同业存单属于负债业务。" % i, "", "正确" if i % 2 == 0 else "错误"])
    wb.save(path)
    return path


def main():
    f = build_xlsx(os.path.join(DEV, "压测题库1000题.xlsx"), 700, 200, 100)
    r, _ = t("导入 1000 题", lambda: A.import_bank_path({"path": f}))
    if not r["ok"] or not r["data"]["ok"]:
        print("导入失败", r)
        return 1
    bid = r["data"]["bank_id"]
    print("  导入结果：", r["data"]["counts"])

    st = {
        "bank_id": bid,
        "types": ["single", "multi", "judge"],
        "amount_mode": "num",
        "amount": {"single": 140, "multi": 40, "judge": 20},
        "score_per_q": 1,
        "q_order": "random",
        "a_order": "shuffle",
        "mode": "exam",
        "candidate": "压测考生",
    }
    cs, ms = t("建 200 题试卷（随机题序+打乱答案）", lambda: A.create_session(dict(st)))
    sid = cs["data"]["session_id"]
    print("  实际题数：", cs["data"]["total"])

    with db.ro() as con:
        rows = con.execute("SELECT pos, answer_disp_json FROM session_items WHERE session_id=? ORDER BY pos", (sid,)).fetchall()
    import json

    t("连续作答 200 题落库", lambda: [A.answer({"session_id": sid, "pos": x["pos"], "chosen": json.loads(x["answer_disp_json"])}) for x in rows])
    t("查询会话状态", lambda: A.get_session_state({"session_id": sid}))
    s, _ = t("交卷评卷", lambda: A.submit_session({"session_id": sid}))
    print("  交卷结果：", {k: s["data"][k] for k in ("right", "wrong", "missing", "score")})
    t("做题记录统计", lambda: A.get_records({}))
    t("考试记录查询", lambda: A.list_exam_records({"page": 1, "size": 100}))
    t("结果页（含错题）", lambda: A.get_result({"session_id": sid}))
    t("预览出题（1000 题库）", lambda: A.preview_paper(dict(st)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

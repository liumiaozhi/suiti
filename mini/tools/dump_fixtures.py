# -*- coding: utf-8 -*-
"""从桌面版「随题」的**真实函数**导出 golden 样本，供小程序 core 逐字段比对。

只用只读方式调用桌面版模块，不修改它的任何文件；所有临时数据库/表格都写在系统临时目录。

用法：
    python tools/dump_fixtures.py --src "D:/AI工具库/workbuddy工作空间/随我题" --out tests/fixtures

产出：
    tests/fixtures/meta.json        版本与生成时间
    tests/fixtures/grading.json     判题/打乱/括号/答案解析 的单元用例
    tests/fixtures/import.json      Excel 导入用例（含生成的 xlsx 路径与期望结果）
    tests/fixtures/session.json     预览出卷 + 交卷汇总的确定性用例
    tests/fixtures/export.json      导出视图模型（含卷面关键片段）
    miniprogram/pkg-io-import/assets/template.xlsx   导入模板（与桌面版一致）
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import traceback
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True, help="桌面版工程根目录（含 app/）")
    p.add_argument("--out", default=os.path.join(ROOT, "tests", "fixtures"))
    p.add_argument("--assets", default=os.path.join(ROOT, "miniprogram", "pkg-io-import", "assets"))
    return p.parse_args()


def main():
    args = parse_args()
    src = os.path.abspath(args.src)
    app_dir = os.path.join(src, "app")
    if not os.path.isdir(app_dir):
        raise SystemExit("找不到桌面版 app 目录：%s" % app_dir)

    # 一切写操作都在临时目录，避免碰到用户真实数据
    tmp = tempfile.mkdtemp(prefix="suiti_fixtures_")
    os.environ["APPDATA"] = tmp
    sys.path.insert(0, app_dir)

    import db  # noqa: E402
    from services import bank_import, grading  # noqa: E402

    db.init_db()

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.assets, exist_ok=True)

    meta = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "python": sys.version.split()[0],
        "src": src,
        "isolation": True,
    }
    try:
        import paths

        meta["desktopVersion"] = paths.VERSION
    except Exception:
        meta["desktopVersion"] = "unknown"

    def dump(name, payload):
        p = os.path.join(args.out, name + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("  -> %s（%d 条）" % (p, len(payload.get("cases", [])) if isinstance(payload, dict) else 0))

    # ------------------------------------------------------------ A. 判题/文本
    cases = []

    def add(group, name, fn, *fnargs):
        """记录一次调用；异常也记录（小程序要复刻同样的报错）。"""
        try:
            val = fn(*fnargs)
            cases.append({"group": group, "name": name, "args": list(fnargs), "ok": True, "expect": val})
        except Exception as e:
            cases.append(
                {
                    "group": group,
                    "name": name,
                    "args": list(fnargs),
                    "ok": False,
                    "error": "%s: %s" % (type(e).__name__, e),
                }
            )

    # parse_answer：判断题 9 种写法 + 单选/多选 + 文本匹配 + 越界
    judge_opts = list(grading.JUDGE_OPTIONS)
    for i, raw in enumerate(["正确", "错误", "对", "错", "√", "×", "T", "F", "是", "否", "A", "B", 1, 0]):
        add("parse_answer.judge", "判断题答案 %r" % (raw,), grading.parse_answer, raw, "judge", judge_opts)

    four = ["甲", "乙", "丙", "丁"]
    for raw in ["A", "a", "C", "A,B,D", "ABD", "A、B", "A|B", "1", "0,2", "乙丙"]:
        add("parse_answer.single_multi", "答案 %r（四选项）" % (raw,), grading.parse_answer, raw, "single", four)

    add("parse_answer.bad", "答案越界 E", grading.parse_answer, "E", "single", four)
    add("parse_answer.bad", "答案为空", grading.parse_answer, "", "single", four)

    # 括号规则
    for stem, qt in [
        ("下列说法正确的是（　）", "single"),
        ("下列说法正确的是（　　）", "single"),
        ("下列说法正确的是( )", "single"),
        ("下列说法正确的是。", "single"),
        ("下列属于流动资产的有（　）。", "multi"),
        ("下列属于流动资产的有：", "multi"),
        ("同业存单属于负债业务（　）。", "judge"),
        ("同业存单属于负债业务。", "judge"),
        ("（LCR）的监管最低标准是（　）", "single"),
        ("（2015 年修订）下列说法正确的是", "single"),
        ("（　）和（　）都对", "multi"),
    ]:
        add("parens", "括号 %r" % (stem,), grading.ensure_answer_parens, stem, qt)

    # 打乱与答案映射（固定 order，确定可比）
    for n in (2, 4, 6, 8):
        for order in ([0, 1, 2, 3][:n], list(reversed(range(n)))) if n <= 4 else ([*range(n)], [*reversed(range(n))]):
            add("map_answer", "order=%s n=%d" % (order, n), grading.map_answer, [0], order)
            add("display_options", "order=%s n=%d" % (order, n), grading.display_options, ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"][:n], order)

    add("order", "种子 42 打乱 6 个", lambda: grading.build_display_order(6, True, __import__("random").Random(42)))
    add("order", "不打乱 5 个", lambda: grading.build_display_order(5, False, None))

    # 判分
    for chosen, ans, qt in [
        ([0], [0], "single"),
        ([1], [0], "single"),
        ([], [0], "single"),
        ([0, 2], [0, 2], "multi"),
        ([0, 2], [2, 0], "multi"),
        ([0], [0, 2], "multi"),
        ([0, 1, 2], [0, 2], "multi"),
        ([1], [1], "judge"),
    ]:
        add("is_correct", "%s %s vs %s" % (chosen, ans, qt), grading.is_correct, chosen, ans, qt)

    # 文本与数值
    for qtype in ("single", "multi", "judge"):
        add("answer_text", "answer_text %s" % qtype, grading.answer_text, qtype, four if qtype != "judge" else judge_opts, [0] if qtype != "multi" else [0, 2])
        add("sel_text", "sel_text %s" % qtype, grading.sel_text, qtype, four if qtype != "judge" else judge_opts, [0])
    for v in (0, 1, 2.5, 2.4, 10, 3.33, 0.5, 12.0):
        add("fmt_score", "fmt_score %s" % v, grading.fmt_score, v)
    for r, b in ((7, 10), (0, 0), (1, 3), (22, 24), (0, 5)):
        add("accuracy", "accuracy %s/%s" % (r, b), grading.accuracy, r, b)
    # 注意：必须把入参作为 fnargs 传进去，否则 golden 里 args 为空，JS 侧拿不到值
    for x in (2.5, 3.5, 0.125, 1.005, 2.675, 0.5, -2.5, 12.345):
        add("pyround", "pyRound(%s, 2)" % x, lambda v, n: __import__("builtins").round(v, n), x, 2)
    for x in (2.5, 3.5, -0.5):
        add("pyround0", "pyRound(%s)" % x, lambda v: __import__("builtins").round(v), x)
    for raw in ("单选", "单选题", "单项选择题", "多选", "多项选择题", "判断", "判断题", "填空"):
        add("parse_qtype", "题型 %r" % (raw,), grading.parse_qtype, raw)

    dump("grading", {"cases": cases})

    # ------------------------------------------------------------ B. Excel 导入
    from openpyxl import Workbook
    from openpyxl import load_workbook as _lw

    def make_xlsx(name, rows, header_offset=0, sheet="题库"):
        path = os.path.join(tmp, name + ".xlsx")
        wb = Workbook()
        ws = wb.active
        ws.title = sheet
        for _ in range(header_offset):
            ws.append([])
        for r in rows:
            ws.append(r)
        wb.save(path)
        return path

    HEAD_8 = ["题型", "题干", "选项", "选项A", "选项B", "选项C", "选项D", "正确答案"]
    HEAD_2 = ["题型", "题干", "选项", "正确答案"]

    imp_cases = []

    def imp(name, rows, header_offset=0, sheet="题库", expect_error=False):
        try:
            path = make_xlsx(name.replace(" ", "_").replace("/", "_"), rows, header_offset, sheet)
            res = bank_import.parse_workbook(path)
            # 关键：基线用**回读出来的真实行**，而不是传进去的 rows。
            # 否则像「表头偏移」这种先补空白行再写入的用例，两语言喂的数据会不一致。
            _wb = _lw(path, read_only=True, data_only=True)
            _ws = _wb["题库"] if "题库" in _wb.sheetnames else _wb[_wb.sheetnames[0]]
            rows_actual = [list(r) for r in _ws.iter_rows(values_only=True)]
            _wb.close()
            imp_cases.append(
                {
                    "name": name,
                    "file": os.path.basename(path),
                    "rows": rows_actual,
                    "sheet": sheet,
                    "ok": True,
                    "expect": {
                        "questions": res.get("questions", []),
                        "errors": res.get("errors", []),
                        "warnings": res.get("warnings", []),
                    },
                }
            )
        except Exception as e:
            imp_cases.append(
                {
                    "name": name,
                    "rows": rows,
                    "headerOffset": header_offset,
                    "sheet": sheet,
                    "ok": False,
                    "error": "%s: %s" % (type(e).__name__, e),
                    "expectError": expect_error,
                }
            )

    imp("八列选项-标准", [HEAD_8, ["单选", "题干一", "", "甲", "乙", "丙", "丁", "B"]])
    imp("单列竖线", [HEAD_2, ["单选", "题干二", "甲|乙|丙|丁", "C"]])
    imp("单列换行", [HEAD_2, ["单选", "题干三", "甲\n乙\n丙", "A"]])
    imp("两种都填只认单列", [HEAD_8, ["单选", "题干四", "甲|乙|丙", "戊", "己", "庚", "辛", "A"]])
    imp("判断题忽略选项列", [HEAD_2, ["判断", "判断题干", "正确|错误", "对"]])
    imp("判断题9种写法", [HEAD_2] + [["判断", "判断题%d" % i, "", v] for i, v in enumerate(["对", "错", "√", "×", "T", "F", "是", "否"])])
    imp("带序号的选项", [HEAD_2, ["单选", "题干五", "A. 甲|B、乙|（1）丙", "A"]])
    imp("答案越界", [HEAD_2, ["单选", "题干六", "甲|乙", "E"]])
    imp("选项不足两个", [HEAD_2, ["单选", "题干七", "只有一个", "A"]])
    imp("题型无法识别", [HEAD_2, ["填空", "题干八", "甲|乙", "A"]])
    imp("题干为空", [HEAD_2, ["单选", "", "甲|乙", "A"]])
    imp("数字题干", [HEAD_2, ["单选", 2026, "甲|乙", "A"]])
    imp("表头不在第一行", [["题库导入"], [], HEAD_2, ["单选", "题干九", "甲|乙", "B"]], header_offset=2)
    imp("工作表名非题库", [["题型", "题干", "选项", "正确答案"], ["单选", "题干十", "甲|乙", "A"]], sheet="Sheet1")
    imp("空表", [[]])

    dump("import", {"cases": imp_cases})

    # ------------------------------------------------------------ C. 模板
    # 注意：openpyxl 生成的 xlsx 内含时间戳，**字节哈希每次都不一样**，
    # 所以基线用「内容哈希」：把单元格值序列化后取 sha256，稳定可复现。
    tpl = os.path.join(args.assets, "template.xlsx")
    bank_import.build_template(tpl)
    with open(tpl, "rb") as f:
        tpl_bytes_sha = hashlib.sha256(f.read()).hexdigest()

    from openpyxl import load_workbook as _lw

    _wb = _lw(tpl)
    snap = {}
    for _ws in _wb.worksheets:
        snap[_ws.title] = [
            [c.value for c in row] for row in _ws.iter_rows(max_row=30)
        ]
    content_sha = hashlib.sha256(
        json.dumps(snap, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    dump(
        "template",
        {
            "cases": [
                {
                    "name": "导入模板",
                    "sheets": list(snap.keys()),
                    "contentSha": content_sha,
                    "sampleRows": {k: v[:6] for k, v in snap.items()},
                }
            ]
        },
    )
    meta["template"] = {
        "path": "miniprogram/pkg-io-import/assets/template.xlsx",
        "contentSha": content_sha,
        "bytes": os.path.getsize(tpl),
        "note": "xlsx 字节含时间戳不可复现，校验请用 contentSha / 单元格内容",
    }
    print("  -> %s（%d 字节，内容哈希 %s）" % (tpl, os.path.getsize(tpl), content_sha[:16]))

    # ------------------------------------------------------------ D. 出卷与交卷
    from api import Api

    A = Api()
    qs = []
    for i in range(4):
        qs.append(
            {
                "qtype": "single",
                "stem": "单选中第 %d 题（　）" % (i + 1),
                "options": ["甲%d" % i, "乙%d" % i, "丙%d" % i, "丁%d" % i],
                "answer": [i % 4],
                "answer_text": "ABCD"[i % 4],
                "source_row": i + 2,
                "raw_type": "单选",
            }
        )
    for i in range(2):
        qs.append(
            {
                "qtype": "multi",
                "stem": "多选第 %d 题（　）" % (i + 1),
                "options": ["甲", "乙", "丙", "丁"],
                "answer": [0, 2],
                "answer_text": "A,C",
                "source_row": 10 + i,
                "raw_type": "多选",
            }
        )
    for i in range(2):
        qs.append(
            {
                "qtype": "judge",
                "stem": "判断第 %d 题。" % (i + 1),
                "options": ["正确", "错误"],
                "answer": [i % 2],
                "answer_text": "正确" if i % 2 == 0 else "错误",
                "source_row": 20 + i,
                "raw_type": "判断",
            }
        )

    from services import bank_repo

    bank = bank_repo.create_bank("黄金题库", "fixture.xlsx", qs)
    bank_id = bank["bank_id"]

    settings = {
        "bank_id": bank_id,
        "types": ["single", "multi", "judge"],
        "amount_mode": "all",
        "amount": {},
        "score": {"single": 2, "multi": 4, "judge": 1},
        "q_order": "asc",
        "a_order": "keep",
    }
    sess_cases = []
    pv = A.preview_paper(settings)["data"]
    sess_cases.append(
        {
            "name": "预览（全量、升序、不打乱）",
            "settings": settings,
            # 题目一起存下来，JS 侧才能用同一份输入跑 selectQuestions/buildItems
            "questions": [
                {"qid": i + 1, "qtype": q["qtype"], "stem": q["stem"], "options": q["options"], "answer": q["answer"]}
                for i, q in enumerate(qs)
            ],
            "expect": pv,
        }
    )

    cs = A.create_session(dict(settings, mode="practice"))["data"]
    sid = cs["session_id"]
    # 确定性卷面：q_order=asc + a_order=keep，可逐字段比对
    with db.ro() as con:
        it_rows = con.execute(
            "SELECT pos, qtype, stem, options_json, option_order_json, answer_disp_json, answer_disp_text, score "
            "FROM session_items WHERE session_id=? ORDER BY pos",
            (sid,),
        ).fetchall()
    expect_items = [
        {
            "pos": r["pos"],
            "qtype": r["qtype"],
            "stem": r["stem"],
            "options": json.loads(r["options_json"]),
            "order": json.loads(r["option_order_json"]),
            "answer_disp": json.loads(r["answer_disp_json"]),
            "answer_text": r["answer_disp_text"],
            "score": r["score"],
        }
        for r in it_rows
    ]
    sess_cases.append({"name": "确定性卷面 items（升序 + 不打乱）", "expectItems": expect_items})
    # 确定性作答：前 6 题答对，后 2 题答错/不答
    import json as _json

    with db.ro() as con:
        rows = con.execute(
            "SELECT pos, qtype, answer_disp_json FROM session_items WHERE session_id=? ORDER BY pos", (sid,)
        ).fetchall()
    for r in rows:
        pos = r["pos"]
        ans = json.loads(r["answer_disp_json"])
        if pos <= 4:
            A.answer({"session_id": sid, "pos": pos, "chosen": ans})
        elif pos == 5:
            A.answer({"session_id": sid, "pos": pos, "chosen": [0] if 0 not in ans else [1]})
    sub = A.submit_session({"session_id": sid})["data"]
    sess_cases.append(
        {
            "name": "练习交卷（前4题对、第5题错、其余未答）",
            "settings": dict(settings, mode="practice"),
            "answers": {"1-4": "全对", "5": "故意错", "6-8": "未答"},
            "expect": {k: sub[k] for k in ("total", "right", "wrong", "missing", "score", "score_total", "accuracy")},
        }
    )

    exam = A.create_session(dict(settings, mode="exam", candidate="张三 001"))["data"]
    esid = exam["session_id"]
    for r in rows[:3]:
        pass
    with db.ro() as con:
        erows = con.execute(
            "SELECT pos, answer_disp_json FROM session_items WHERE session_id=? ORDER BY pos", (esid,)
        ).fetchall()
    for r in erows[:3]:
        A.answer({"session_id": esid, "pos": r["pos"], "chosen": json.loads(r["answer_disp_json"])})
    esub = A.submit_session({"session_id": esid})["data"]
    sess_cases.append(
        {
            "name": "正式考试交卷（答 3 题全对，漏 5 题）",
            "settings": dict(settings, mode="exam", candidate="张三 001"),
            "expect": {k: esub[k] for k in ("total", "right", "wrong", "missing", "score", "score_total", "accuracy")},
        }
    )

    dump("session", {"cases": sess_cases})

    # ------------------------------------------------------------ E. 导出视图模型
    from services.export import model as export_model, html_tpl

    vm = export_model.build(esid, True)
    html = html_tpl.render_html(vm)
    fragments = [s for s in ("考生信息：", "得分：", "一、单项选择题", "二、多项选择题", "三、判断题", "参考答案", "本试卷由「随题」生成") if s in html]
    dump(
        "export",
        {
            "cases": [
                {
                    "name": "正式考试卷（含考生信息）",
                    "sessionId": esid,
                    "expect": {
                        "title": vm["title"],
                        "mode_title": vm["mode_title"],
                        "total": vm["total"],
                        "score_total": vm["score_total"],
                        "scores": vm["scores"],
                        "groupCount": len(vm["groups"]),
                        "groupTitles": [g["name"] for g in vm["groups"]],
                        "groupScores": [g["score"] for g in vm["groups"]],
                        "answerSheet": vm["answer_sheet"],
                        "fragments": fragments,
                        "hasDate": any(
                            s in html
                            for s in (
                                datetime.now().strftime("%Y-%m-%d"),
                                datetime.now().strftime("%Y/%m/%d"),
                                datetime.now().strftime("%Y年%m月%d日"),
                            )
                        ),
                    },
                }
            ]
        },
    )

    dump("meta", {"cases": [], **meta})
    shutil.rmtree(tmp, ignore_errors=True)
    print("\n完成。golden 目录：%s" % os.path.abspath(args.out))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)

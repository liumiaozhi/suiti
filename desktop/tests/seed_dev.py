# -*- coding: utf-8 -*-
"""开发数据种子：在独立的 .devdata 目录里造题库与做题记录，供界面预览使用。
不会碰真实的 %APPDATA%\\SuiTi 数据。

用法： .venv-build\\Scripts\\python.exe tests\\seed_dev.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "app"))

DEV = os.path.join(ROOT, ".devdata")
os.makedirs(DEV, exist_ok=True)
os.environ["APPDATA"] = DEV

import db  # noqa: E402

db.init_db()

from api import Api  # noqa: E402

A = Api()

SINGLE = [
    ("我国法定存款准备金制度由（　）负责统一实施。", ["中国人民银行", "国家金融监督管理总局", "财政部", "商业银行"], "A"),
    ("商业银行核心一级资本充足率不得低于（　）。", ["4%", "5%", "6%", "8%"], "B"),
    ("下列属于商业银行表外业务的是（　）。", ["各项贷款", "同业存放", "银行承兑汇票", "买入返售金融资产"], "C"),
    ("流动性覆盖率（LCR）的监管最低标准是（　）。", ["80%", "90%", "100%", "120%"], "C"),
    ("净稳定资金比例（NSFR）的监管最低标准是（　）。", ["90%", "100%", "110%", "120%"], "B"),
    ("商业银行单一客户贷款集中度不得超过资本净额的（　）。", ["5%", "10%", "15%", "20%"], "B"),
    ("大额存单的发行主体应当是（　）。", ["银行业存款类金融机构", "证券公司", "保险公司", "基金公司"], "A"),
    ("同业存单的发行期限最长不超过（　）。", ["6 个月", "1 年", "2 年", "3 年"], "B"),
    ("债券投资的持有至到期账户，其估值方式为（　）。", ["公允价值", "摊余成本", "成本与市价孰低", "可变现净值"], "B"),
    ("我国国债期货合约的标的券期限为（　）。", ["1-3 年", "3-5 年", "5-7 年", "10 年期以上"], "B"),
    ("利率互换（IRS）属于（　）。", ["场外衍生品", "场内期货", "现货交易", "资产证券化产品"], "A"),
    ("存款保险制度中，同一存款人在同一投保机构的最高偿付限额为人民币（　）。", ["30 万元", "50 万元", "80 万元", "100 万元"], "B"),
]

MULTI = [
    ("下列属于商业银行流动性资产的有（　）。", ["库存现金", "存放中央银行款项", "固定资产", "一个月内到期的拆放同业"], "ABD"),
    ("下列属于信用风险缓释工具的有（　）。", ["合格保证", "抵押品", "净额结算协议", "信用违约互换"], "ABC"),
    ("大额交易报告涉及的情形包括（　）。", ["单笔现金收付人民币 5 万元以上", "单笔转账人民币 200 万元以上", "跨境交易人民币 20 万元以上", "内部账户调拨"], "ABC"),
    ("下列属于商业银行负债业务的有（　）。", ["同业存放", "卖出回购", "发行金融债券", "买入返售"], "ABC"),
    ("利率风险的主要表现形式包括（　）。", ["重定价风险", "收益率曲线风险", "基差风险", "操作风险"], "ABC"),
    ("下列属于金融衍生品的是（　）。", ["利率互换", "国债期货", "同业存单", "债券远期"], "ABD"),
]

JUDGE = [
    ("同业存单属于商业银行的负债业务。", "正确"),
    ("存贷比目前仍是商业银行的强制性监管指标。", "错误"),
    ("净值型理财产品不承诺保本保收益。", "正确"),
    ("信用风险只存在于贷款业务中。", "错误"),
    ("流动性覆盖率越高，说明短期流动性风险抵御能力越强。", "正确"),
    ("商业银行可以无条件使用存款保险基金弥补经营亏损。", "错误"),
]


def make_xlsx(path, rows):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "题库"
    ws.append(["题型", "题干", "选项", "正确答案"])
    for r in rows:
        ws.append(list(r))
    wb.save(path)
    return path


def main():
    out = os.path.join(DEV, "fixtures")
    os.makedirs(out, exist_ok=True)

    rows = []
    for q, o, a in SINGLE:
        rows.append(["单选", q, "|".join(o), a])
    for q, o, a in MULTI:
        rows.append(["多选", q, "|".join(o), a])
    for q, a in JUDGE:
        rows.append(["判断", q, "", a])
    f1 = make_xlsx(os.path.join(out, "银行业务与合规题库.xlsx"), rows)

    rows2 = []
    for q, o, a in SINGLE[:6]:
        rows2.append(["单选", "【资金业务专项】" + q, "|".join(o), a])
    for q, o, a in MULTI[:3]:
        rows2.append(["多选", "【资金业务专项】" + q, "|".join(o), a])
    f2 = make_xlsx(os.path.join(out, "资金业务专项题库.xlsx"), rows2)

    for f in (f1, f2):
        r = A.import_bank_path({"path": f})
        print("import", os.path.basename(f), "->", json.dumps(r.get("data", {}).get("counts"), ensure_ascii=False))

    banks = A.list_banks({})["data"]["banks"]
    if not banks:
        raise SystemExit("导入失败")
    bid = banks[-1]["id"]

    def play(mode, candidate=None, answer_ratio=1.0, skip=0):
        st = {
            "bank_id": bid,
            "types": ["single", "multi", "judge"],
            "amount_mode": "num",
            "amount": {"single": 8, "multi": 4, "judge": 4},
            "score": {"single": 2, "multi": 4, "judge": 1},
            "q_order": "asc",
            "a_order": "shuffle" if mode != "exam" else "keep",
            "mode": mode,
        }
        if candidate:
            st["candidate"] = candidate
        cs = A.create_session(st)["data"]
        sid = cs["session_id"]
        with db.ro() as con:
            items = con.execute(
                "SELECT pos, answer_disp_json, options_json FROM session_items WHERE session_id=? ORDER BY pos", (sid,)
            ).fetchall()
        n = 0
        for it in items:
            if skip and n >= skip:
                continue
            ans = json.loads(it["answer_disp_json"])
            nopts = len(json.loads(it["options_json"]))
            seq = n + 1
            if answer_ratio < 1 and seq % 3 == 0:
                wrong = [x for x in range(nopts) if x not in ans][:1]
                chosen = wrong if wrong else ans
            else:
                chosen = ans
            A.answer({"session_id": sid, "pos": it["pos"], "chosen": chosen})
            n += 1
            if skip and n >= skip:
                break
        for it in items[:3]:
            A.toggle_mark({"session_id": sid, "pos": it["pos"], "marked": True})
        s = A.submit_session({"session_id": sid})["data"]
        print(mode, "->", "得分", s["score"], "/", s["score_total"], "对", s["right"], "错", s["wrong"], "漏", s["missing"])
        return sid

    sid_p = play("practice", answer_ratio=0.85)
    play("mock", candidate="李四 2026002", answer_ratio=0.7)
    sid_e = play("exam", candidate="张三 2026001", answer_ratio=0.9, skip=14)
    play("exam", candidate="王五 2026003", answer_ratio=0.75)

    # 给「重难错题」模块造一些归集数据
    for p in (2, 5, 9, 12):
        A.toggle_hard({"session_id": sid_p, "pos": p, "hard": True})
    for p in (1, 6):
        A.toggle_hard({"session_id": sid_e, "pos": p, "hard": True})
    print("重难错题：", A.hard_overview({})["data"])

    print("\n数据目录：", os.path.join(DEV, "SuiTi"))
    print("题库：", [b["name"] for b in A.list_banks({})["data"]["banks"]])


if __name__ == "__main__":
    main()

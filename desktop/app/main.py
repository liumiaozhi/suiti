# -*- coding: utf-8 -*-
"""随题 —— 桌面做题程序入口。

注意：打包为 windowed（无控制台）后 sys.stdout / sys.stderr 为 None，
任何 print() 都会抛 AttributeError 导致静默崩溃，因此全工程只用 logging。
"""
from __future__ import annotations

import ctypes
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

import paths


def setup_logging(debug: bool = False) -> None:
    # windowed 模式的 stdout 兜底（必须在任何可能 print 的代码之前）
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8", errors="ignore")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8", errors="ignore")

    root = logging.getLogger()
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    try:
        fh = RotatingFileHandler(str(paths.log_path()), maxBytes=1024 * 1024, backupCount=3, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass

    if not paths.FROZEN:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        root.addHandler(sh)


_MUTEX = None


def acquire_single_instance() -> bool:
    """用命名互斥体做单实例；已存在时返回 False。"""
    global _MUTEX
    try:
        kernel32 = ctypes.windll.kernel32
        _MUTEX = kernel32.CreateMutexW(None, False, "Local\\SuiTi.SingleInstance.v1")
        last = kernel32.GetLastError()
        if last == 183:  # ERROR_ALREADY_EXISTS
            return False
        return True
    except Exception:
        return True


def warn_already_running() -> None:
    try:
        ctypes.windll.user32.MessageBoxW(
            None, "随题已经在运行中，请查看任务栏。", "随题", 0x40
        )
    except Exception:
        pass


def run_selftest() -> int:
    """无界面的打包自检：验证冻结后的所有依赖与数据库/导出链路。

    用法： 随题.exe --selftest
    结果同时写入 %SUITI_SELFTEST_OUT%（若设置）与日志。
    """
    import json
    import tempfile

    tmp = tempfile.mkdtemp(prefix="suiti_selftest_")
    os.environ["APPDATA"] = tmp  # 自检使用一次性数据目录，不碰用户数据

    log = logging.getLogger("selftest")
    out = {"frozen": paths.FROZEN, "version": paths.VERSION, "python": sys.version.split()[0], "cases": {}}

    def case(name, fn):
        try:
            out["cases"][name] = {"ok": True, "detail": fn()}
        except Exception as e:
            import traceback

            out["cases"][name] = {"ok": False, "error": "%s: %s" % (type(e).__name__, e), "trace": traceback.format_exc()[-800:]}
        log.info("selftest %s -> %s", name, out["cases"][name]["ok"])

    def c_env():
        return {"data_dir": str(paths.data_dir()), "gui": str(paths.gui_dir()), "index_html": paths.index_html().is_file()}

    def c_db():
        import db as _db

        _db.init_db()
        return str(paths.db_path())

    def c_deps():
        import docx
        import openpyxl

        return {"openpyxl": openpyxl.__version__, "python_docx": getattr(docx, "__version__", "ok")}

    state = {}

    def c_bank():
        from services import bank_import, bank_repo

        tpl = os.path.join(tmp, "tpl.xlsx")
        bank_import.build_template(tpl)
        questions = []
        for i in range(3):
            questions.append(
                {
                    "qtype": "single",
                    "stem": "自检单选题 %d" % i,
                    "options": ["甲", "乙", "丙", "丁"],
                    "answer": [i % 4],
                    "answer_text": "ABCD"[i % 4],
                    "source_row": i + 2,
                    "raw_type": "单选",
                }
            )
        questions.append(
            {
                "qtype": "multi",
                "stem": "自检多选题",
                "options": ["甲", "乙", "丙", "丁"],
                "answer": [0, 2],
                "answer_text": "A,C",
                "source_row": 9,
                "raw_type": "多选",
            }
        )
        questions.append(
            {
                "qtype": "judge",
                "stem": "自检判断题",
                "options": ["正确", "错误"],
                "answer": [0],
                "answer_text": "正确",
                "source_row": 10,
                "raw_type": "判断",
            }
        )
        created = bank_repo.create_bank("自检题库", tpl, questions)
        state["bank"] = created
        return created

    def c_session():
        from services import session as sess

        data = sess.create_session(
            {
                "bank_id": state["bank"]["bank_id"],
                "types": ["single", "multi", "judge"],
                "amount_mode": "all",
                "amount": {},
                "score_per_q": 2,
                "q_order": "random",
                "a_order": "shuffle",
                "mode": "practice",
            }
        )
        state["session"] = data
        return {"session_id": data["session_id"], "total": data["total"]}

    def c_answer():
        from services import session as sess

        sid = state["session"]["session_id"]
        for it in state["session"]["items"]:
            sess.answer({"session_id": sid, "pos": it["pos"], "chosen": [0]})
        summary = sess.submit({"session_id": sid})
        state["summary"] = summary
        return {k: summary[k] for k in ("total", "right", "wrong", "missing", "score")}

    def c_stats():
        from services import stats

        return stats.practice_records({})["overall"]

    def c_export():
        from services.export import exporter, to_pdf

        sid = state["session"]["session_id"]
        res = {}
        for fmt in ("docx", "xlsx", "pdf"):
            r = exporter.export_paper(sid, fmt, window=None, with_answer=True)
            p = r.get("path")
            res[fmt] = os.path.getsize(p) if p and os.path.exists(p) else 0
        res["edge"] = to_pdf.find_edge() or ""
        return res

    case("env", c_env)
    case("db", c_db)
    case("deps", c_deps)
    case("template_and_bank", c_bank)
    case("create_session", c_session)
    case("answer_and_submit", c_answer)
    case("stats", c_stats)
    case("export", c_export)

    out["ok"] = all(c["ok"] for c in out["cases"].values())
    text = json.dumps(out, ensure_ascii=False, indent=2)
    log.info("selftest 结果:\n%s", text)
    target = os.environ.get("SUITI_SELFTEST_OUT")
    if target:
        try:
            with open(target, "w", encoding="utf-8") as f:
                f.write(text)
        except OSError:
            pass
    return 0 if out["ok"] else 1


def main() -> None:
    debug = "--debug" in sys.argv
    setup_logging(debug)
    log = logging.getLogger("main")
    log.info("==== 随题 启动 v%s frozen=%s ====", paths.VERSION, paths.FROZEN)
    log.info("资源目录 %s", paths.res_base())
    log.info("数据目录 %s", paths.data_dir())

    if "--selftest" in sys.argv:
        sys.exit(run_selftest())

    if not acquire_single_instance():
        log.info("检测到已有实例，退出")
        warn_already_running()
        return

    import db

    db.init_db()

    import api as api_mod
    import webview
    from services import session as session_mod

    session_mod.cleanup_stale(12)

    html = paths.index_html()
    if not html.exists():
        log.error("找不到界面文件：%s", html)
        ctypes.windll.user32.MessageBoxW(None, "界面文件缺失：%s" % html, "随题 - 启动失败", 0x10)
        return

    api_inst = api_mod.Api()
    window = webview.create_window(
        "%s v%s" % (paths.APP_NAME, paths.VERSION),
        url=str(html),
        js_api=api_inst,
        width=1320,
        height=880,
        min_size=(1080, 720),
        text_select=True,
        confirm_close=False,
        background_color="#f4f7fb",
    )
    api_inst._bind(window)

    def on_closing():
        """有未交卷的作答时二次确认，避免误关丢数据。"""
        try:
            from services import session as s

            if s.ongoing_count() > 0:
                r = ctypes.windll.user32.MessageBoxW(
                    None,
                    "还有未交卷的做题记录。\n现在关闭将丢失本次未交卷的作答内容，确定要关闭吗？",
                    "随题",
                    0x31,  # MB_OKCANCEL | MB_ICONWARNING
                )
                if r != 1:  # IDOK
                    return False
                s.abandon_all_ongoing()
        except Exception:
            log.exception("关窗确认失败")
        return True

    try:
        window.events.closing += on_closing
    except Exception:
        log.warning("注册关窗事件失败")

    webview.start(gui="edgechromium", debug=debug)
    log.info("==== 退出 ====")


if __name__ == "__main__":
    main()

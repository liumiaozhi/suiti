# -*- coding: utf-8 -*-
"""暴露给前端的 API 层。

契约（前端 core.js 依赖）：
  * 每个方法只接收一个 dict 参数；
  * 永不抛异常给前端，一律返回 {"ok":true,"data":{...}} 或 {"ok":false,"error":{code,msg,detail}}；
  * 方法名不要以下划线开头（pywebview 会把下划线开头的成员隐藏）。
"""
from __future__ import annotations

import logging
import os
import sys
import traceback

import paths
from errors import UserError
from services import bank_import, bank_repo, session, stats
from services.export import exporter, to_pdf

log = logging.getLogger("api")


def ok(data=None):
    return {"ok": True, "data": data if data is not None else {}}


def fail(code, msg, detail=None):
    return {"ok": False, "error": {"code": code, "msg": msg, "detail": detail or {}}}


class Api:
    def __init__(self):
        self._win = None

    def _bind(self, window):
        self._win = window

    # ------------------------------------------------------------------ 内部
    def _guard(self, name, fn, payload):
        try:
            data = fn(payload or {})
            log.info("api.%s ok", name)
            return ok(data)
        except UserError as e:
            log.warning("api.%s 业务错误 %s: %s", name, e.code, e.msg)
            return fail(e.code, e.msg, e.detail)
        except Exception as e:
            log.exception("api.%s 未处理异常", name)
            return fail("INTERNAL", "程序内部错误：%s" % e, {"trace": traceback.format_exc()[-1800:]})

    def _dialog(self, kind, **kw):
        if self._win is None:
            return None
        import webview

        mode = webview.OPEN_DIALOG if kind == "open" else webview.SAVE_DIALOG
        try:
            return self._win.create_file_dialog(mode, **kw)
        except Exception as e:
            log.warning("文件对话框失败: %s", e)
            return None

    # ------------------------------------------------------------------ 基础
    def ping(self, payload=None):
        return ok({"pong": True, "version": paths.VERSION})

    def app_info(self, payload=None):
        return self._guard("app_info", self._app_info, payload)

    def _app_info(self, p):
        edge = to_pdf.find_edge()
        return {
            "version": paths.VERSION,
            "app_name": paths.APP_NAME,
            "data_dir": str(paths.data_dir()),
            "log_path": str(paths.log_path()),
            "export_dir": str(paths.export_dir()),
            "edge_found": bool(edge),
            "edge_path": edge or "",
            "python": sys.version.split()[0],
            "frozen": paths.FROZEN,
            "has_window": self._win is not None,
        }

    def self_test(self, payload=None):
        return self._guard("self_test", self._self_test, payload)

    def _self_test(self, p):
        out = {}
        for name, imp in (
            ("openpyxl", "openpyxl"),
            ("docx", "docx"),
            ("sqlite3", "sqlite3"),
        ):
            try:
                mod = __import__(imp)
                out[name] = getattr(mod, "__version__", "ok")
            except Exception as e:
                out[name] = "ERR: %s" % e
        return out

    # ------------------------------------------------------------------ 题库
    def download_template(self, payload=None):
        return self._guard("download_template", self._download_template, payload)

    def _download_template(self, p):
        default = bank_import.TEMPLATE_NAME
        target = None
        if self._win is not None:
            res = self._dialog(
                "save", directory=str(paths.export_dir()), save_filename=default, file_types=("Excel 文件 (*.xlsx)",)
            )
            if isinstance(res, (list, tuple)):
                res = res[0] if res else None
            if not res:
                return {"saved": False, "cancelled": True}
            target = str(res)
            if not target.lower().endswith(".xlsx"):
                target += ".xlsx"
        else:
            target = str(paths.export_dir() / default)

        d = os.path.dirname(os.path.abspath(target))
        if d:
            os.makedirs(d, exist_ok=True)
        bank_import.build_template(target)
        return {"saved": True, "path": target, "filename": os.path.basename(target)}

    def pick_and_import_bank(self, payload=None):
        return self._guard("pick_and_import_bank", self._pick_and_import, payload)

    def _pick_and_import(self, p):
        res = self._dialog(
            "open",
            allow_multiple=True,
            directory=str(paths.export_dir()),
            file_types=("Excel 文件 (*.xlsx;*.xlsm)", "所有文件 (*.*)"),
        )
        if not res:
            return {"cancelled": True, "results": []}
        if isinstance(res, str):
            res = [res]
        return {"cancelled": False, "results": [self._import_one(fp) for fp in res]}

    def import_bank_path(self, payload=None):
        return self._guard("import_bank_path", self._import_path, payload)

    def _import_path(self, p):
        fp = (p or {}).get("path") or ""
        if not fp or not os.path.isfile(fp):
            raise UserError("文件不存在：%s" % fp)
        return self._import_one(fp)

    def _import_one(self, file_path: str) -> dict:
        name = os.path.splitext(os.path.basename(file_path))[0]
        try:
            parsed = bank_import.parse_workbook(file_path)
        except UserError as e:
            return {"file": os.path.basename(file_path), "ok": False, "errors": [{"row": 0, "msg": e.msg}], "warnings": []}
        except Exception as e:
            log.exception("解析失败 %s", file_path)
            return {
                "file": os.path.basename(file_path),
                "ok": False,
                "errors": [{"row": 0, "msg": "文件无法读取：%s" % e}],
                "warnings": [],
            }

        if parsed["errors"]:
            return {
                "file": os.path.basename(file_path),
                "ok": False,
                "errors": parsed["errors"][:50],
                "error_count": len(parsed["errors"]),
                "warnings": parsed["warnings"][:50],
            }

        if not parsed["questions"]:
            return {
                "file": os.path.basename(file_path),
                "ok": False,
                "errors": [{"row": 0, "msg": "表格里没有读到任何题目（请确认数据写在「题库」工作表、表头未改动）"}],
                "warnings": [],
            }

        created = bank_repo.create_bank(name, file_path, parsed["questions"])
        return {
            "file": os.path.basename(file_path),
            "ok": True,
            "bank_id": created["bank_id"],
            "name": created["name"],
            "renamed": created["renamed"],
            "counts": created["counts"],
            "errors": [],
            "warnings": parsed["warnings"][:50],
        }

    def list_banks(self, payload=None):
        return self._guard("list_banks", lambda p: {"banks": bank_repo.list_banks()}, payload)

    def delete_bank(self, payload=None):
        return self._guard("delete_bank", self._delete_bank, payload)

    def _delete_bank(self, p):
        bank_id = int((p or {}).get("bank_id") or 0)
        if bank_id <= 0:
            raise UserError("请选择题库")
        if not bank_repo.delete_bank(bank_id):
            raise UserError("题库不存在或已删除")
        return {"deleted": True, "bank_id": bank_id}

    # ------------------------------------------------------------------ 做题
    def preview_paper(self, payload=None):
        return self._guard("preview_paper", session.preview, payload)

    def create_session(self, payload=None):
        return self._guard("create_session", session.create_session, payload)

    def answer(self, payload=None):
        return self._guard("answer", session.answer, payload)

    def toggle_mark(self, payload=None):
        return self._guard("toggle_mark", session.toggle_mark, payload)

    def get_session_state(self, payload=None):
        return self._guard("get_session_state", session.get_state, payload)

    def submit_session(self, payload=None):
        return self._guard("submit_session", session.submit, payload)

    def abandon_session(self, payload=None):
        return self._guard("abandon_session", session.abandon, payload)

    def get_result(self, payload=None):
        return self._guard("get_result", session.get_result, payload)

    def ongoing_session(self, payload=None):
        return self._guard("ongoing_session", lambda p: {"count": session.ongoing_count()}, payload)

    # ------------------------------------------------------------------ 记录
    def get_records(self, payload=None):
        return self._guard("get_records", stats.practice_records, payload)

    def list_exam_records(self, payload=None):
        return self._guard("list_exam_records", stats.exam_records, payload)

    def get_exam_detail(self, payload=None):
        return self._guard("get_exam_detail", session.get_result, payload)

    # ------------------------------------------------------------------ 重难错题
    def hard_overview(self, payload=None):
        return self._guard("hard_overview", session.hard_overview, payload)

    def hard_map(self, payload=None):
        return self._guard("hard_map", session.hard_counts, payload)

    def list_hard(self, payload=None):
        return self._guard("list_hard", session.list_hard, payload)

    def toggle_hard(self, payload=None):
        return self._guard("toggle_hard", session.toggle_hard, payload)

    def remove_hard(self, payload=None):
        return self._guard("remove_hard", session.remove_hard, payload)

    def export_hard(self, payload=None):
        return self._guard("export_hard", self._export_hard, payload)

    def _export_hard(self, p):
        bank_id = int((p or {}).get("bank_id") or 0)
        fmt = ((p or {}).get("fmt") or "pdf").lower()
        if bank_id <= 0:
            raise UserError("请选择题库")
        return exporter.export_hard(bank_id, fmt, window=self._win, with_answer=bool((p or {}).get("with_answer", True)))

    # ------------------------------------------------------------------ 导出
    def export_paper(self, payload=None):
        return self._guard("export_paper", self._export_paper, payload)

    def _export_paper(self, p):
        session_id = int((p or {}).get("session_id") or 0)
        fmt = ((p or {}).get("fmt") or "pdf").lower()
        with_answer = bool((p or {}).get("with_answer", True))
        if session_id <= 0:
            raise UserError("没有可导出的试卷")
        return exporter.export_paper(session_id, fmt, window=self._win, with_answer=with_answer)

    def open_folder(self, payload=None):
        return self._guard("open_folder", lambda p: exporter.open_folder((p or {}).get("path") or ""), payload)

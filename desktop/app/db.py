# -*- coding: utf-8 -*-
"""SQLite 连接与建表。

约定：
  * 每次调用新开连接（pywebview 的 js_api 可能落在不同线程），不共享连接对象。
  * WAL + busy_timeout，读写并发不锁死。
  * 所有时间字段为本地 ISO8601 字符串（'YYYY-MM-DD HH:MM:SS'），便于直接排序与展示。
"""
from __future__ import annotations

import contextlib
import logging
import sqlite3
from datetime import datetime

import paths

log = logging.getLogger("db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS banks(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL UNIQUE,
  source_file TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS questions(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id      INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  qtype        TEXT NOT NULL CHECK(qtype IN ('single','multi','judge')),
  stem         TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer_json  TEXT NOT NULL,
  answer_text  TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  source_row   INTEGER,
  raw_type     TEXT
);
CREATE INDEX IF NOT EXISTS idx_q_bank_type ON questions(bank_id, qtype, seq);
CREATE INDEX IF NOT EXISTS idx_q_bank      ON questions(bank_id, seq);

CREATE TABLE IF NOT EXISTS sessions(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id       INTEGER REFERENCES banks(id) ON DELETE SET NULL,
  bank_name     TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK(mode IN ('practice','mock','exam')),
  candidate     TEXT,
  settings_json TEXT NOT NULL,
  total         INTEGER NOT NULL,
  score_per_q   REAL NOT NULL,
  score_total   REAL,
  source        TEXT NOT NULL DEFAULT 'bank',
  status        TEXT NOT NULL DEFAULT 'ongoing',
  started_at    TEXT NOT NULL,
  submitted_at  TEXT,
  duration_sec  INTEGER,
  score         REAL,
  right_cnt     INTEGER,
  wrong_cnt     INTEGER,
  missing_cnt   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sess_mode ON sessions(mode, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sess_bank ON sessions(bank_id);

CREATE TABLE IF NOT EXISTS session_items(
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  qid               INTEGER,
  pos               INTEGER NOT NULL,
  qtype             TEXT NOT NULL,
  stem              TEXT NOT NULL,
  options_json      TEXT NOT NULL,
  option_order_json TEXT NOT NULL,
  answer_disp_json  TEXT NOT NULL,
  answer_disp_text  TEXT NOT NULL,
  score             REAL NOT NULL DEFAULT 0,
  marked            INTEGER NOT NULL DEFAULT 0,
  chosen_json       TEXT,
  is_correct        INTEGER,
  answered_cnt      INTEGER NOT NULL DEFAULT 0,
  answered_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_pos ON session_items(session_id, pos);

-- 重难错题：按题库归集，保存题目快照（题库删掉后连同这里一起清）
CREATE TABLE IF NOT EXISTS hard_questions(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id      INTEGER NOT NULL,
  bank_name    TEXT NOT NULL,
  qid          INTEGER,
  qtype        TEXT NOT NULL,
  stem         TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer_json  TEXT NOT NULL,
  answer_text  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hard ON hard_questions(bank_id, qid);
CREATE INDEX IF NOT EXISTS idx_hard_bank ON hard_questions(bank_id, id);

CREATE TABLE IF NOT EXISTS attempts(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pos        INTEGER NOT NULL,
  chosen_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att ON attempts(session_id, pos);

CREATE TABLE IF NOT EXISTS meta(
  k TEXT PRIMARY KEY,
  v TEXT
);
"""


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect() -> sqlite3.Connection:
    """新连接。

    说明：journal_mode=WAL 是写进数据库文件头的持久设置，只在 init_db 里设一次。
    实测 `PRAGMA synchronous=NORMAL` 每条连接要 33ms（会触发 WAL checkpoint），
    与默认 synchronous=FULL 下的提交开销相同，因此不做这个"优化"——保留 FULL，
    让每条作答都真正落盘：断电也不丢答案，35ms 对操作者不可感知。
    """
    con = sqlite3.connect(str(paths.db_path()), timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=3000")
    con.execute("PRAGMA foreign_keys=ON")
    return con


@contextlib.contextmanager
def tx():
    """写事务。"""
    con = connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


@contextlib.contextmanager
def ro():
    """只读连接。"""
    con = connect()
    try:
        yield con
    finally:
        con.close()


def _columns(con, table: str) -> set[str]:
    try:
        return {r[1] for r in con.execute("PRAGMA table_info(%s)" % table)}
    except sqlite3.Error:
        return set()


def _migrate(con) -> None:
    """老版本数据库就地升级（幂等）。"""
    added = []
    for table, col, ddl in (
        ("session_items", "score", "ALTER TABLE session_items ADD COLUMN score REAL NOT NULL DEFAULT 0"),
        ("sessions", "score_total", "ALTER TABLE sessions ADD COLUMN score_total REAL"),
        ("sessions", "source", "ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'bank'"),
    ):
        if table in ("sessions", "session_items") and col not in _columns(con, table):
            con.execute(ddl)
            added.append("%s.%s" % (table, col))

    # 老数据回填（只在刚加列时做一次）：题目分值 = 会话的每题分值；满分 = 每题分值 × 题数
    if "session_items.score" in added:
        con.execute(
            "UPDATE session_items SET score = COALESCE((SELECT score_per_q FROM sessions s"
            " WHERE s.id = session_items.session_id), 0)"
        )
    if "sessions.score_total" in added:
        con.execute("UPDATE sessions SET score_total = ROUND(score_per_q * total, 2)")
    if "sessions.source" in added:
        con.execute("UPDATE sessions SET source = 'bank'")
    if added:
        log.info("数据库已升级：%s", ", ".join(added))
        con.commit()


def init_db() -> None:
    con = connect()
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(SCHEMA)
        con.commit()
        _migrate(con)
        cur = con.execute("SELECT v FROM meta WHERE k='schema_version'")
        row = cur.fetchone()
        if not row:
            con.execute("INSERT INTO meta(k,v) VALUES('schema_version','2')")
            con.commit()
        elif row["v"] != "2":
            con.execute("UPDATE meta SET v='2' WHERE k='schema_version'")
            con.commit()
    finally:
        con.close()


def rows_to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]

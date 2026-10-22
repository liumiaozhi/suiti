// 本地数据层：storage 存索引 + 文件存正文（见 utils/chunkStore.js 的说明）。
//
// **不直接 require wx**：storage / fs / clock / rng 全部由外部注入，
// 这样 tests/node 里可以用内存实现跑单测（见 tests/node/fakes/）。
//
// 会话（做题场次）的写入策略（对应桌面版"每条作答一个事务"）：
//   * 建卷时一次性写 head + items（大块，落文件）
//   * 作答只写 ans 增量（几 KB），**不重写 200 题快照**
//   * 交卷时合并 head+items+ans 重算，再删 ans
//   * 启动自愈：ongoing 且 ans 存在 -> 重放

const { createChunkStore } = require('../chunkStore');
const settings = require('../../core/settings');
const paper = require('../../core/paper');
const grading = require('../../core/grading');
const stats = require('../../core/stats');
const { UserError } = require('../../core/errors');

const SCHEMA = 1;
const K_VER = 'suiti:v';
const K_BANKS = 'suiti:idx:banks';
const K_SESS = 'suiti:idx:sess';
const K_HARD = 'suiti:idx:hard';
const CHUNK_SIZE = 200;

function nameKey(name) {
  return String(name || '').replace(/\s+/g, '').toLowerCase();
}

function newId(prefix, clock, rng) {
  return prefix + Date.now().toString(36) + Math.floor(rng() * 1e6).toString(36);
}

function createLocalRepo(deps) {
  const storage = deps.storage;
  const fs = deps.fs;
  const clock = deps.clock;
  const rng = deps.rng || Math.random;
  const store = createChunkStore(storage, fs);

  const readIndex = (key) => storage.get(key, []) || [];
  const writeIndex = (key, value) => {
    try {
      storage.set(key, value);
    } catch (e) {
      throw UserError('本地存储空间不足，请先到设置页清理旧记录');
    }
  };

  function init() {
    const v = storage.get(K_VER, 0);
    if (v !== SCHEMA) storage.set(K_VER, SCHEMA);
    fs.mkdir('banks');
    fs.mkdir('sess');
    fs.mkdir('hard');
    return { schema: SCHEMA, migrated: v !== SCHEMA };
  }

  function getEnv() {
    const si = storage.info ? storage.info() : { currentKB: -1, limitKB: -1 };
    let fileKB = -1;
    try {
      fileKB = Math.round(fs.dirSize('') / 1024);
    } catch (e) {}
    return {
      schema: storage.get(K_VER, 0),
      storageKB: si.currentKB,
      storageLimitKB: si.limitKB,
      fileKB,
    };
  }

  // ---------------------------------------------------------------- 题库
  function listBanks(opts) {
    const o = opts || {};
    const all = readIndex(K_BANKS);
    const live = o.includeDeleted ? all : all.filter((b) => !b.deletedAt);
    return live.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function getBank(id) {
    const all = readIndex(K_BANKS);
    return all.filter((b) => b.id === id && !b.deletedAt)[0] || null;
  }

  function countsOf(questions) {
    const c = { single: 0, multi: 0, judge: 0, total: (questions || []).length };
    for (const q of questions || []) if (c[q.qtype] !== undefined) c[q.qtype] += 1;
    return c;
  }

  /** 建库：重名自动 (2)(3)，名称截断 80，正文按 200 题分片。 */
  function createBank(input) {
    const questions = input.questions || [];
    if (!questions.length) throw UserError('没有可导入的题目');
    const all = readIndex(K_BANKS);

    let base = String(input.name || '未命名题库').trim() || '未命名题库';
    base = base.slice(0, 80);
    let final = base;
    let key = nameKey(final);
    let n = 2;
    while (all.some((b) => !b.deletedAt && b.nameKey === key)) {
      final = base + ' (' + n + ')';
      key = nameKey(final);
      n += 1;
      if (n > 999) throw UserError('题库重名过多');
    }

    const id = newId('b', clock, rng);
    const chunks = [];
    for (let i = 0; i < questions.length; i += CHUNK_SIZE) {
      const part = questions.slice(i, i + CHUNK_SIZE);
      chunks.push(store.put('banks/' + id + '/q.' + chunks.length, part));
    }
    fs.writeJson('banks/' + id + '/meta.json', { id, name: final, sourceFile: input.sourceFile || '', createdAt: clock.now() });

    const entry = {
      id,
      name: final,
      nameKey: key,
      sourceFile: input.sourceFile || '',
      createdAt: clock.now(),
      deletedAt: '',
      counts: countsOf(questions),
      chunks,
    };
    all.push(entry);
    writeIndex(K_BANKS, all);
    return { bankId: id, name: final, renamed: final !== base, counts: entry.counts };
  }

  /** 软删除；同时级联删掉该库的重难错题（与桌面版一致）。 */
  function deleteBank(id) {
    const all = readIndex(K_BANKS);
    const hit = all.filter((b) => b.id === id)[0];
    if (!hit) return { deleted: false };
    hit.deletedAt = clock.now();
    writeIndex(K_BANKS, all);
    // 级联：重难错题
    removeHard({ bankId: id, all: true });
    return { deleted: true };
  }

  /** 读全部题目（建卷时用）。session 快照优先，这里只用于抽题。 */
  function getBankQuestions(id) {
    const bank = getBank(id);
    if (!bank) return [];
    const out = [];
    for (const ref of bank.chunks || []) {
      const part = store.get(ref, []);
      for (const q of part) out.push(q);
    }
    return out;
  }

  // ---------------------------------------------------------------- 会话
  const SESSION_INDEX_MAX = 300;

  function listSessions() {
    return readIndex(K_SESS);
  }

  function getSessionMeta(id) {
    return readIndex(K_SESS).filter((s) => s.id === id)[0] || null;
  }

  function upsertSessionIndex(entry) {
    const all = readIndex(K_SESS);
    const i = all.findIndex((s) => s.id === entry.id);
    if (i >= 0) all[i] = Object.assign({}, all[i], entry);
    else all.push(entry);
    // 只保留最近 N 条
    all.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const kept = all.slice(0, SESSION_INDEX_MAX);
    writeIndex(K_SESS, kept);
    return kept[0] === entry ? entry : all.filter((s) => s.id === entry.id)[0];
  }

  function putSession(session, items) {
    fs.writeJson('sess/' + session.id + '/head.json', session);
    const chunks = [];
    for (let i = 0; i < items.length; i += 50) {
      const part = items.slice(i, i + 50);
      chunks.push(store.put('sess/' + session.id + '/items.' + chunks.length, part, { forceFile: true }));
    }
    const head = Object.assign({}, session, { itemChunks: chunks });
    fs.writeJson('sess/' + session.id + '/head.json', head);
    upsertSessionIndex({
      id: session.id,
      bankId: session.bankId,
      bankName: session.bankName,
      mode: session.mode,
      candidate: session.candidate || '',
      status: session.status || 'ongoing',
      source: session.source || 'bank',
      startedAt: session.startedAt,
      submittedAt: session.submittedAt || '',
      total: items.length,
      score: session.score || 0,
      scoreTotal: session.scoreTotal || 0,
      right: session.right || 0,
      wrong: session.wrong || 0,
      missing: session.missing || 0,
    });
    return head;
  }

  function getSession(id) {
    try {
      return fs.readJson('sess/' + id + '/head.json');
    } catch (e) {
      return null;
    }
  }

  function getSessionItems(id) {
    const head = getSession(id);
    if (!head) return [];
    const out = [];
    for (const ref of head.itemChunks || []) {
      const part = store.get(ref, []);
      for (const it of part) out.push(it);
    }
    return out;
  }

  /** 作答增量：只写几 KB，不重写整份快照。 */
  function putAns(id, ans) {
    fs.writeJson('sess/' + id + '/ans.json', ans);
  }

  function getAns(id) {
    try {
      return fs.readJson('sess/' + id + '/ans.json');
    } catch (e) {
      return null;
    }
  }

  function delAns(id) {
    fs.unlink('sess/' + id + '/ans.json');
  }

  /** 交卷后把判定结果写回 items（供结果页/错题页读取）。 */
  function putGradedItems(id, items) {
    const chunks = [];
    for (let i = 0; i < items.length; i += 50) {
      const part = items.slice(i, i + 50);
      chunks.push(store.put('sess/' + id + '/items.' + chunks.length, part, { forceFile: true }));
    }
    const head = getSession(id) || {};
    head.itemChunks = chunks;
    fs.writeJson('sess/' + id + '/head.json', head);
  }

  function removeSession(id) {
    try {
      fs.rmdir('sess/' + id);
    } catch (e) {}
    const all = readIndex(K_SESS).filter((s) => s.id !== id);
    writeIndex(K_SESS, all);
  }

  // ---------------------------------------------------------------- 重难错题
  function hardFile(bankId) {
    return 'hard/' + bankId + '.json';
  }

  function readHard(bankId) {
    try {
      return fs.readJson(hardFile(bankId));
    } catch (e) {
      return [];
    }
  }

  function writeHard(bankId, list) {
    fs.writeJson(hardFile(bankId), list);
    syncHardIndex(bankId);
  }

  function syncHardIndex(bankId) {
    const list = readHard(bankId);
    const banks = readIndex(K_BANKS);
    const bank = banks.filter((b) => b.id === bankId)[0];
    const idx = readIndex(K_HARD).filter((h) => h.bankId !== bankId);
    if (list.length && bank && !bank.deletedAt) {
      const counts = countsOf(list);
      idx.push({
        bankId,
        bankName: bank.name,
        total: list.length,
        single: counts.single,
        multi: counts.multi,
        judge: counts.judge,
        lastAt: list.length ? list[list.length - 1].createdAt : '',
      });
    }
    writeIndex(K_HARD, idx);
  }

  function hardOverview() {
    const idx = readIndex(K_HARD);
    const banks = readIndex(K_BANKS);
    const live = idx.filter((h) => {
      const b = banks.filter((x) => x.id === h.bankId)[0];
      return b && !b.deletedAt;
    });
    return {
      banks: live.slice().sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))),
      bankCnt: live.length,
      total: live.reduce((s, h) => s + h.total, 0),
    };
  }

  function hardMap() {
    const idx = readIndex(K_HARD);
    const map = {};
    for (const h of idx) {
      const list = readHard(h.bankId);
      map[h.bankId] = list.map((x) => x.qid);
    }
    return { map, total: hardOverview().total };
  }

  function listHard(opts) {
    const o = opts || {};
    const list = readHard(o.bankId);
    return {
      bankId: o.bankId || '',
      bankName: (readIndex(K_BANKS).filter((b) => b.id === o.bankId)[0] || {}).name || '',
      items: list.map((x) => Object.assign({}, x, { options: (x.options || []).map((t, i) => ({ label: String.fromCharCode(65 + i), text: t })) })),
    };
  }

  function addHard(entry) {
    if (!entry || !entry.bankId) throw UserError('缺少题库');
    const bank = getBank(entry.bankId);
    if (!bank) throw UserError('题库不存在或已被删除，无法归集');
    const list = readHard(entry.bankId);
    const i = list.findIndex((x) => x.qid === entry.qid);
    if (i >= 0) list[i] = Object.assign({}, list[i], entry);
    else list.push(Object.assign({ createdAt: clock.now() }, entry));
    writeHard(entry.bankId, list);
    return { hard: true, count: readHard(entry.bankId).length };
  }

  function removeHard(opts) {
    const o = opts || {};
    if (o.bankId) {
      if (o.all) {
        const n = readHard(o.bankId).length;
        writeHard(o.bankId, []);
        return { removed: n };
      }
      const list = readHard(o.bankId);
      const before = list.length;
      const kept = list.filter((x) => (o.qid !== undefined ? x.qid !== o.qid : true) && (o.hid !== undefined ? x.hid !== o.hid : true));
      writeHard(o.bankId, kept);
      return { removed: before - kept.length };
    }
    return { removed: 0 };
  }

  // ---------------------------------------------------------------- 记录
  /** 做题记录：按题库聚合（口径见 core/stats.js）。 */
  function practiceRecords() {
    const sessions = readIndex(K_SESS).filter((s) => s.status === 'submitted' || s.status === 'abandoned');
    const banks = readIndex(K_BANKS);
    const agg = {};
    for (const s of sessions) {
      const items = getSessionItems(s.id);
      if (!items.length) continue;
      const g = stats.gradeSession({ mode: s.mode, total: items.length }, items.map((it) => ({
        qtype: it.qtype, score: it.score, chosen: it.chosen || [], answer_disp: it.answer_disp,
      })));
      if (!g.done_cnt) continue;
      const a = agg[s.bankId] || (agg[s.bankId] = {
        bank_id: s.bankId, bank_name: s.bankName, right: 0, wrong: 0, missing: 0, done_cnt: 0, session_cnt: 0, last_at: '',
      });
      a.right += g.right;
      a.wrong += g.wrong;
      a.missing += g.missing;
      a.done_cnt += g.done_cnt;
      a.session_cnt += 1;
      const at = s.submittedAt || s.startedAt || '';
      if (at > a.last_at) a.last_at = at;
    }
    const rows = Object.keys(agg).map((k) => agg[k]);
    return stats.practiceRecords(rows, banks.filter((b) => !b.deletedAt).length);
  }

  /** 考试记录：只含已交卷的正式考试。 */
  function examRecords(opts) {
    const o = opts || {};
    const size = Math.min(200, Math.max(5, o.size || 50));
    const page = Math.max(1, o.page || 1);
    const rows = readIndex(K_SESS)
      .filter((s) => s.mode === 'exam' && s.status === 'submitted')
      .sort((a, b) => String(b.submittedAt || b.startedAt).localeCompare(String(a.submittedAt || a.startedAt)))
      .slice((page - 1) * size, (page - 1) * size + size)
      .map((s) => ({
        session_id: s.id,
        bank_name: s.bankName,
        candidate: s.candidate || '',
        total: s.total || 0,
        right: s.right || 0,
        wrong: s.wrong || 0,
        missing: s.missing || 0,
        score: s.score || 0,
        score_total: s.scoreTotal || 0,
        score_per_q: 0,
        started_at: s.startedAt || '',
        submitted_at: s.submittedAt || '',
        duration_sec: s.durationSec || 0,
      }));
    return stats.examRecords(rows, page, size);
  }

  // ---------------------------------------------------------------- 建卷 / 作答 / 交卷
  function poolsFromQuestions(qs) {
    const pools = { single: [], multi: [], judge: [] };
    for (const q of qs || []) (pools[q.qtype] || (pools[q.qtype] = [])).push(q);
    return pools;
  }

  /** 已用秒数（页面进来时算一次，避免多次取值不一致） */
  function durationSec(startedAt) {
    const s = String(startedAt || '');
    const t = Date.parse(s.replace(' ', 'T'));
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.round((Date.now() - t) / 1000));
  }

  /**
   * 建卷：抽题 -> 算定展示顺序与 answer_disp -> 落盘。
   * 正式考试/模拟考试强制校验考生信息（与桌面版一致）。
   */
  function createPaper(input) {
    const st = settings.normalizeSettings(input.settings || {});
    const bank = getBank(st.bank_id);
    if (!bank) throw UserError('题库不存在或已被删除');
    const source = (input.settings && input.settings.source) === 'hard' ? 'hard' : 'bank';
    // 重难错题作题源时，从 hard 快照里取题
    const qs = source === 'hard' ? readHard(st.bank_id) : getBankQuestions(st.bank_id);
    const picked = paper.selectQuestions(st, poolsFromQuestions(qs));
    if (!picked.length) {
      throw UserError(source === 'hard' ? '重难错题里还没有可练习的题目' : '按当前设置没有抽到任何题目，请调整题型或数量');
    }
    const items = paper.buildItems(st, picked);
    const mode = input.mode || 'practice';
    const candidate = String(input.candidate || '').trim();
    if (mode === 'exam' || mode === 'mock') {
      if (!candidate) throw UserError('请填写考生信息');
      if (candidate.length > 50) throw UserError('考生信息不能超过 50 个字符');
    }
    const session = {
      id: newId('s', clock, rng),
      bankId: st.bank_id,
      bankName: bank.name,
      mode,
      candidate,
      startedAt: clock.now(),
      status: 'ongoing',
      settings: st,
      total: items.length,
      scoreTotal: paper.scoreTotalOf(items),
      source,
    };
    putSession(session, items);
    return { sessionId: session.id, total: items.length, scoreTotal: session.scoreTotal, mode, bankName: bank.name };
  }

  /** 读一题（含当前作答），供答题页渲染。 */
  function getPaperState(id, pos) {
    const head = getSession(id);
    if (!head) throw UserError('会话不存在');
    const items = getSessionItems(id);
    const ans = getAns(id) || {};
    const list = items.map((it) => Object.assign({}, it, { chosen: ans[it.pos] || [] }));
    const total = list.length;
    const p = Math.min(Math.max(1, pos || 1), total);
    const marked = list.filter((x) => x.marked).length;
    const done = list.filter((x) => (x.chosen && x.chosen.length) || x.is_correct !== null && x.is_correct !== undefined).length;
    return {
      session: {
        id: head.id, mode: head.mode, bankName: head.bankName, candidate: head.candidate || '',
        status: head.status, total, scoreTotal: head.scoreTotal || 0, startedAt: head.startedAt, source: head.source || 'bank',
      },
      item: list[p - 1] || null,
      pos: p,
      doneCnt: done,
      markedCnt: marked,
      answers: ans,
      // 答题卡：按题型分组 + 每题状态（未答/已答/标记）
      sheet: grading.QTYPES.map((t) => ({
        qtype: t,
        label: grading.QTYPE_LABEL[t],
        items: list.filter((x) => x.qtype === t).map((x) => ({
          pos: x.pos,
          done: !!(x.chosen && x.chosen.length),
          marked: !!x.marked,
        })),
      })).filter((g) => g.items.length),
    };
  }

  /**
   * 作答：只写增量。练习模式同时返回判分结果（页面立即显示对/错与正确答案）。
   */
  function saveAnswer(id, pos, chosen) {
    const head = getSession(id);
    if (!head) throw UserError('会话不存在');
    if (head.status !== 'ongoing') throw UserError('本次做题已结束，不能继续作答');
    const ans = getAns(id) || {};
    const c = (chosen || []).slice();
    if (!c.length) delete ans[pos];
    else ans[pos] = c;
    putAns(id, ans);

    let feedback = null;
    if (head.mode === 'practice' && c.length) {
      const it = getSessionItems(id).filter((x) => x.pos === pos)[0];
      if (it) {
        const ok = grading.isCorrect(c, it.answer_disp, it.qtype);
        feedback = {
          pos,
          isCorrect: ok,
          answerText: it.answer_text,
          chosenText: grading.selText(it.qtype, it.options_disp, c),
        };
      }
    }
    return { saved: true, feedback };
  }

  /** 汇总（结果页用）。 */
  function summarizeSession(id) {
    const head = getSession(id);
    if (!head) return null;
    const items = getSessionItems(id);
    return stats.summarize(head, items);
  }

  /**
   * 交卷：合并 ans -> 判定 -> 写回 items -> 更新索引 -> 删 ans。
   * 幂等：已交卷时直接返回汇总。
   */
  function gradeAndSubmit(id) {
    const head = getSession(id);
    if (!head) throw UserError('会话不存在');
    if (head.status === 'submitted') return summarizeSession(id);
    if (head.status === 'abandoned') throw UserError('本次做题已放弃，不能交卷');

    const items = getSessionItems(id);
    const ans = getAns(id) || {};
    const list = items.map((it) => ({
      qtype: it.qtype, score: it.score, chosen: ans[it.pos] || [], answer_disp: it.answer_disp,
    }));
    const g = stats.gradeSession({ mode: head.mode, total: items.length }, list);
    const graded = items.map((it, i) => Object.assign({}, it, {
      chosen: ans[it.pos] || [],
      is_correct: g.is_correct[i],
    }));
    putGradedItems(id, graded);

    const stored = getSession(id) || {};
    const next = Object.assign({}, stored, {
      status: 'submitted',
      submittedAt: clock.now(),
      durationSec: durationSec(head.startedAt),
      score: g.score,
      scoreTotal: g.score_total,
      right: g.right,
      wrong: g.wrong,
      missing: g.missing,
    });
    fs.writeJson('sess/' + id + '/head.json', next);
    upsertSessionIndex({
      id, bankId: next.bankId, bankName: next.bankName, mode: next.mode,
      candidate: next.candidate || '', status: 'submitted', source: next.source || 'bank',
      startedAt: next.startedAt, submittedAt: next.submittedAt, total: items.length,
      score: g.score, scoreTotal: g.score_total, right: g.right, wrong: g.wrong, missing: g.missing,
      durationSec: next.durationSec,
    });
    delAns(id);
    return summarizeSession(id);
  }

  /** 标记（考试/练习都可用）。 */
  function toggleMarkByPos(id, pos, marked) {
    const head = getSession(id);
    if (!head) throw UserError('会话不存在');
    const items = getSessionItems(id);
    const idx = items.findIndex((x) => x.pos === pos);
    if (idx < 0) throw UserError('题目不存在');
    items[idx] = Object.assign({}, items[idx], { marked: !!marked });
    putGradedItems(id, items);
    return { pos, marked: !!marked };
  }

  /**
   * 重难错题：按 pos 归集/取消。快照存**原始选项与原始答案**（与桌面版一致），
   * 打乱只影响当次卷面，不进归集。
   */
  function toggleHardByPos(id, pos, hard) {
    const head = getSession(id);
    if (!head) throw UserError('会话不存在');
    const bank = getBank(head.bankId);
    if (!bank) throw UserError('题库不存在或已被删除，无法归集');
    const it = getSessionItems(id).filter((x) => x.pos === pos)[0];
    if (!it) throw UserError('题目不存在');
    if (!hard) return Object.assign({ hard: false }, removeHard({ bankId: head.bankId, qid: it.qid }));
    // 由展示下标反推原始答案下标
    const order = it.order || [];
    const ansOrig = (it.answer_disp || []).map((d) => (order[d] === undefined ? d : order[d])).sort((a, b) => a - b);
    const r = addHard({
      bankId: head.bankId,
      qid: it.qid,
      qtype: it.qtype,
      stem: it.stem,
      options: it.options || [],
      answer: ansOrig,
      answer_text: grading.answerText(it.qtype, it.options || [], ansOrig),
    });
    return Object.assign({ hard: true }, r);
  }

  /** 结果页数据：汇总 + 错题明细（含未作答） */
  function getResult(id) {
    const s = summarizeSession(id);
    if (!s) return null;
    const items = getSessionItems(id);
    const exam = s.mode === 'exam' || s.mode === 'mock';
    const wrongItems = items
      .filter((it) => it.is_correct !== 1)
      .map((it) => ({
        pos: it.pos,
        qid: it.qid,
        qtype: it.qtype,
        stem: it.stem,
        options: (it.options_disp || []).map((t, i) => ({ label: String.fromCharCode(65 + i), text: t })),
        answer_text: it.answer_text,
        chosen_text: grading.selText(it.qtype, it.options_disp, it.chosen || []),
        missing: !(it.chosen && it.chosen.length),
        exam,
      }));
    return { summary: s, wrongItems };
  }

  /** 该卷里哪些题已被归集（用于渲染勾选状态）。 */
  function hardQidsOfBank(bankId) {
    return readHard(bankId).map((x) => x.qid);
  }

  return {
    SCHEMA,
    init, getEnv,
    listBanks, getBank, createBank, deleteBank, getBankQuestions,
    listSessions, getSessionMeta, putSession, getSession, getSessionItems,
    putAns, getAns, delAns, putGradedItems, removeSession, upsertSessionIndex,
    createPaper, getPaperState, saveAnswer, summarizeSession, gradeAndSubmit, getResult,
    toggleMarkByPos, toggleHardByPos, hardQidsOfBank,
    hardOverview, hardMap, listHard, addHard, removeHard,
    practiceRecords, examRecords,
  };
}

module.exports = { createLocalRepo, nameKey, SCHEMA };

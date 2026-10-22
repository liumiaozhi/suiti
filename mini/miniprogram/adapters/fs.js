// 唯一碰 wx 文件系统的地方：所有大块数据（题库、会话）都落这里，
// 因为 storage 只有 1MB/key、10MB 总量，而文件系统有 200MB。
//
// 原子写：先写 <path>.tmp 再 rename，避免半截 JSON。

const ROOT = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/db';

function fsm() {
  return wx.getFileSystemManager();
}

function abs(path) {
  return ROOT + '/' + String(path).replace(/^\/+/, '');
}

function mkdir(path) {
  const p = abs(path);
  try {
    fsm().mkdirSync(p, true);
  } catch (e) {
    // 已存在时忽略
  }
  return p;
}

function exists(path) {
  try {
    fsm().accessSync(abs(path));
    return true;
  } catch (e) {
    return false;
  }
}

function writeText(path, text) {
  const p = abs(path);
  ensureDirOf(p);
  const tmp = p + '.tmp';
  fsm().writeFileSync(tmp, text, 'utf8');
  commit(tmp, p);
}

function writeBytes(path, buffer) {
  const p = abs(path);
  ensureDirOf(p);
  const tmp = p + '.tmp';
  fsm().writeFileSync(tmp, buffer);
  commit(tmp, p);
}

function commit(tmp, target) {
  try {
    const fs = fsm();
    if (exists(target)) {
      try {
        fs.unlinkSync(target);
      } catch (e) {}
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    // 少数基础库没有 renameSync：退回复制 + 删除
    fsm().copyFileSync(tmp, target);
    try {
      fsm().unlinkSync(tmp);
    } catch (e2) {}
  }
}

function ensureDirOf(p) {
  const i = p.lastIndexOf('/');
  if (i > 0) mkdir(p.slice(0, i).replace(ROOT + '/', ''));
}

function readText(path) {
  return fsm().readFileSync(abs(path), 'utf8');
}

function readBytes(path) {
  return fsm().readFileSync(abs(path));
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function writeJson(path, value) {
  writeText(path, JSON.stringify(value));
}

function unlink(path) {
  try {
    fsm().unlinkSync(abs(path));
    return true;
  } catch (e) {
    return false;
  }
}

function rmdir(path) {
  try {
    fsm().rmdirSync(abs(path), true);
    return true;
  } catch (e) {
    return false;
  }
}

function size(path) {
  try {
    return (fsm().getFileInfoSync ? fsm().getFileInfoSync({ filePath: abs(path) }) : fsm().statSync(abs(path), false)).size || 0;
  } catch (e) {
    return 0;
  }
}

/** 统计目录占用（字节），用于容量看板。 */
function dirSize(path) {
  let total = 0;
  const walk = (p) => {
    let entries = [];
    try {
      const st = fsm().statSync(abs(p), true);
      if (st && st.length) return st.forEach((s) => (total += s.stats ? s.stats.size : 0));
    } catch (e) {
      try {
        entries = fsm().readdirSync(abs(p));
      } catch (e2) {
        return;
      }
      for (const name of entries) walk(p + '/' + name);
    }
  };
  walk(path);
  return total;
}

module.exports = {
  ROOT, abs, mkdir, exists, writeText, writeBytes, readText, readBytes,
  readJson, writeJson, unlink, rmdir, size, dirSize,
};

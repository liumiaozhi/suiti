// 内存版文件系统假实现：路径 -> 字符串，给 Node 单测用。

function createFakeFs() {
  const files = new Map();

  const norm = (p) => String(p || '').replace(/^\/+/, '');

  function mkdir(path) {
    return norm(path);
  }

  function exists(path) {
    return files.has(norm(path));
  }

  function writeText(path, text) {
    files.set(norm(path), String(text));
  }

  function readText(path) {
    const p = norm(path);
    if (!files.has(p)) {
      const e = new Error('readFileSync:fail no such file ' + p);
      e.errMsg = 'readFileSync:fail no such file';
      throw e;
    }
    return files.get(p);
  }

  function writeJson(path, value) {
    writeText(path, JSON.stringify(value));
  }

  function readJson(path) {
    return JSON.parse(readText(path));
  }

  function writeBytes(path, buffer) {
    files.set(norm(path), buffer);
  }

  function readBytes(path) {
    return files.get(norm(path));
  }

  function unlink(path) {
    return files.delete(norm(path));
  }

  function rmdir(path) {
    const p = norm(path);
    let n = 0;
    Array.from(files.keys()).forEach((k) => {
      if (k === p || k.indexOf(p + '/') === 0) {
        files.delete(k);
        n += 1;
      }
    });
    return true;
  }

  function size(path) {
    const v = files.get(norm(path));
    if (v === undefined) return 0;
    return typeof v === 'string' ? v.length : (v.byteLength || 0);
  }

  function dirSize(path) {
    const p = norm(path);
    let n = 0;
    files.forEach((v, k) => {
      if (!p || k.indexOf(p) === 0) n += typeof v === 'string' ? v.length : (v.byteLength || 0);
    });
    return n;
  }

  return {
    ROOT: '/db', abs: (p) => '/db/' + norm(p),
    mkdir, exists, writeText, writeBytes, readText, readBytes,
    readJson, writeJson, unlink, rmdir, size, dirSize, _files: files,
  };
}

module.exports = { createFakeFs };

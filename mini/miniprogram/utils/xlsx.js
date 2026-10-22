// 内置 SheetJS（UMD 社区版 xlsx.full.min.js，放在 vendor/ 下直接 require，无需 npm 构建）。
// 该构建不含对 process/global 的裸引用，可在微信小程序环境直接加载。
// 读写均使用 type:'array'（ArrayBuffer），避免依赖 Buffer / TextDecoder。

const XLSX = require('../vendor/xlsx.full.min.js');

/**
 * 读取 Excel 的 ArrayBuffer -> 首个 sheet 的二维数组（header:1，每行是原始单元格数组）。
 * @param {ArrayBuffer} data
 * @returns {Array<Array>}
 */
/**
 * 把 ArrayBuffer / Uint8Array 转成「二进制字符串」（每个字符的 charCode = 一个字节）。
 * 这是 SheetJS 在受限环境（微信小程序没有稳定 atob/Buffer）下最可靠的输入形态，
 * 配合 type:'binary' 直接按字符码解析，不依赖任何宿主 API。
 */
function toBinaryString(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return s;
}

/**
 * 读取 Excel 的 ArrayBuffer -> 首个 sheet 的二维数组（header:1，每行是原始单元格数组）。
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Array<Array>}
 */
function readFirstSheet(data) {
  const bin = toBinaryString(data);
  const wb = XLSX.read(bin, { type: 'binary' });
  const name = wb.SheetNames[0];
  const ws = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(ws, { header: 1 });
}

/**
 * 多 sheet 行数据 -> 写回 xlsx 的 ArrayBuffer。
 * @param {Array<{name?:string, rows:Array<Array>}>} sheets
 * @returns {ArrayBuffer}
 */
function writeSheets(sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name || 'Sheet1');
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

module.exports = { XLSX, readFirstSheet, writeSheets };

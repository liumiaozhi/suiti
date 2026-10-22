#!/usr/bin/env node
/**
 * 包体积预算守卫。
 *
 * 微信小程序的硬限制：主包 ≤ 2MB、单个分包 ≤ 2MB、总体 ≤ 20MB。
 * 这里按 1.6MB 设阈值（留 0.4MB 余量给构建期注入），超了直接退出码 1，
 * 让它能挂进 CI / 提交前检查。
 *
 * 用法： node tools/size-budget.mjs [--root <miniprogram 目录>] [--budget 1.6]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const ROOT = path.resolve(getArg('--root', 'miniprogram'));
const BUDGET_MB = Number(getArg('--budget', '1.6'));
const HARD_MB = 2;
const TOTAL_HARD_MB = 20;

/** 递归收集文件（跳过隐藏目录与 node_modules） */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT).map((p) => ({
  p,
  rel: path.relative(ROOT, p).split(path.sep).join('/'),
  size: fs.statSync(p).size,
}));

// 分包目录：miniprogram/ 下以 pkg- 开头的顶层目录
const pkgRoots = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('pkg-'))
  .map((e) => e.name);

const bucket = { main: 0 };
for (const name of pkgRoots) bucket[name] = 0;

for (const f of files) {
  const top = f.rel.split('/')[0];
  if (pkgRoots.includes(top)) bucket[top] += f.size;
  else bucket.main += f.size;
}

const KB = (b) => (b / 1024).toFixed(1);
const MB = (b) => (b / 1024 / 1024).toFixed(2);

console.log(`根目录：${ROOT}`);
console.log(`分包：${pkgRoots.length ? pkgRoots.join(', ') : '（无）'}\n`);

let failed = 0;
const total = Object.values(bucket).reduce((a, b) => a + b, 0);

for (const [name, size] of Object.entries(bucket)) {
  const mb = size / 1024 / 1024;
  const over = mb > BUDGET_MB;
  const hard = mb > HARD_MB;
  if (over) failed++;
  const flag = hard ? '超硬限!' : over ? '超预算!' : 'OK';
  console.log(
    `  ${name.padEnd(16)} ${KB(size).padStart(9)} KB  ${MB(size).padStart(6)} MB  ${flag}`
  );
}

console.log(`\n  合计               ${KB(total).padStart(9)} KB  ${MB(total).padStart(6)} MB`);

// 最大的 5 个文件，便于定位体积来源
console.log('\n最大的文件：');
files
  .sort((a, b) => b.size - a.size)
  .slice(0, 5)
  .forEach((f) => console.log(`  ${KB(f.size).padStart(9)} KB  ${f.rel}`));

if (total / 1024 / 1024 > TOTAL_HARD_MB) {
  console.log(`\n总体积超过 ${TOTAL_HARD_MB}MB 硬限`);
  failed++;
}
if (failed) {
  console.log(`\n[FAIL] ${failed} 个包超过 ${BUDGET_MB}MB 预算`);
  process.exit(1);
}
console.log(`\n[PASS] 所有包都在 ${BUDGET_MB}MB 预算内`);

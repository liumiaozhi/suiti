#!/usr/bin/env node
/**
 * 工程结构自检（不依赖开发者工具）。
 *
 * 检查项：
 *  1. 所有 .json 能被解析；
 *  2. app.json 里声明的每个页面都存在 .js / .wxml（.json/.wxss 可选）；
 *  3. 分包的 root 目录存在，页面路径拼接正确；
 *  4. tabBar 的 pagePath 都在 pages 里；
 *  5. project.config.json 的 miniprogramRoot 指向存在的目录；
 *  6. app.json 的 pages 里没有重复项。
 *
 * 用法： node tools/check-structure.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const MP = path.join(CWD, 'miniprogram');
const errors = [];
const warnings = [];
let checks = 0;

const ok = (cond, msg) => {
  checks++;
  if (!cond) errors.push(msg);
};

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    errors.push(`JSON 解析失败：${p} -> ${e.message}`);
    checks++;
    return null;
  }
}

// 1. 所有 json
function walkJson(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJson(p);
    else if (ent.name.endsWith('.json')) {
      readJson(p);
      checks++;
    }
  }
}
ok(fs.existsSync(MP), `miniprogram 目录不存在：${MP}`);
if (fs.existsSync(MP)) walkJson(MP);

// 5. project.config.json
const pc = readJson(path.join(CWD, 'project.config.json'));
if (pc) {
  ok(pc.miniprogramRoot === 'miniprogram/', `miniprogramRoot 应为 "miniprogram/"，实际 ${pc.miniprogramRoot}`);
  ok(fs.existsSync(path.join(CWD, pc.miniprogramRoot)), `miniprogramRoot 指向的目录不存在`);
  ok(typeof pc.appid === 'string' && pc.appid.length > 0, 'appid 为空');
}

// 2/3/4/6. app.json 页面完整性
const app = readJson(path.join(MP, 'app.json'));
if (app) {
  const pages = app.pages || [];
  ok(pages.length > 0, 'app.json pages 为空');
  ok(new Set(pages).size === pages.length, 'app.json pages 有重复项');

  const needFile = (p, ext) => fs.existsSync(path.join(MP, p + ext));
  for (const p of pages) {
    ok(needFile(p, '.js'), `页面缺少 js：${p}.js`);
    ok(needFile(p, '.wxml'), `页面缺少 wxml：${p}.wxml`);
  }

  for (const sp of app.subPackages || []) {
    const root = sp.root;
    ok(fs.existsSync(path.join(MP, root)), `分包 root 不存在：${root}`);
    ok(Array.isArray(sp.pages) && sp.pages.length > 0, `分包 ${root} 没有页面`);
    for (const p of sp.pages || []) {
      const full = `${root}/${p}`;
      ok(needFile(full, '.js'), `分包页缺少 js：${full}.js`);
      ok(needFile(full, '.wxml'), `分包页缺少 wxml：${full}.wxml`);
    }
  }

  for (const item of (app.tabBar && app.tabBar.list) || []) {
    ok(pages.includes(item.pagePath), `tabBar 指向未声明页面：${item.pagePath}`);
    if (!item.iconPath) warnings.push(`tabBar「${item.text}」无图标（纯文字，允许）`);
  }
}

// 7. 每个页面是否都有 json（标题），缺了只是 warning
for (const p of (app && app.pages) || []) {
  if (!fs.existsSync(path.join(MP, p + '.json'))) warnings.push(`页面无独立 json（用全局标题）：${p}`);
}

// 8. 相对 require 路径必须真实存在（曾因少写一层 ../ 导致三个页面全白）
function walkJs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function resolveRequire(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  // 微信的 require **不做目录索引解析**：require('x/repo') 只找 x/repo.js，
  // 不会回退到 x/repo/index.js（Node 会）。所以命中目录时直接判错。
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) return 'DIR';
  for (const cand of [base, base + '.js']) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

if (fs.existsSync(MP)) {
  for (const file of walkJs(MP)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const hit = resolveRequire(file, m[1]);
      checks++;
      if (hit === 'DIR') {
        errors.push(
          `require 指向目录（微信不会回退到 index.js）：${path.relative(MP, file)} -> ${m[1]}，请写成 ${m[1]}/index`
        );
      } else if (!hit) {
        errors.push(`require 路径不存在：${path.relative(MP, file)} -> ${m[1]}`);
      }
    }
  }

  // 9. WXML 标签配平（曾因多一个 </view> 导致编译失败、页面全白）
  function walkWxml(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walkWxml(p, out);
      else if (ent.name.endsWith('.wxml')) out.push(p);
    }
    return out;
  }
  for (const f of walkWxml(MP)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const tag of ['view', 'block', 'text', 'button', 'scroll-view']) {
      const open = (src.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
      const selfClose = (src.match(new RegExp('<' + tag + '\\b[^<>]*/>', 'g')) || []).length;
      const close = (src.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      checks++;
      if (open - selfClose !== close) {
        errors.push(
          `WXML 标签不配平：${path.relative(MP, f)} <${tag}> 开=${open} 自闭=${selfClose} 闭=${close}`
        );
      }
    }

    // 10. mustache 里不许调方法（WXML 不支持，会静默不生效 —— 曾导致多选题选中态渲染不出来）
    const mustache = src.match(/\{\{[^}]*\}\}/g) || [];
    for (const expr of mustache) {
      const call = expr.match(/[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*\s*\(/);
      checks++;
      if (call) {
        errors.push(
          `WXML mustache 调用了方法（微信不执行，会静默失效）：${path.relative(MP, f)} -> ${expr.trim()}`
        );
      }
    }
  }
}

console.log(`检查项：${checks} 条`);
if (warnings.length) {
  console.log('\n提示：');
  warnings.forEach((w) => console.log('  - ' + w));
}
if (errors.length) {
  console.log(`\n[FAIL] ${errors.length} 个问题：`);
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
}
console.log('\n[PASS] 工程结构自检通过');

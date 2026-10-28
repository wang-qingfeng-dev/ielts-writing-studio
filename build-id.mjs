import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 版本号只覆盖“发版”，代码热改后版本号不会变；启动脚本拿这个指纹比对，
// 页面才不会连着上一个进程里跑着的旧代码（改了没生效，用户看起来就像没修）。
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT_FILE = /\.(mjs|json|cmd|ps1|command)$/u;
const ASSET_FILE = /\.(mjs|js|css|html|svg|json|ico)$/u;

function collect() {
  const files = [];
  // 只算真正参与运行的代码：根目录的脚本 + public 下的页面资源。
  // 不递归根目录，避免把临时目录、构建产物、示例副本算进来。
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && ROOT_FILE.test(entry.name)) files.push(entry.name);
  }
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) { walk(path.join(dir, entry.name), relative); continue; }
      if (ASSET_FILE.test(entry.name)) files.push(relative);
    }
  };
  try { walk(path.join(ROOT, 'public'), 'public'); } catch { /* 没有 public 目录时只算脚本。 */ }
  return files.sort();
}

let cached = '';

// 用内容哈希而不是时间戳：复制到新目录后时间会变，内容没变就不该重启。
export function buildId() {
  if (cached) return cached;
  const hash = createHash('sha256');
  for (const file of collect()) {
    hash.update(file);
    hash.update('\0');
    try { hash.update(readFileSync(path.join(ROOT, file))); } catch { hash.update('missing'); }
    hash.update('\0');
  }
  cached = hash.digest('hex').slice(0, 12);
  return cached;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${buildId()}\n`);
}

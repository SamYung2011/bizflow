// 正门对调整站拼装:一次 npm run build 产出完整 dist/
//
//   dist/                    ← root-site/(新任务平台,纯静态,原样拷入站根)
//   dist/task-platform/      ← 老 bizflow(vite build, base=/task-platform/)
//   dist/task-platform/team/ ← team 子应用副本(vite build, base=/task-platform/team/)
//
// team.honnmono.top 是独立 Vercel 项目,不受本仓构建影响;这里的 team 副本
// 只是让旧入口 /task-platform/ 下有一套完整的旧世界。
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repoRoot, "dist");

function run(cmd, cwd, extraEnv = {}) {
  console.log(`\n[front-door] $ ${cmd}  (cwd: ${cwd.replace(repoRoot, ".")})`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\n[front-door] 拼装自检失败: ${msg}`);
    process.exit(1);
  }
}

rmSync(dist, { recursive: true, force: true });

// 1. 老 bizflow → dist/task-platform(base/outDir 在 vite.config.js)
run("npx vite build", repoRoot);

// 2. team 子应用副本 → dist/task-platform/team
const teamDir = join(repoRoot, "team");
if (!existsSync(join(teamDir, "node_modules"))) run("npm ci", teamDir);
run("npx vite build --base=/task-platform/team/ --outDir dist-swap", teamDir, {
  // 副本挂在旧入口下,「返回 bizflow 主端」应回 /task-platform/ 而非站根
  VITE_BIZFLOW_URL: "../",
});
cpSync(join(teamDir, "dist-swap"), join(dist, "task-platform", "team"), { recursive: true });

// 3. 新任务平台(root-site/)→ 站根；生产 HTML 只引用内容指纹 bundle，源码目录仍供本地开发。
run("node scripts/build-root-site.mjs --outdir dist", repoRoot);

// 4. 自检:关键入口都在、asset 前缀正确
const checks = [
  "index.html",
  "login/index.html",
  "bizflow/home.html",
  "whatsapp-extension-cloud.zip",
  "task-platform/index.html",
  "task-platform/team/index.html",
];
for (const rel of checks) assert(existsSync(join(dist, rel)), `缺 dist/${rel}`);
assert(
  readFileSync(join(dist, "task-platform/index.html"), "utf8").includes("/task-platform/assets/"),
  "老 bizflow index.html 未带 /task-platform/ base"
);
assert(
  readFileSync(join(dist, "task-platform/team/index.html"), "utf8").includes("/task-platform/team/assets/"),
  "team 副本 index.html 未带 /task-platform/team/ base"
);
console.log("\n[front-door] 拼装完成:站根=新任务平台 /task-platform/=老 bizflow /task-platform/team/=team 副本");

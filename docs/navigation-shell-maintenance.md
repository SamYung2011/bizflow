# 导航与 Shell 维护约定

MENU-unify-1 收口后的原则是：菜单、用户面板各自只有一个手写源，静态演示 bundle 是生成物。

## 菜单唯一手写源

`root-site/components/navigation-registry.js` 是 BizFlow 与 Team 导航项目的唯一手写源。新增、删除或调整菜单时，只在这里维护：

- `id`
- `labelKey`
- `icon`
- `canonicalHref`
- `unreadKey`（需要红点时）
- `adminOnly`（仅管理员入口）

`navigation-registry.js` 的 `createSectionMenu()` 统一完成菜单字段投影与 active 状态；`root-site/components/bizflow-menu.js` 只传入 BizFlow 相对 URL 适配器，`root-site/spa/route-menu.js` 只选择当前 route/section 并生成 loading frame。两个 adapter 都不得再声明本地菜单数组或复制字段投影。

修改后运行：

```bash
node scripts/test-menu-registry.mjs
node scripts/test-spa-p1.mjs
```

## 首屏占位策略

Shell 启动阶段保留 topbar 操作位，并用 `shell-boot__fab` 明确占住侧栏快速新增按钮的位置。这里选择视觉 skeleton，不改认证初始化或渲染时序；它只覆盖认证网络返回前的空位，避免引入 auth 生命周期风险。

## 用户面板唯一手写源

`root-site/components/menus.js` 是语言菜单、用户面板模板及其交互的唯一手写源；相关视觉只维护 `root-site/components/menus.css`。不要在 shell bundle 或其它页面复制 profile、join、password、logout 模板。

修改后运行：

```bash
node scripts/test-shell-menus.mjs
node scripts/test-ava-align-1.mjs
node scripts/test-ui-unify-1.mjs
```

## Shell bundle 是受控生成物

`root-site/shell/shell.bundle.js` 由 `root-site/shell/shell.js` 生成，禁止手改。桌面与移动演示页都只加载这一份 classic bundle。`root-site/` 源码页继续直接加载 ESM 供开发；正式 `dist/` 则由 `scripts/build-root-site.mjs` 原子合成内容指纹 bundle，见 `docs/root-site-production-build.md`。

功能契约应读取或执行真实源文件，不要再解析 bundle 复测同一行为；bundle 与真实源的一致性统一由逐字节校验负责。

```bash
npm run build:shell
npm run check:shell
```

`npm run build` 会先自动执行 `build:shell`。提交前还应运行 `node scripts/test-shell-bundle.mjs`；它用固定的 `esbuild@0.21.5` 做逐字节校验。

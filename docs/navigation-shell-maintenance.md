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

`root-site/components/bizflow-menu.js` 只把 canonical URL 适配成 BizFlow 页面需要的相对 URL；`root-site/spa/route-menu.js` 只生成 SPA 的绝对 URL、active 状态与 loading frame。两个 adapter 都不得再声明本地菜单数组。

修改后运行：

```bash
node scripts/test-menu-registry.mjs
node scripts/test-spa-p1.mjs
```

## 用户面板唯一手写源

`root-site/components/menus.js` 是语言菜单、用户面板模板及其交互的唯一手写源；相关视觉只维护 `root-site/components/menus.css`。不要在 shell bundle 或其它页面复制 profile、join、password、logout 模板。

修改后运行：

```bash
node scripts/test-shell-menus.mjs
node scripts/test-ava-align-1.mjs
node scripts/test-ui-unify-1.mjs
```

## Shell bundle 是受控生成物

`root-site/shell/shell.bundle.js` 由 `root-site/shell/shell.js` 生成，禁止手改。桌面与移动演示页都只加载这一份 classic bundle；正式 SPA 继续使用 ESM，加载链不变。

功能契约应读取或执行真实源文件，不要再解析 bundle 复测同一行为；bundle 与真实源的一致性统一由逐字节校验负责。

```bash
npm run build:shell
npm run check:shell
```

`npm run build` 会先自动执行 `build:shell`。提交前还应运行 `node scripts/test-shell-bundle.mjs`；它用固定的 `esbuild@0.21.5` 做逐字节校验。

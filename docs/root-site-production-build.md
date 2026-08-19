# Root-site 生产指纹构建

`root-site/` 是可直接调试的源码站，HTML 继续引用 `spa/entry.js`、各页源码模块和现有 modulepreload。开发时无需先构建：

```bash
python3 -m http.server 4173 --directory root-site
```

然后打开 `http://127.0.0.1:4173/bizflow/home.html`。不要把生产 hash 回写进 `root-site/`，否则源码模式会失效。

生产交付执行：

```bash
npm run build
```

`scripts/build-root-site.mjs` 会把 SPA 的 17 个路由原子合成一个压缩 ESM 文件，并单独合成登录模块，输出到 `dist/assets/root/{spa,login}-<content-hash>.js`。随后只改写 `dist/` 内的 HTML：业务页全部引用当前 SPA hash，登录页引用当前 login hash；源码 HTML 不变。生成目录禁止手改。

这里刻意不拆跨版本 chunk：一份 SPA HTML 只认一份完整的内容地址，避免部署切换时新入口与旧子模块混搭。代价是首次拿完整 SPA 包，收益是首屏仅 1 个模块请求，之后 17 个 SPA 路由切换不再产生 JS 模块请求；文件内容未变时文件名和字节保持一致。

缓存边界：普通 HTML、CSS、源码兼容路径继续 `public, max-age=0, must-revalidate`；只有 `/assets/root/*` 的纯 hash 产物使用 `public, max-age=31536000, immutable`。不要把 `stale-while-revalidate` 加回普通 JS/HTML。部署后由审查方用 `curl -I` 分别核对一个 HTML 和当前 hash bundle 的响应头。

# APP 客服工作台（2026-09-17）

本单为前端及假数据演示。页面遵照 `honnmono_app_v2/docs/03-人工客服接口文档_2026-09-17.md` §4.3；后台与 Edge 桥未改、未部署。

## 本地启动

```sh
cd /Users/helen/claude_demo/.worktrees/bizflow-app-support-ui-0917
npm ci # 已有 node_modules 时不用重装
VITE_SUPPORT_MOCK=1 npm run dev -- --host 127.0.0.1 --port 5178
```

无需登录、仅开发服务器可用的演示入口：
`http://127.0.0.1:5178/task-platform/scripts/support-preview/index.html`

正式 React 页面：`/task-platform/?view=appSupport`，沿用登录、`isBfAdmin`、AppContext employees；Honnmono APP 组内位于 AppFeedback 旁。根站菜单 `app-support` 也到此入口。演示入口没有加入生产构建，不改变正式权限。

- `VITE_SUPPORT_MOCK=1`：动态导入 supportMock，内存保存，刷新还原 5 条会话。列表 10 秒、当前会话 3 秒仍由同一套 React Query 驱动。
- 未设或 `VITE_SUPPORT_MOCK=0`：全走 supportApi → callHonnmonoAdmin → `/support/*`。需要既有 Supabase Vite 环境变量与登录会话，待另一单桥和后台上线后联调。
- 演示按钮 `Fail next send`：下一次发送失败；点红色重试用原 clientMsgId 重发。
- `Slow responses`：读请求和发送延迟 8 秒，方便看骨架屏/发送中；再点恢复。
- `Incoming → Daniel`：给 Daniel 加一条使用者消息；打开 Daniel、滚到上方，等 3 秒看到新消息按钮。
- `Narrow / desktop`：将页面容器切到 390px，检查单栏与返回按钮。右上可切中/英/法。
- 也可发送 `/fail`，同一消息首次失败，重试成功。员工不会录制或发送 voice 类型；普通音频文件可作为 file 附件。

## 页面及数据分工

AppSupport 只组合列表、顶栏、消息流和输入框。useSupportData 统一轮询、增量合并、历史分页、乐观消息和重试；supportApi 是唯一产品请求入口。supportMock 只在开关为 1 时加载，提供同名/同形 API。

`callHonnmonoAdmin` 仅在浏览器助手增加可选 JSON body、AbortSignal 和 blob 响应，原调用不变。未修改 `supabase/functions/honnmono-admin`。

业务会话/消息字段用契约的驼峰名。用户信息按 `userNickname/userPhone/userEmail`；员工名由传入的 AppContext employees 邮箱匹配。queryKey 按员工邮箱和会话区分，不进入既有 `bf` localStorage 持久化。

## 按文档默认处理的细节

1. 权限只放 `isBfAdmin`；处理中的默认含义为 open 且最后一条不是 user（与 waiting_staff 互补），认领信息独立显示。
2. 使用既有 AppFeedback 的 `#486ee8` 主题色，自写布局、样式、图标和样例插画，无新增组件库/依赖，无 Telegram 代码、CSS、图标或素材。Telegram Web A 登录页无法直接看到聊天，外观参考仅看公开截图与任务列出的要求。
3. 契约提到 8-26 的八类，但未给原稿或具体值；初始集中放 supportConfig：充电、付款退款、订单、帐号登入、设备绑定、发票收据、APP 使用、其他。后续换这一个数组。
4. B1 没有定义响应包装和用户信息字段细节：按 §3 的 `{code,des,result}`、result 数组及用户三字段实现；也接受桥已解包的 result。B1 不支持 category 参数，分类和处理中在已取到的分页内过滤，保留“载入更多”，不伪造后台过滤口。
5. A2 提供 limits，但员工 B1–B7 未定义配置口；先用文档默认 60 秒/20 MB，详情若带 limits 即覆盖，不虚构新增后台接口。员工不录音，60 秒只作为统一配置保留。
6. `/support/upload` 请求默认 `{conversationId,filelist:[{filename,size,mime}]}`，响应复用现成 cloud-storage 的 `{filelist:[{cfid,url,thumbUrl?,cfinfo:{url,method}}]}`。只读现有后台源码确认上传端接收原始文件字节，所以浏览器直接上传 File，聊天只传附件描述。桥/后台将来字段若调整只改 supportApi。
7. 订单契约只给单号、未给 APP 订单目的路由；先跳现有根站订单搜索 `/bizflow/orders.html?q=单号`，该页加一行读取 q。不宣称 mock 单号对应真实订单。
8. 图片先压缩到长边 1600、JPEG 质量 0.8；GIF 保留。缩略优先 thumbUrl，开大图/文件/语音经 B7 鉴权拿 blob，本地 URL 按使用期释放。后台须提供浏览器可读的 thumbUrl（或省略，退回 B7）。
9. 演示姓名/电话/邮箱/单号与用户消息都是假资料；英文消息是数据，不是遗漏翻译。12 秒语音是本地生成的示例提示音，图片是原创 SVG。界面文案用 t，补齐英法；同时覆盖后台简体系统文案。
10. 已有菜单测试还把 AppFeedback 写成管理员专用，和当前 main 已放行主站员工的实现不符；仅将它对齐当前行为，新增 app-support 的管理员断言，未收紧或放宽 AppFeedback 权限。

## 澄川自检

```sh
node scripts/test-support.mjs
node scripts/test-menu-registry.mjs
node scripts/test-order-search-1.mjs
node scripts/test-root-site-app-feedback.mjs
node scripts/test-honnmono-admin-v1.mjs
npm run build
npm run check:shell
git diff --check
```

support 专项 24/24：5 类会话、筛选/手机搜索、历史/增量消息、媒体描述、已读指针、失败重发幂等、认领/释放/分类/结束、合并去重、员工姓名、B1–B7 路径及请求体、非零业务码、上传分步与限制、mock 开关、权限拒绝、78 个界面文案键英法齐全、无中文 JSX 字面文案、新模块均少于 300 行。

浏览器使用独立开发演示、真实 React 组件与原生音频/文件选择器。已核：打开到底、历史插入保持原位置、非底部新消息按钮及点回底部、Enter/Shift+Enter、发后清空并保持输入焦点、多图选择/压缩/缩略图/上传、失败重试、图片大图、语音播放、文件下载、三语切换及 390px 窄屏。运行结果与六张交付截图详见任务目录 DELIVERY.md。

构建已有的 Team 字典重复键、Team 大 chunk 和 Vite CJS 提示属于基线警告。没有把局部前端验证当作真实后台、APP 推送或生产验收。

-- 2026-05-12 把充電樁說明 + 位置注入模板從 edge function 硬編碼移到 wa_settings
-- 讓 bizflow UI 能直接編輯，無需 redeploy
-- 安全規則（SYSTEM_PROMPT_RULES）仍保留硬編碼，不對外暴露

ALTER TABLE wa_settings ADD COLUMN IF NOT EXISTS chargers_prompt TEXT;
ALTER TABLE wa_settings ADD COLUMN IF NOT EXISTS location_hint_prompt TEXT;

-- 寫入默認值（跟之前 edge function 硬編碼一致）
UPDATE wa_settings SET chargers_prompt = $$

充电桩查询服务（你可以主动提供给客户使用）：
- Honnmono 提供香港全港 800+ 个公共充电桩的实时空位查询服务，数据源自香港政府环保署 EV-Charging Easy（实时更新）。
- 如果客户咨询「附近哪里能充电 / 充电站位置 / 哪里有充电桩」之类问题但**没有发送位置消息**，请引导客户：「請發送您的位置（WhatsApp 輸入框旁「+」→ 位置 → 發送當前位置），我即時幫你查附近有空位嘅充電站」。
- 当客户发送位置消息时，系统会自动在你的上下文中注入「附近有空位的充电桩」参考资料。若上下文显示该资料，请按以下规则处理：
  · 客户在咨询充电相关问题（找充电站、问哪里能充电、问续航）→ 按参考资料的格式输出推荐（[1] [2] [3] 方括号编号）
  · 客户在咨询其他事情（配送、上门安装、产品询价等）→ **不要主动甩充电桩列表**，按其原问题回复，把位置当作配送/安装地址处理。
  · 客户冷启动只发了位置没说话 → 简短确认收到，温和询问需要查充电桩还是有其他需求。$$
WHERE id = 1 AND chargers_prompt IS NULL;

UPDATE wa_settings SET location_hint_prompt = $$⚠️ 最高優先級實時數據（剛剛通過 EPD 香港政府實時 API 查詢）⚠️
**重要：如果你在對話歷史中對該客戶說過「Honnmono 暫時未有資料庫」、「未能查詢」、「建議用 Google Maps」之類的話，那是錯誤回答。請以下面數據為準，不要再說「沒有」「未能查詢」之類的話。**

【系统参考资料：{LOCATION_DESC}。我已查询 EPD 实时数据，{STATIONS_OR_EMPTY}

判断准则：
- 如果客户在咨询充电相关问题（找充电站、问哪里能充电、问续航）→ 推荐上面 5 个站，严格按上面给出的格式输出（用 [1] [2] [3] 方括号编号，描述行缩进两个空格），**不要改成 1. 2. 3. 这种行首数字加点的格式**（WhatsApp 会把它当 markdown 列表自动重新编号导致显示混乱）。导航链接（https://maps.google.com/maps?daddr=...）必须完整保留每一条，让客户能直接点击跳转 Google Maps 导航。
- 如果客户在咨询其他事情（配送、上门安装、产品、价格等）→ **不要主动甩充电桩列表**，按其原问题回复即可
- 如果客户只是冷启动发了位置没说话 → 简短确认收到位置，温和提问客户需要查充电桩还是问其他事情】

占位符說明（代碼運行時自動替換，請保留）：
{LOCATION_DESC} = 客户发送了位置 lat=22.28200, lng=114.15880（地點名）
{STATIONS_OR_EMPTY} = 距离最近且有空位的充电桩如下，供你判断如何回复：\n\n[1] ...\n[2] ...\n... 或「附近暂时找不到有空位的充电桩」$$
WHERE id = 1 AND location_hint_prompt IS NULL;

# track-shipments 部署清单

## 老板要做的事（拿到顺丰凭证）

1. 登 https://open.sf-express.com 完成 ISV 开发对接注册（已选）
2. 通过审核后会拿到：
   - **partnerID**（合作伙伴编码，~10 位字符串）
   - **checkword**（校验码，用于 MD5 签名）
3. 沙箱接口：先用 `https://sbox-bsp-oisp.sf-express.com/std/service` 测通
4. 上线切到 `https://bsp-oisp.sf-express.com/std/service`

把上述 3 个值发给煊煊即可，下面的活煊煊干。

---

## 煊煊要做的事（拿到凭证后）

### Step 1：跑 migration 019

Supabase Studio SQL Editor → 整段粘贴 `migrations/019_shipment_tracking.sql` → Run。
跑完用文件末尾的 3 条验收 SQL 检查。

### Step 2：部署 Edge Function 到自托管 Supabase

```bash
# 上传文件
scp -r bizflow_lazy/supabase/functions/track-shipments \
  ecs-user@47.242.242.233:/mnt/data/bizflow/supabase/volumes/functions/

# 重启 Edge Functions 容器
ssh ecs-user@47.242.242.233 \
  'cd /mnt/data/bizflow/supabase && \
   sudo docker compose -f docker-compose.yml -f docker-compose.pg17.yml restart functions'
```

### Step 3：配环境变量

SSH 到阿里云，编辑 `.env`：

```bash
ssh ecs-user@47.242.242.233
sudo nano /mnt/data/bizflow/supabase/docker/.env
```

加 3 行（注意顶住老板给的实际值）：

```
SF_PARTNER_ID=老板给的 partnerID
SF_CHECKWORD=老板给的 checkword
SF_API_ENDPOINT=https://sbox-bsp-oisp.sf-express.com/std/service
```

测通后切生产：`SF_API_ENDPOINT=https://bsp-oisp.sf-express.com/std/service`

重启一次 functions 容器让 env 生效。

### Step 4：拿一个真实顺丰单号手动测

```bash
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"invoice_id": 1234}' \
  https://bizflow.honnmono.top/functions/v1/track-shipments
```

期望返回 `{ok:true, processed:1, updated:1, errors:0, skipped:0}`，
然后查 invoices 看 shipping_status / 查 shipment_events 看轨迹。

### Step 5：注册 pg_cron job（每 6 小时跑一次）

Supabase SQL Editor 跑：

```sql
-- 删旧的（如果有）
SELECT cron.unschedule('track_shipments_6h');

-- 注册
SELECT cron.schedule(
  'track_shipments_6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://bizflow.honnmono.top/functions/v1/track-shipments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 看有没有跑
SELECT * FROM cron.job WHERE jobname = 'track_shipments_6h';
SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'track_shipments_6h') ORDER BY start_time DESC LIMIT 5;
```

---

## 待 verify 的几个点

跑通沙箱前，下面这些要再核对：

1. **API endpoint 是否正确**：顺丰开放平台官网注册完后的开发文档为准。如果是 SF HK 单独平台，endpoint 不一样，改 `SF_API_ENDPOINT` 即可
2. **opCode → 状态映射**：现在写死了几个常见 code（30/50/80），完整 code 表得拿到顺丰 API 文档再补。在 `index.ts:mapSfOpCodeToStatus()` 改
3. **签名算法**：现在按「Base64(MD5(msgData + timestamp + checkword))」，是 SF 大陆开放平台主流方案。如果 HK 版有差异要改 `md5Base64()` 调用处
4. **请求体格式**：现在 form-urlencoded，少数 SF 接口要 raw JSON，看文档调整

这 4 个点不影响 bizflow 这边代码逻辑——所有顺丰特定的细节都封装在 `index.ts` 顶部 60 行，老板那边给确切文档后只改这一段。

---

## 文件位置参考

- migration：`bizflow_lazy/supabase/migrations/019_shipment_tracking.sql`
- Edge Function：`bizflow_lazy/supabase/functions/track-shipments/index.ts`
- 部署文档：本文件

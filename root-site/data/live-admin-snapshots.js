import { getSupabaseClient } from "./auth.js";
import { allRows, asArray, asNumber, asText, formatDate, formatDateTime } from "./live-snapshot-utils.js";

export async function buildNorthboundSnapshot() {
  const [statuses, records] = await Promise.all([
    allRows("northbound_statuses", "sort_order"),
    allRows("northbound_records", "created_at", false)
  ]);
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible northbound records",
    statuses: statuses.map((status) => ({ id: status.id, label: asText(status.label), color: asText(status.color), sortOrder: asNumber(status.sort_order) })),
    records: records.map((record) => ({
      id: record.id,
      name: asText(record.name),
      plateNo: asText(record.plate_no),
      hkid: asText(record.hkid),
      phoneHk: asText(record.phone_hk),
      phoneMainland: asText(record.phone_mainland),
      address: asText(record.address),
      hrpNo: asText(record.hrp_no),
      remarks: asText(record.remarks),
      submittedAt: formatDate(record.submitted_at) || null,
      submittedEndAt: formatDate(record.submitted_end_at) || null,
      statusId: record.status_id ?? null,
      createdAt: formatDateTime(record.created_at)
    }))
  };
}

export async function buildAliasesSnapshot() {
  const [aliases, products] = await Promise.all([allRows("line_item_aliases", "updated_at", false), allRows("products", "name")]);
  const productById = new Map(products.map((product) => [product.id, product]));
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible line-item aliases",
    aliases: aliases.map((alias) => {
      const linked = asArray(alias.products).map((product) => ({ product_id: asText(product.product_id), qty: asNumber(product.qty, 1) }));
      return {
        id: alias.id,
        aliasName: asText(alias.alias_name),
        skip: alias.skip === true,
        verified: alias.verified === true,
        note: asText(alias.note),
        products: linked,
        productNames: linked.map((item) => asText(productById.get(item.product_id)?.name)).filter(Boolean),
        updatedAt: formatDateTime(alias.updated_at)
      };
    })
  };
}

export async function buildShopifyLinksSnapshot() {
  const [links, products] = await Promise.all([allRows("shopify_variant_links", "created_at"), allRows("products", "name")]);
  const productById = new Map(products.map((product) => [product.id, product]));
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible Shopify links",
    links: links.map((link) => ({
      id: link.id,
      shopifyVariantId: asText(link.shopify_variant_id),
      shopifyProductId: asText(link.shopify_product_id),
      shopifySku: asText(link.shopify_sku),
      qty: asNumber(link.qty, 1),
      bizflowProductId: asText(link.bizflow_product_id),
      bizflowProductName: asText(productById.get(link.bizflow_product_id)?.name) || null
    })).sort((a, b) => asText(a.bizflowProductName).localeCompare(asText(b.bizflowProductName)))
  };
}

export async function buildSimpleRowsSnapshot(table, key) {
  const rows = await allRows(table, "created_at", false);
  return { generated_at: new Date().toISOString(), scope: `RLS-visible ${table}`, [key]: rows.map((row) => ({ ...row })) };
}

// G-exp-6: expense_reimbursements only stores employee_id; the admin "員工"
// column needs the name, so join employees here (same employeeById pattern
// as buildTasksSnapshot/buildMembersSnapshot in live-snapshots.js) instead of
// widening buildSimpleRowsSnapshot for every other caller. employee_name is
// left null (not "") when the employee row is missing so expense-model.js's
// existing `item.employee_name ?? "—"` fallback chain still applies.
export async function buildExpenseSnapshot() {
  const [rows, employees] = await Promise.all([
    allRows("expense_reimbursements", "created_at", false),
    allRows("employees", "created_at")
  ]);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible expense_reimbursements",
    reimbursements: rows.map((row) => ({
      ...row,
      employee_name: employeeById.get(row.employee_id)?.name ?? null
    }))
  };
}

const SAFE_WHATSAPP_SETTINGS = [
  "claude_mode", "openai_base_url", "model", "max_replies_per_min", "reply_delay_base",
  "cooldown_minutes", "bot_phone", "bot_name", "boss_chat_name", "daily_report_hour",
  "knowledge", "chargers_prompt", "location_hint_prompt", "boss_prompt", "latest_ext_version", "wa_outbound_mode",
  "meta_graph_version", "meta_phone_number_id", "meta_waba_id", "meta_tts_enabled", "meta_tts_relay_url",
  "meta_tts_voice_id", "meta_tts_language_boost", "meta_tts_prompt", "updated_at"
];

export async function buildWhatsappSnapshot() {
  const client = await getSupabaseClient();
  const settingsResult = await client.from("wa_settings").select(SAFE_WHATSAPP_SETTINGS.join(",")).limit(1).maybeSingle();
  if (settingsResult.error) throw settingsResult.error;
  const [whitelist, clients, heartbeatRows, messages, replies, unresolved, reports, logs] = await Promise.all([
    allRows("wa_whitelist", "created_at"),
    allRows("wa_clients", "last_seen", false, null),
    allRows("wa_heartbeat", "last_heartbeat_at", false),
    allRows("wa_messages", "created_at"),
    allRows("wa_replies", "created_at", false),
    allRows("wa_unresolved", "created_at", false),
    allRows("wa_daily_reports", "report_date", false),
    allRows("wa_logs", "created_at", false)
  ]);
  const settings = settingsResult.data ?? {};
  const heartbeat = heartbeatRows[0] ?? {};
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible WhatsApp data; credentials excluded",
    settings: {
      claudeMode: settings.claude_mode,
      openaiBaseUrl: asText(settings.openai_base_url),
      model: asText(settings.model),
      maxRepliesPerMin: settings.max_replies_per_min,
      replyDelayBase: settings.reply_delay_base,
      cooldownMinutes: settings.cooldown_minutes,
      botPhone: asText(settings.bot_phone),
      botName: asText(settings.bot_name),
      bossChatName: asText(settings.boss_chat_name),
      dailyReportHour: settings.daily_report_hour,
      knowledge: asText(settings.knowledge),
      chargersPrompt: asText(settings.chargers_prompt),
      locationHintPrompt: asText(settings.location_hint_prompt),
      bossPrompt: asText(settings.boss_prompt),
      bossPromptChars: asText(settings.boss_prompt).length,
      latestExtVersion: asText(settings.latest_ext_version),
      waOutboundMode: asText(settings.wa_outbound_mode),
      metaGraphVersion: asText(settings.meta_graph_version),
      metaPhoneNumberId: asText(settings.meta_phone_number_id),
      metaWabaId: asText(settings.meta_waba_id),
      metaTtsEnabled: settings.meta_tts_enabled === true,
      metaTtsRelayUrl: asText(settings.meta_tts_relay_url),
      metaTtsVoiceId: asText(settings.meta_tts_voice_id),
      metaTtsLanguageBoost: asText(settings.meta_tts_language_boost),
      metaTtsPrompt: asText(settings.meta_tts_prompt),
      updatedAt: formatDateTime(settings.updated_at)
    },
    whitelist: whitelist.map((row) => ({ id: row.id, kind: row.kind, value: row.value, note: asText(row.note), active: row.active === true })),
    clients: clients.map((row) => ({ clientId: row.client_id, mode: row.mode, version: asText(row.version), ua: asText(row.ua), lastSeen: formatDateTime(row.last_seen, { seconds: true }) })),
    heartbeat: { status: asText(heartbeat.status, "unknown"), errorMessage: asText(heartbeat.error_message), lastHeartbeatAt: formatDateTime(heartbeat.last_heartbeat_at, { seconds: true }) },
    messages: messages.map((row) => ({ id: row.id, customerId: row.customer_id, role: row.role, content: asText(row.content), channel: asText(row.channel), time: formatDateTime(row.created_at) })),
    replies: replies.map((row) => ({ id: row.id, customerId: asText(row.customer_id), chatName: asText(row.chat_name), isGroup: row.is_group === true, segments: row.segments ?? [], channel: asText(row.channel), time: formatDateTime(row.created_at), deliveredAt: formatDateTime(row.delivered_at) })),
    unresolved: unresolved.map((row) => ({ id: row.id, customerId: row.customer_id, question: row.question, categories: asArray(row.categories), resolvedAt: formatDateTime(row.resolved_at) || null, time: formatDateTime(row.created_at) })),
    dailyReports: reports.map((row) => ({ id: row.id, date: formatDate(row.report_date), content: asText(row.content), createdAt: formatDateTime(row.created_at) })),
    logs: logs.map((row) => ({ id: row.id, category: asText(row.category), message: asText(row.message), channel: asText(row.channel), time: formatDateTime(row.created_at, { seconds: true }) }))
  };
}

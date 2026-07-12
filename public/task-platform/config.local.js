// 部署登录模式配置。ANON_KEY 是公开密钥(与 bizflow 主端前端同一把、本就随包下发),
// 真正的访问控制在服务端 RLS(2026-07-12 已验:未登录 0 行 / 低权仅本公司 / 客户 PII 仅授权者)。
export const SUPABASE_URL = "https://bizflow.honnmono.top";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc3NDUyMzQ5LCJleHAiOjE5MzUxMzIzNDl9.MUSPKYLYD74rvqogokIpPcBEldA_RTbNBbMeDW_AZxs";

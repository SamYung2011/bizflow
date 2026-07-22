import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("root-site/login/index.html");
const css = read("root-site/login/login.css");
const login = read("root-site/login/login.js");
const auth = read("root-site/data/auth.js");
const recoveryTemplateUrl = new URL("../root-site/auth-templates/recovery.html", import.meta.url);
assert.ok(existsSync(recoveryTemplateUrl), "the hosted recovery email template must exist");
const recoveryTemplate = read("root-site/auth-templates/recovery.html");

const fieldBlocks = [...html.matchAll(/<label class="login-field"([^>]*)>([\s\S]*?)<\/label>/g)];
for (const [name, stage] of [
  ["email", "request"],
  ["recoveryToken", "verify"],
  ["newPassword", "password"],
  ["confirmPassword", "password"]
]) {
  const field = fieldBlocks.find((match) => match[2].includes(`name="${name}"`));
  assert.ok(field, `${name} must exist`);
  assert.match(field[1], /data-field-views="(?:login register )?forgot"/);
  assert.match(field[1], new RegExp(`data-forgot-stages="${stage}"`),
    `${name} must belong to only the ${stage} forgot-password stage`);
}
assert.match(login, /function fieldIsVisible\(field\)[\s\S]*state\.forgotStage/,
  "forgot field visibility must be stage-aware");
assert.match(login, /forgotStage:\s*recoveryHint\s*\?\s*"password"\s*:\s*"request"/,
  "legacy recovery links must open the password stage directly");

assert.match(html, /data-action="back-login"[^>]*data-i18n="action\.backLogin"/);
assert.match(login, /\[data-action='back-login'\][^\n]*hidden\s*=\s*state\.view\s*!==\s*"forgot"/,
  "the return-to-login action must stay visible throughout forgot mode");
assert.match(login, /async function returnToLogin\(\)[\s\S]*clearRecoveryUrl\(\);[\s\S]*setView\("login"\)/,
  "returning to login must clear recovery routing and the view message state");
assert.match(login, /async function returnToLogin\(\)[\s\S]*input\[name='email'\][\s\S]*emailInput\.value\s*=\s*""/,
  "returning from password recovery must clear the shared email input");

assert.match(auth, /client\.auth\.verifyOtp\(\{\s*email,\s*token,\s*type:\s*"recovery"\s*\}\)/,
  "the auth wrapper must verify the email recovery OTP with the Supabase v2 shape");
assert.match(login, /verifyRecoveryOtp\(\{\s*email:\s*state\.recoveryEmail,\s*token:\s*recoveryToken\s*\}\)/);
assert.match(login, /if \(!\/\^\\d\{6\}\$\/\.test\(recoveryToken\)\)/,
  "only a six-digit recovery code may reach verifyOtp");

assert.match(login, /const RESEND_DELAY_SECONDS\s*=\s*60;/);
assert.match(login, /resendDeadline\s*=\s*Date\.now\(\)\s*\+\s*RESEND_DELAY_SECONDS\s*\*\s*1000/);
assert.match(login, /window\.setInterval\(updateResendCountdown,\s*1000\)/);
assert.match(login, /resendRemaining\s*>\s*0/,
  "the resend action must remain disabled while the 60-second countdown is active");

assert.match(html, /name="recoveryToken"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\{6\}"[^>]*maxlength="6"/);
assert.match(css, /\.login-field__input--otp\s*\{[\s\S]*?font-family:\s*ui-monospace[\s\S]*?font-variant-numeric:\s*tabular-nums[\s\S]*?text-align:\s*center/);

for (const language of ["zh", "en", "fr"]) {
  const start = login.indexOf(`${language}: {`);
  const end = login.indexOf("\n    }", start);
  const dictionary = login.slice(start, end);
  for (const key of [
    "action.sendCode",
    "action.verifyCode",
    "action.resendCode",
    "action.resendCountdown",
    "action.backLogin",
    "auth.otpFormat",
    "auth.otpInvalidOrExpired",
    "auth.otpVerified"
  ]) assert.ok(dictionary.includes(`"${key}"`), `${language} must define ${key}`);
}

assert.match(recoveryTemplate, /\{\{\s*\.Token\s*\}\}/,
  "the hosted recovery template must render GoTrue's six-digit Token placeholder");
assert.match(recoveryTemplate, /Honnmono/,
  "the recovery email must carry the Honnmono brand name");
assert.match(recoveryTemplate, /background:#0468EA;color:#FFFFFF[^>]*>\s*HONNMONO\s*</,
  "the recovery email must retain the branded blue Honnmono header");
assert.match(recoveryTemplate, /max-width:520px;background:#FFFFFF;border-radius:14px/,
  "the recovery email must retain the rounded white content card");
assert.match(recoveryTemplate, /background:#F0F0F0;color:#0468EA;font-family:'Courier New',monospace;font-size:34px/,
  "the recovery code must retain the large monospace blue-on-gray treatment");
assert.match(recoveryTemplate, /輸入此驗證碼完成密碼重置，10 分鐘內有效；非本人操作請忽略。/,
  "the recovery email must explain the ten-minute validity in Chinese");
assert.match(recoveryTemplate, /Enter this code to complete your password reset\. It is valid for 10 minutes\.[\s\S]*please ignore this email\./,
  "the recovery email must explain the ten-minute validity in English");
assert.doesNotMatch(recoveryTemplate, /https?:\/\//i,
  "the recovery email must not reference any HTTP external resource");
assert.doesNotMatch(recoveryTemplate, /<(?:img|script|link|iframe)\b/i,
  "the recovery email must remain static and self-contained");

console.log("LOGIN-forgot-1 contracts: PASS (three stages, persistent return, recovery OTP, resend cooldown, legacy link)");

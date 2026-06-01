#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.MINIMAX_API_KEY || "";
const BASE_URL = process.env.MINIMAX_API_BASE || "https://api.minimax.io/v1";

function usage() {
  console.error("Usage: MINIMAX_API_KEY=... node clone-minimax-voice.js <audio.m4a|mp3|wav> <voice_id> [preview_text]");
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  return "application/octet-stream";
}

async function checkedFetch(url, options, label) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  const statusCode = data.base_resp?.status_code;
  if (statusCode !== undefined && statusCode !== 0) {
    throw new Error(`${label} failed: ${statusCode} ${data.base_resp?.status_msg || ""}`.trim());
  }
  return data;
}

async function uploadCloneAudio(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("purpose", "voice_clone");
  form.append("file", new Blob([buf], { type: contentTypeFor(filePath) }), path.basename(filePath));

  const data = await checkedFetch(`${BASE_URL}/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  }, "MiniMax upload");

  const fileId = data.file?.file_id;
  if (!fileId) throw new Error(`MiniMax upload did not return file.file_id: ${JSON.stringify(data).slice(0, 300)}`);
  return fileId;
}

async function cloneVoice(fileId, voiceId, previewText) {
  return checkedFetch(`${BASE_URL}/voice_clone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_id: fileId,
      voice_id: voiceId,
      text: previewText,
      model: "speech-2.8-turbo",
      need_noise_reduction: true,
      need_volume_normalization: true,
    }),
  }, "MiniMax voice clone");
}

async function main() {
  if (!API_KEY) throw new Error("MINIMAX_API_KEY is required");
  const [filePath, voiceId, previewTextArg] = process.argv.slice(2);
  if (!filePath || !voiceId) {
    usage();
    process.exit(2);
  }

  const previewText = previewTextArg || "你好，我係 Honnmono 客服。請問有咩可以幫到你？(breath) 我哋會盡快為你處理。";
  const fileId = await uploadCloneAudio(filePath);
  const clone = await cloneVoice(fileId, voiceId, previewText);

  const result = {
    ok: true,
    file_id: fileId,
    voice_id: voiceId,
    demo_audio: clone.demo_audio || "",
    input_sensitive: clone.input_sensitive ?? null,
    input_sensitive_type: clone.input_sensitive_type ?? null,
    base_resp: clone.base_resp || null,
  };

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error("[clone-minimax-voice] " + err.message);
    process.exit(1);
  });
}

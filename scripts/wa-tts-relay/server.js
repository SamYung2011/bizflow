#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PORT = Number(process.env.PORT || 8091);
const RELAY_TOKEN = process.env.WA_TTS_RELAY_TOKEN || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";

const DEFAULTS = {
  minimaxEndpoint: process.env.MINIMAX_TTS_ENDPOINT || "https://api.minimax.io/v1/t2a_v2",
  minimaxModel: process.env.MINIMAX_TTS_MODEL || "speech-2.8-turbo",
  minimaxVoiceId: process.env.MINIMAX_VOICE_ID || "Cantonese_GentleLady",
  languageBoost: process.env.MINIMAX_LANGUAGE_BOOST || "Chinese,Yue",
  graphVersion: process.env.META_GRAPH_VERSION || "v25.0",
  sampleRate: Number(process.env.MINIMAX_TTS_SAMPLE_RATE || 32000),
  bitrate: Number(process.env.MINIMAX_TTS_BITRATE || 128000),
  format: process.env.MINIMAX_TTS_FORMAT || "mp3",
  channel: Number(process.env.MINIMAX_TTS_CHANNEL || 1),
  speed: Number(process.env.MINIMAX_TTS_SPEED || 1),
  vol: Number(process.env.MINIMAX_TTS_VOL || 1),
  pitch: Number(process.env.MINIMAX_TTS_PITCH || 0),
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function normalizePhone(raw) {
  return String(raw || "").replace(/[^0-9]/g, "");
}

function assertAuth(req) {
  if (!RELAY_TOKEN) throw new Error("WA_TTS_RELAY_TOKEN is not configured");
  const got = req.headers["x-relay-token"] || "";
  if (got !== RELAY_TOKEN) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function checkedFetch(url, options, label) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

async function generateMiniMaxSpeech(text, options = {}) {
  const apiKey = options.apiKey || MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY is not configured");

  const format = options.format || DEFAULTS.format;
  const payload = {
    model: options.model || DEFAULTS.minimaxModel,
    text,
    stream: false,
    language_boost: options.language || DEFAULTS.languageBoost,
    output_format: "hex",
    voice_setting: {
      voice_id: options.voiceId || DEFAULTS.minimaxVoiceId,
      speed: options.speed ?? DEFAULTS.speed,
      vol: options.vol ?? DEFAULTS.vol,
      pitch: options.pitch ?? DEFAULTS.pitch,
    },
    audio_setting: {
      sample_rate: options.sampleRate || DEFAULTS.sampleRate,
      bitrate: options.bitrate || DEFAULTS.bitrate,
      format,
      channel: options.channel || DEFAULTS.channel,
    },
  };

  const data = await checkedFetch(options.endpoint || DEFAULTS.minimaxEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "MiniMax TTS");

  const statusCode = data.base_resp?.status_code;
  if (statusCode !== undefined && statusCode !== 0) {
    throw new Error(`MiniMax TTS failed: ${statusCode} ${data.base_resp?.status_msg || ""}`.trim());
  }

  const hex = data.data?.audio;
  if (!hex || typeof hex !== "string") {
    throw new Error("MiniMax TTS did not return data.audio hex");
  }

  return {
    buffer: Buffer.from(hex, "hex"),
    format,
    traceId: data.trace_id || "",
    extraInfo: data.extra_info || {},
  };
}

function convertToOggOpus(audioBuffer, inputFormat) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-tts-"));
  const inputExt = String(inputFormat || "mp3").replace(/[^a-z0-9]/gi, "") || "mp3";
  const inputPath = path.join(tempDir, `input.${inputExt}`);
  const outputPath = path.join(tempDir, "voice.ogg");

  try {
    fs.writeFileSync(inputPath, audioBuffer);
    const result = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "48000",
      "-c:a", "libopus",
      "-b:a", "32k",
      outputPath,
    ], { encoding: "utf8" });

    if (result.error && result.error.code === "ENOENT") {
      throw new Error("ffmpeg not found in relay container");
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || "").slice(0, 500)}`);
    }
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function uploadMetaMedia(audioBuffer, options) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), `minimax-tts-${Date.now()}.ogg`);

  const data = await checkedFetch(
    `https://graph.facebook.com/${options.graphVersion}/${options.phoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${options.accessToken}` },
      body: form,
    },
    "Meta media upload",
  );

  if (!data.id) throw new Error(`Meta media upload did not return id: ${JSON.stringify(data).slice(0, 300)}`);
  return data.id;
}

async function sendMetaVoice(mediaId, options) {
  const data = await checkedFetch(
    `https://graph.facebook.com/${options.graphVersion}/${options.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: options.to,
        type: "audio",
        audio: { id: mediaId, voice: true },
      }),
    },
    "Meta send voice",
  );

  return data.messages?.[0]?.id || "";
}

async function sendTtsVoice(body) {
  const to = normalizePhone(body.to);
  const text = String(body.text || "").trim();
  const accessToken = body.metaAccessToken || process.env.META_ACCESS_TOKEN || "";
  const phoneNumberId = body.metaPhoneNumberId || process.env.META_PHONE_NUMBER_ID || "";
  const graphVersion = body.graphVersion || DEFAULTS.graphVersion;

  if (!to) throw new Error("to is required");
  if (!text) throw new Error("text is required");
  if (!accessToken) throw new Error("Meta access token is required");
  if (!phoneNumberId) throw new Error("Meta phone number id is required");

  const speech = await generateMiniMaxSpeech(text, {
    voiceId: body.voiceId,
    language: body.language,
    model: body.model,
    format: DEFAULTS.format,
  });
  const ogg = convertToOggOpus(speech.buffer, speech.format);
  const mediaId = await uploadMetaMedia(ogg, { graphVersion, phoneNumberId, accessToken });
  const wamid = await sendMetaVoice(mediaId, { graphVersion, phoneNumberId, accessToken, to });

  return {
    ok: true,
    to,
    mediaId,
    wamid,
    traceId: speech.traceId,
    voiceNote: true,
    textLength: text.length,
    bytes: ogg.length,
    extraInfo: speech.extraInfo,
  };
}

const server = require("http").createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        ok: true,
        service: "wa-tts-relay",
        minimaxConfigured: Boolean(MINIMAX_API_KEY),
        ffmpeg: Boolean(spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout),
      });
    }

    if (req.method === "POST" && req.url === "/send-tts") {
      assertAuth(req);
      const body = await readJson(req);
      const started = Date.now();
      const result = await sendTtsVoice(body);
      console.log(JSON.stringify({
        level: "info",
        event: "send-tts",
        to: result.to,
        textLength: result.textLength,
        bytes: result.bytes,
        ms: Date.now() - started,
        wamid: result.wamid ? "set" : "empty",
      }));
      return json(res, 200, result);
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    const status = err.status || 500;
    console.error(JSON.stringify({
      level: "error",
      event: "request",
      status,
      message: err.message,
    }));
    json(res, status, { ok: false, error: err.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({
    level: "info",
    event: "start",
    service: "wa-tts-relay",
    port: PORT,
    minimaxConfigured: Boolean(MINIMAX_API_KEY),
  }));
});

import Anthropic from "@anthropic-ai/sdk";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { SYSTEM_PROMPT } from "./prompt.js";

// Clave de Claude guardada en Secret Manager:
//   npx firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const MAX_TURNS = 20; // mensajes de historial que se envían a Claude
const MAX_CHARS = 2000; // longitud máxima de cada mensaje del usuario
const MAX_TOKENS = 4000; // tope de respuesta (incluye el razonamiento interno)

// Límite simple por IP (por instancia).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_MAX;
}

function allowedOrigin(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Boolean(origin) && (allowed.includes("*") || allowed.includes(origin));
}

// Acepta [{role:"user"|"assistant", content:"..."}], alternados y terminando en "user".
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const msgs = input.slice(-MAX_TURNS);
  while (msgs.length && msgs[0]?.role !== "user") msgs.shift();
  const out = [];
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string") return null;
    const content = m.content.trim().slice(0, MAX_CHARS);
    if (!content) return null;
    if (out.length && out[out.length - 1].role === m.role) return null;
    out.push({ role: m.role, content });
  }
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

// Parámetros que dependen del modelo elegido en functions/.env.
function modelParams(model) {
  if (model.startsWith("claude-haiku")) return { betas: [] };
  return {
    // Respuestas de chat: poco razonamiento = más rápido y más barato.
    output_config: { effort: "low" },
    // Si el filtro de seguridad del modelo rechaza una pregunta legítima
    // (p. ej. sobre medicamentos), la API la reintenta con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

const FALLBACK_TEXT =
  "Perdón, no puedo responder eso por aquí. Escríbenos por WhatsApp al +52 720 543 5447 (https://wa.me/527205435447) y con gusto te orientamos.";

export const chat = onRequest(
  {
    region: "us-central1",
    secrets: [ANTHROPIC_API_KEY],
    memory: "256MiB",
    timeoutSeconds: 120,
    concurrency: 40,
    maxInstances: 3, // tope de costo de servidor
  },
  async (req, res) => {
    const origin = req.get("Origin");
    const okOrigin = allowedOrigin(origin);
    res.set("Vary", "Origin");
    if (okOrigin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") return void res.status(204).end();
    if (req.method === "GET") return void res.json({ ok: true, service: "amanecer-chat" });
    if (req.method !== "POST") return void res.status(405).json({ error: "method_not_allowed" });
    if (!okOrigin) return void res.status(403).json({ error: "origin_not_allowed" });

    const ip = (req.get("X-Forwarded-For") || req.ip || "unknown").split(",")[0].trim();
    if (rateLimited(ip)) return void res.status(429).json({ error: "rate_limited" });

    const messages = cleanMessages(req.body?.messages);
    if (!messages) return void res.status(400).json({ error: "bad_messages" });

    const model = process.env.MODEL || "claude-opus-5-5";
    const client = new Anthropic({
      apiKey: ANTHROPIC_API_KEY.value(),
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });

    // Respondemos con Server-Sent Events: {"t": "texto"} por fragmento,
    // {"reset": true} si hay que borrar lo escrito, y [DONE] al final.
    res.status(200);
    res.set("Content-Type", "text/event-stream; charset=utf-8");
    res.set("Cache-Control", "no-cache");
    res.flushHeaders();
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        messages,
        ...modelParams(model),
      });

      let wroteText = false;
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "fallback") {
          // Otro modelo retoma la respuesta: descartamos el texto parcial.
          if (wroteText) send({ reset: true });
          wroteText = false;
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          wroteText = true;
          send({ t: event.delta.text });
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        if (wroteText) send({ reset: true });
        send({ t: FALLBACK_TEXT });
      } else if (final.stop_reason === "max_tokens" && !wroteText) {
        send({ t: FALLBACK_TEXT });
      }
      console.log(
        JSON.stringify({
          model: final.model,
          stop: final.stop_reason,
          in: final.usage.input_tokens,
          cache_read: final.usage.cache_read_input_tokens,
          cache_write: final.usage.cache_creation_input_tokens,
          out: final.usage.output_tokens,
        }),
      );
    } catch (err) {
      let code = "server_error";
      if (err instanceof Anthropic.RateLimitError) code = "busy";
      else if (err instanceof Anthropic.AuthenticationError) code = "config_error";
      else if (err instanceof Anthropic.InternalServerError) code = "busy";
      else if (err instanceof Anthropic.APIConnectionError) code = "busy";
      console.error(code, err?.status, err?.message);
      send({ error: code });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  },
);

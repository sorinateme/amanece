import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";

const MAX_TURNS = 20; // mensajes de historial que se envían a Claude
const MAX_CHARS = 2000; // longitud máxima de cada mensaje del usuario
const MAX_TOKENS = 4000; // tope de respuesta (incluye el razonamiento interno)

// Límite simple por IP (por instancia del Worker). Para un límite global,
// agrega además una regla de "Rate limiting" en el panel de Cloudflare.
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

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const headers = { Vary: "Origin" };
  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Acepta [{role:"user"|"assistant", content:"..."}], alternados y terminando en "user".
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const msgs = input.slice(-MAX_TURNS);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
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

// Parámetros que dependen del modelo elegido en wrangler.toml.
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

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "amanecer-chat" }, 200, cors);
    }
    if (request.method !== "POST" || url.pathname !== "/chat") {
      return json({ error: "not_found" }, 404, cors);
    }
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403, cors);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) return json({ error: "rate_limited" }, 429, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_json" }, 400, cors);
    }
    const messages = cleanMessages(body?.messages);
    if (!messages) return json({ error: "bad_messages" }, 400, cors);

    const model = env.MODEL || "claude-opus-5-5";
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });

    // Respondemos con Server-Sent Events: {"t": "texto"} por fragmento,
    // {"reset": true} si hay que borrar lo escrito, y [DONE] al final.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (data) => writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

    const run = async () => {
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
            if (wroteText) await send({ reset: true });
            wroteText = false;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            wroteText = true;
            await send({ t: event.delta.text });
          }
        }

        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          if (wroteText) await send({ reset: true });
          await send({ t: FALLBACK_TEXT });
        } else if (final.stop_reason === "max_tokens" && !wroteText) {
          await send({ t: FALLBACK_TEXT });
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
        await send({ error: code });
      } finally {
        await writer.write(enc.encode("data: [DONE]\n\n"));
        await writer.close();
      }
    };
    ctx.waitUntil(run());

    return new Response(readable, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  },
};

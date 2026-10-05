/*!
 * Chat de Amanecer A.C. — widget embebible, sin dependencias.
 *
 * Uso (página web o app Capacitor):
 *   <script src="amanecer-chat.js"
 *           data-endpoint="https://us-central1-TU-PROYECTO.cloudfunctions.net/chat"
 *           defer></script>
 *
 * Atributos opcionales:
 *   data-color   color principal (por defecto #be123c)
 *   data-bottom  distancia del botón al borde inferior (por defecto 96px)
 *   data-side    "right" o "left" (por defecto right)
 */
(function () {
  "use strict";
  if (window.__amanecerChat) return;
  window.__amanecerChat = true;

  var script = document.currentScript || document.querySelector("script[data-endpoint]");
  var cfg = {
    endpoint: (script && script.dataset.endpoint) || "",
    color: (script && script.dataset.color) || "#be123c",
    bottom: (script && script.dataset.bottom) || "96px",
    side: (script && script.dataset.side) === "left" ? "left" : "right",
  };
  var STORE_KEY = "amanecer-chat-v1";
  var MAX_SAVED = 30;
  var WHATSAPP = "https://wa.me/527205435447";
  var GREETING =
    "¡Hola! Soy Amanecer, el asistente virtual de Amanecer A.C. 💙\nPuedo orientarte sobre enfermedad renal, diálisis, alimentación y nuestros programas. ¿En qué te ayudo?";
  var SUGGESTIONS = [
    "¿Qué alimentos tienen mucho potasio?",
    "¿Cómo cuido mi catéter de diálisis?",
    "¿Cómo puedo recibir apoyo de Amanecer?",
  ];
  var ERRORS = {
    busy: "Estamos recibiendo muchas consultas. Intenta de nuevo en un momento.",
    rate_limited: "Enviaste varios mensajes muy seguido. Espera un minuto e intenta otra vez.",
    network: "No pude conectarme. Revisa tu conexión a internet e intenta de nuevo.",
    default: "Ocurrió un problema. Intenta de nuevo o escríbenos por WhatsApp.",
  };

  // ---------- estado ----------
  var history = load();
  var busy = false;

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-MAX_SAVED)));
    } catch (e) {}
  }

  // ---------- estilos ----------
  var css =
    ".amc,.amc *{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".amc-btn{position:fixed;" + cfg.side + ":16px;bottom:" + cfg.bottom + ";z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;background:var(--amc);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
    ".amc-btn:hover{transform:scale(1.06)}.amc-btn svg{width:28px;height:28px}" +
    ".amc-panel{position:fixed;" + cfg.side + ":16px;bottom:calc(" + cfg.bottom + " + 68px);z-index:2147483001;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - " + cfg.bottom + " - 92px);background:#fff;color:#0f172a;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;border:1px solid #e2e8f0}" +
    ".amc-panel.open{display:flex}" +
    "@media (max-width:480px){.amc-panel{left:0;right:0;bottom:0;width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}}" +
    ".amc-head{background:var(--amc);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}" +
    ".amc-head b{display:block;font-size:15px}.amc-head small{font-size:11px;opacity:.9}" +
    ".amc-head .amc-sp{flex:1}" +
    ".amc-ib{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:8px;height:32px;min-width:32px;padding:0 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center}" +
    ".amc-ib:hover{background:rgba(255,255,255,.3)}" +
    ".amc-log{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}" +
    ".amc-m{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
    ".amc-m a{color:inherit;text-decoration:underline;word-break:break-all}" +
    ".amc-u{align-self:flex-end;background:var(--amc);color:#fff;border-bottom-right-radius:4px}" +
    ".amc-a{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}" +
    ".amc-err{align-self:center;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:13px}" +
    ".amc-dots span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#94a3b8;animation:amcb 1.2s infinite}" +
    ".amc-dots span:nth-child(2){animation-delay:.2s}.amc-dots span:nth-child(3){animation-delay:.4s}" +
    "@keyframes amcb{0%,80%,100%{opacity:.3}40%{opacity:1}}" +
    ".amc-sug{display:flex;flex-wrap:wrap;gap:6px}" +
    ".amc-sug button{background:#fff;border:1px solid var(--amc);color:var(--amc);border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}" +
    ".amc-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}" +
    ".amc-form textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:9px 11px;font-size:16px;max-height:110px;outline:none;color:#0f172a;background:#fff}" +
    ".amc-form textarea:focus{border-color:var(--amc)}" +
    ".amc-form button{border:0;border-radius:12px;background:var(--amc);color:#fff;width:44px;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
    ".amc-form button:disabled{opacity:.5;cursor:default}" +
    ".amc-note{font-size:10.5px;color:#64748b;text-align:center;padding:0 10px 8px;background:#fff}" +
    ".amc-note a{color:#64748b}" +
    "@media print{.amc{display:none!important}}";

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SEND =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>';

  // ---------- DOM ----------
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  var root = el("div", "amc");
  root.style.setProperty("--amc", cfg.color);
  var style = el("style");
  style.textContent = css;

  var btn = el("button", "amc-btn", ICON_CHAT);
  btn.setAttribute("aria-label", "Abrir chat de Amanecer");

  var panel = el("div", "amc-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat de Amanecer A.C.");

  var head = el(
    "div",
    "amc-head",
    '<div class="amc-sp"><b>Asistente Amanecer</b><small>Orientación en salud renal · respuesta automática</small></div>'
  );
  var clearBtn = el("button", "amc-ib", "Nuevo");
  clearBtn.title = "Empezar una conversación nueva";
  var closeBtn = el("button", "amc-ib", ICON_CLOSE);
  closeBtn.setAttribute("aria-label", "Cerrar chat");
  head.appendChild(clearBtn);
  head.appendChild(closeBtn);

  var log = el("div", "amc-log");
  log.setAttribute("aria-live", "polite");

  var form = el("form", "amc-form");
  var input = el("textarea");
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = "Escribe tu pregunta…";
  var send = el("button", null, ICON_SEND);
  send.type = "submit";
  send.setAttribute("aria-label", "Enviar");
  form.appendChild(input);
  form.appendChild(send);

  var note = el(
    "div",
    "amc-note",
    'Información general; no sustituye a tu médico. En una urgencia llama al 911. · <a href="' +
      WHATSAPP +
      '" target="_blank" rel="noopener">Hablar con una persona</a>'
  );

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(form);
  panel.appendChild(note);
  root.appendChild(style);
  root.appendChild(btn);
  root.appendChild(panel);

  function mount() {
    document.body.appendChild(root);
    render();
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  // ---------- render ----------
  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function format(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(https?:\/\/[^\s<)]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function bubble(role, text) {
    var b = el("div", "amc-m " + (role === "user" ? "amc-u" : "amc-a"));
    b.innerHTML = format(text);
    log.appendChild(b);
    return b;
  }
  function scroll() {
    log.scrollTop = log.scrollHeight;
  }
  function render() {
    log.innerHTML = "";
    bubble("assistant", GREETING);
    if (!history.length) {
      var sug = el("div", "amc-sug");
      SUGGESTIONS.forEach(function (q) {
        var b = el("button");
        b.type = "button";
        b.textContent = q;
        b.onclick = function () {
          ask(q);
        };
        sug.appendChild(b);
      });
      log.appendChild(sug);
    }
    history.forEach(function (m) {
      bubble(m.role, m.content);
    });
    scroll();
  }
  function showError(code) {
    var b = el("div", "amc-m amc-err");
    b.textContent = ERRORS[code] || ERRORS.default;
    log.appendChild(b);
    scroll();
  }

  // ---------- eventos ----------
  btn.onclick = function () {
    var open = panel.classList.toggle("open");
    btn.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    btn.setAttribute("aria-label", open ? "Cerrar chat" : "Abrir chat de Amanecer");
    if (open) {
      scroll();
      if (window.matchMedia("(min-width: 481px)").matches) input.focus();
    }
  };
  closeBtn.onclick = function () {
    if (panel.classList.contains("open")) btn.onclick();
  };
  clearBtn.onclick = function () {
    if (busy) return;
    history = [];
    save();
    render();
  };
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.onsubmit(e);
    }
  });
  form.onsubmit = function (e) {
    e.preventDefault();
    ask(input.value);
  };

  // ---------- envío y streaming ----------
  function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (!cfg.endpoint) {
      showError("default");
      console.error("[amanecer-chat] Falta data-endpoint en la etiqueta <script>.");
      return;
    }
    busy = true;
    send.disabled = true;
    input.value = "";
    input.style.height = "auto";

    // Si el último turno quedó sin respuesta (error), lo reemplazamos.
    if (history.length && history[history.length - 1].role === "user") history.pop();
    history.push({ role: "user", content: text });
    save();
    render();

    var reply = bubble("assistant", "");
    reply.innerHTML = '<span class="amc-dots"><span></span><span></span><span></span></span>';
    scroll();
    var acc = "";
    var errCode = null;

    fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-20) }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          errCode = res.status === 429 ? "rate_limited" : "default";
          return;
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split("\n\n");
            buf = parts.pop();
            parts.forEach(function (chunk) {
              var line = chunk.trim();
              if (line.indexOf("data:") !== 0) return;
              var data = line.slice(5).trim();
              if (data === "[DONE]") return;
              var msg;
              try {
                msg = JSON.parse(data);
              } catch (e) {
                return;
              }
              if (msg.reset) acc = "";
              if (msg.t) acc += msg.t;
              if (msg.error) errCode = msg.error;
              if (acc) {
                reply.innerHTML = format(acc);
                scroll();
              }
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        errCode = errCode || "network";
      })
      .then(function () {
        if (acc.trim()) {
          history.push({ role: "assistant", content: acc.trim() });
          save();
        } else {
          reply.remove();
          showError(errCode || "default");
        }
        busy = false;
        send.disabled = false;
      });
  }
})();

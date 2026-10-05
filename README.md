# Chat propio de Amanecer A.C. (sin n8n)

Asistente virtual para la **página web** y la **app Amanecer Salud Renal**, conectado
directamente a Claude (Anthropic). Reemplaza el flujo de n8n: no hay servidor de
automatizaciones que pagar ni mantener.

```
Página web / App  ──►  Cloudflare Worker (gratis)  ──►  API de Claude
 widget/amanecer-chat.js      chat-server/                 (pago por uso)
```

- `chat-server/` — backend (Cloudflare Worker). Guarda la clave de API en secreto,
  limita abusos (dominios permitidos, mensajes por minuto, tamaño de mensajes) y
  transmite la respuesta palabra por palabra.
- `chat-server/src/prompt.js` — **lo que el bot sabe y cómo responde**. Edítalo en
  español para agregar programas, horarios, preguntas frecuentes, etc.
- `widget/amanecer-chat.js` — el chat (botón flotante + ventana). Un solo archivo,
  sin dependencias. Funciona igual en la web y dentro de la app (Capacitor).
- `widget/demo.html` — página de prueba.

## Costos

| Concepto | Costo |
|---|---|
| Cloudflare Workers | **$0** hasta 100,000 peticiones al día (plan gratuito) |
| Claude Opus 5.5 (configurado) | ≈ US$0.02 por pregunta → ~US$20 por cada 1,000 preguntas |
| Claude Sonnet 5.5 | ≈ US$0.01 por pregunta → ~US$10 por cada 1,000 |
| Claude Haiku 4.5 | ≈ US$0.004 por pregunta → ~US$4 por cada 1,000 |

Son estimaciones (instrucciones de ~1,500 tokens + historial + respuesta corta);
el costo real aparece en <https://console.anthropic.com>. Ahí mismo puedes poner un
**límite de gasto mensual** para que nunca se pase del presupuesto.

Para cambiar de modelo, edita `MODEL` en `chat-server/wrangler.toml` y vuelve a
publicar (`npm run deploy`).

## Instalación (una sola vez, ~15 minutos)

1. **Clave de Claude**: crea una cuenta en <https://console.anthropic.com>, agrega
   saldo y genera una API key. Configura un límite de gasto en *Billing → Limits*.
2. **Cuenta de Cloudflare** gratuita en <https://dash.cloudflare.com/sign-up>.
3. En tu computadora (con Node.js instalado):
   ```bash
   cd chat-server
   npm install
   npx wrangler login                       # abre el navegador para autorizar
   npx wrangler secret put ANTHROPIC_API_KEY   # pega la clave cuando la pida
   ```
4. Edita `ALLOWED_ORIGINS` en `chat-server/wrangler.toml` con el dominio real de la
   página (por ejemplo `https://amanecer.org,https://www.amanecer.org`). Deja
   `capacitor://localhost,https://localhost`: son los orígenes de la app en iOS y Android.
5. Publica:
   ```bash
   npm run deploy
   ```
   Te dará una URL como `https://amanecer-chat.TU-CUENTA.workers.dev`.
   Ábrela: debe responder `{"ok":true,...}`.

## Agregarlo a la página web

Sube `widget/amanecer-chat.js` a la página (o a cualquier hosting) y pega antes de
`</body>`:

```html
<script src="/amanecer-chat.js"
        data-endpoint="https://amanecer-chat.TU-CUENTA.workers.dev/chat"
        defer></script>
```

Quita el código del chat de n8n que tenga la página (normalmente un `<script>` o
`<link>` con `n8n` o `@n8n/chat`).

> WordPress: usa un plugin tipo *WPCode* → "Footer". Wix: *Configuración → Código
> personalizado → Body - end*.

## Agregarlo a la app Amanecer Salud Renal

En el repositorio de la app (`www/`):

1. Copia `widget/amanecer-chat.js` a `www/amanecer-chat.js`.
2. En `www/index.html`, antes de `</body>`:
   ```html
   <script src="amanecer-chat.js"
           data-endpoint="https://amanecer-chat.TU-CUENTA.workers.dev/chat"
           data-bottom="150px" defer></script>
   ```
   (`data-bottom="150px"` lo coloca arriba del botón de WhatsApp y de la barra
   inferior; ajústalo si se encima.)
3. `npx cap sync` y vuelve a compilar.

## Opciones del widget

| Atributo | Para qué | Por defecto |
|---|---|---|
| `data-endpoint` | URL del Worker + `/chat` (obligatorio) | — |
| `data-color` | Color principal | `#be123c` (el rosa de la app) |
| `data-bottom` | Distancia del botón al borde inferior | `96px` |
| `data-side` | `right` o `left` | `right` |

La conversación se guarda solo en el dispositivo del usuario (localStorage); el
botón "Nuevo" la borra. El servidor no guarda conversaciones, solo registra
cantidades de tokens para controlar costos (`npx wrangler tail` para verlas).

## Probar en tu computadora

```bash
cd chat-server
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars
npx wrangler dev --var ALLOWED_ORIGINS:http://localhost:8080
# en otra terminal
cd widget && python3 -m http.server 8080
# abre http://localhost:8080/demo.html
```

## Seguridad y responsabilidad médica

- El bot tiene instrucciones de **no diagnosticar ni cambiar dosis**, de mandar a
  urgencias/911 ante señales de alarma y de derivar a WhatsApp lo que no sepa.
  Revisa y ajusta esas reglas en `prompt.js` con el equipo médico de la asociación.
- La ventana muestra siempre el aviso "no sustituye a tu médico".
- La clave de API vive solo en Cloudflare; nunca va en la página ni en la app.
- Recomendado: en Cloudflare → *Security → WAF → Rate limiting rules*, agrega una
  regla para `/chat` (por ejemplo 20 peticiones por minuto por IP).

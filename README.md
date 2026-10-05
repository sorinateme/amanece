# Chat propio de Amanecer A.C. (sin n8n)

Asistente virtual para la **página web** y la **app Amanecer Salud Renal**, conectado
directamente a Claude (Anthropic). Reemplaza el flujo de n8n: no hay servidor de
automatizaciones que pagar ni mantener.

```
Página web (Hostinger) / App  ──►  Firebase Cloud Function  ──►  API de Claude
   widget/amanecer-chat.js           functions/                  (pago por uso)
```

- `functions/` — backend (Firebase Cloud Functions, 2ª gen). Guarda la clave de API
  en Secret Manager, limita abusos (dominios permitidos, mensajes por minuto, tamaño
  de mensajes) y transmite la respuesta palabra por palabra.
- `functions/prompt.js` — **lo que el bot sabe y cómo responde**. Edítalo en
  español para agregar programas, horarios, preguntas frecuentes, etc.
- `functions/.env` — modelo de Claude y dominios permitidos.
- `widget/amanecer-chat.js` — el chat (botón flotante + ventana). Un solo archivo,
  sin dependencias. Funciona igual en la web y dentro de la app (Capacitor).
- `widget/demo.html` — página de prueba.

## Costos

| Concepto | Costo |
|---|---|
| Firebase Cloud Functions | Requiere plan **Blaze**, pero incluye 2 millones de invocaciones gratis al mes; para el volumen de un chat como este normalmente es **$0** |
| Claude Opus 5.5 (configurado) | ≈ US$0.02 por pregunta → ~US$20 por cada 1,000 preguntas |
| Claude Sonnet 5.5 | ≈ US$0.01 por pregunta → ~US$10 por cada 1,000 |
| Claude Haiku 4.5 | ≈ US$0.004 por pregunta → ~US$4 por cada 1,000 |

Son estimaciones; el costo real aparece en <https://console.anthropic.com>, donde
puedes poner un **límite de gasto mensual**. En Google Cloud también puedes crear
una alerta de presupuesto (*Facturación → Presupuestos y alertas*).

Para cambiar de modelo, edita `MODEL` en `functions/.env` y vuelve a publicar.

## 1. Publicar el servidor en Firebase (una sola vez)

Necesitas Node.js 22 en tu computadora.

1. Crea la API key en <https://console.anthropic.com> (*API Keys*) y pon un límite
   de gasto en *Billing → Limits*.
2. Edita `functions/.env`: cambia `TU-DOMINIO` por el dominio real de la página en
   Hostinger (con y sin `www`). Deja `capacitor://localhost,https://localhost`,
   que son la app en iOS y Android.
3. En una terminal, dentro de esta carpeta del proyecto:
   ```bash
   cd functions
   npm install
   npx firebase login
   npx firebase use --add      # elige tu proyecto de Firebase
   npx firebase functions:secrets:set ANTHROPIC_API_KEY   # pega la clave
   npx firebase deploy --only functions:amanecer-chat
   ```
   Al terminar muestra la URL, algo como
   `https://us-central1-TU-PROYECTO.cloudfunctions.net/chat`. Ábrela en el navegador:
   debe decir `{"ok":true,"service":"amanecer-chat"}`.

> El código usa su propio *codebase* (`amanecer-chat`), así que **no toca ni borra
> las otras funciones** que ya tengas en ese proyecto de Firebase.

## 2. Subirlo a la página en Hostinger

1. hPanel → **Archivos → Administrador de archivos** → carpeta `public_html`.
2. Sube `widget/amanecer-chat.js`.
3. Pega esto antes de `</body>`:
   ```html
   <script src="/amanecer-chat.js"
           data-endpoint="https://us-central1-TU-PROYECTO.cloudfunctions.net/chat"
           defer></script>
   ```
   - Página en HTML: edita `index.html` (y las demás páginas) en el Administrador de archivos.
   - WordPress: plugin *WPCode* → *Header & Footer* → *Footer*.
   - Constructor de sitios de Hostinger: *Configuración → Integraciones / Código personalizado*.
4. Quita el código del chat de n8n (un `<script>` o `<link>` que mencione `n8n`
   o `@n8n/chat`).
5. Abre la página: el botón rosa del chat aparece abajo a la derecha.

## 3. Agregarlo a la app Amanecer Salud Renal

En el repositorio de la app (`www/`):

1. Copia `widget/amanecer-chat.js` a `www/amanecer-chat.js`.
2. En `www/index.html`, antes de `</body>`:
   ```html
   <script src="amanecer-chat.js"
           data-endpoint="https://us-central1-TU-PROYECTO.cloudfunctions.net/chat"
           data-bottom="150px" defer></script>
   ```
   (`data-bottom="150px"` lo coloca arriba del botón de WhatsApp y de la barra
   inferior; ajústalo si se encima.)
3. `npx cap sync` y vuelve a compilar.

## Opciones del widget

| Atributo | Para qué | Por defecto |
|---|---|---|
| `data-endpoint` | URL de la función `chat` de Firebase (obligatorio) | — |
| `data-color` | Color principal | `#be123c` (el rosa de la app) |
| `data-bottom` | Distancia del botón al borde inferior | `96px` |
| `data-side` | `right` o `left` | `right` |

La conversación se guarda solo en el dispositivo del usuario (localStorage); el
botón "Nuevo" la borra. El servidor no guarda conversaciones, solo registra
cantidades de tokens para controlar costos (Firebase → *Functions → Registros*).

## Probar en tu computadora

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > functions/.secret.local
cd functions && npx firebase emulators:start --only functions
# en otra terminal, desde la raíz del proyecto
cd widget && python3 -m http.server 8080
# en demo.html pon data-endpoint="http://127.0.0.1:5001/TU-PROYECTO/us-central1/chat"
# y abre http://localhost:8080/demo.html
```

## Seguridad y responsabilidad médica

- El bot tiene instrucciones de **no diagnosticar ni cambiar dosis**, de mandar a
  urgencias/911 ante señales de alarma y de derivar a WhatsApp lo que no sepa.
  Revisa y ajusta esas reglas en `functions/prompt.js` con el equipo médico de la asociación.
- La ventana muestra siempre el aviso "no sustituye a tu médico".
- La clave de API vive solo en Secret Manager de Firebase; nunca va en la página
  ni en la app.
- `maxInstances: 3` en `functions/index.js` pone un techo al servidor para que un
  abuso no dispare costos.

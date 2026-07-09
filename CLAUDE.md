# BaloMio — contexto del proyecto

Generador de tiquetes para Baloto y MiLoto (loterías de Colombia). Vanilla JS, sin build ni frameworks.

## Infraestructura

- **App en vivo**: https://generador-suerte.web.app
- **Firebase**: proyecto `mi-todo-list-premium` (COMPARTIDO con la app todo-list del usuario, que vive en el sitio default `mi-todo-list-premium.web.app` — no tocarla).
  - Hosting: sitio adicional `generador-suerte`, target `generador`. Deploy: `firebase deploy --only hosting:generador`
  - App web Firebase: "BaloMio" (config en `script.js`).
  - Firestore: apuestas en `balomio/{uid}/apuestas/{id}`. **`firestore.rules` contiene las reglas de AMBAS apps** (`tareas`/`usuarios` son de la todo-list): nunca desplegar reglas quitando esas secciones.
  - Auth: Google Sign-In. El dominio `generador-suerte.web.app` está en authorizedDomains (se agregó vía API identitytoolkit; no hay CLI para eso).
- **GitHub**: https://github.com/luisalbeiro82/balomio (push con credenciales del Credential Manager de Windows).

## Decisiones técnicas

- Números con `crypto.getRandomValues` + muestreo por rechazo (sin sesgo). MiLoto: 5 de 1–39. Baloto: 5 de 1–43 + Superbalota 1–16.
- Sin sesión las apuestas van a localStorage; al iniciar sesión se migran a Firestore (`migrarLocalesANube`).
- baloto.com NO tiene API pública, no envía CORS y bloquea IPs de datacenter/proxies (verificado 2026-07-09): los resultados ganadores se digitan a mano en el comparador. Una Cloud Function requeriría plan Blaze y probablemente también sería bloqueada.
- `index.html` referencia `style.css?v=N` y `script.js?v=N`: **subir la versión al editar esos archivos** (hubo problemas de caché en móvil). Hosting envía `Cache-Control: no-cache` para html/js/css/json.
- Íconos generados con GDI+ (PowerShell System.Drawing): balota teal con "B". `manifest.json` para el acceso directo Android.

## Hoja de ruta (pendientes acordados)

1. ~~**Estadísticas de números que más salen**~~ ✅ HECHO (2026-07-09):
   - Enfoque elegido: **empezar vacío y crecer solo** (sin semilla de Kaggle). Cada resultado que el usuario digita en el comparador se guarda como sorteo y alimenta las estadísticas.
   - Datos: `sorteosCache`; Firestore por usuario en `balomio/{uid}/sorteos/{id}` (id = combinación, deduplica) si hay sesión, `localStorage` `sorteos-{juego}` si no. Migración a la nube al iniciar sesión (`migrarSorteosLocales`). Regla Firestore `sorteos` agregada.
   - UI (sección `#estadisticas`): gráfico de barras de frecuencia por número (una sola serie, `--acento`), calientes 🔥 / fríos ❄️ (fríos = balotas huecas para no depender solo del color). Aviso de que NO predice nada.
   - Si más adelante se quiere semilla histórica de Kaggle, basta con precargar docs en la colección `sorteos` con el mismo esquema.
2. El usuario iba a renombrar la carpeta local `azar` → `balomio` (si las rutas de memoria de Claude no coinciden, este archivo es la fuente de verdad).
3. ~~Revisar el botón "Entrar con Google" en móvil~~ ✅ HECHO (2026-07-09): era caché; el versionado lo resolvió. Se verificó con Chrome headless (no había overflow real: el "corte" en screenshots de 390px era artefacto porque headless fuerza ~500px de ancho). Se le agregó el logo "G" multicolor para que sea inequívocamente un botón de Google.

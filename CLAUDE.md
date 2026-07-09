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

1. **Estadísticas de números que más salen** (próxima funcionalidad):
   - Fuente de datos: no hay API; opciones — dataset histórico de Kaggle (https://www.kaggle.com/datasets/jaforero/baloto-colombia) como JSON semilla en el repo + entrada manual de cada nuevo sorteo (guardar resultados digitados en el comparador a Firestore, colección compartida `balomio_sorteos` o por usuario).
   - UI: gráfico de barras de frecuencia por número (por juego), números "calientes/fríos".
   - IMPORTANTE: presentarlo como curiosidad histórica con el aviso de que NO predice nada (cada sorteo es independiente) — el usuario ya aceptó ese enfoque honesto.
2. El usuario iba a renombrar la carpeta local `azar` → `balomio` (si las rutas de memoria de Claude no coinciden, este archivo es la fuente de verdad).
3. Revisar el botón "Entrar con Google" en móvil (se veía sin estilo por caché; verificar tras el fix de versionado).

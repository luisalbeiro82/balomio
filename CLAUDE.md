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
- Botón "Jugar en línea (oficial)": abre https://apuestaaqui.baloto.com/#/seguridad/login (plataforma oficial que vende ambos juegos). `urlJugar` por juego en `JUEGOS`; la etiqueta cambia según el juego activo.

## Funcionalidades actuales (al 2026-07-09)

Generador de tiquetes (con filtro de combinaciones populares) · guardado de apuestas (localStorage / Firestore + login Google) · comparador de aciertos (digitando ganadores) · estadísticas de frecuencia con semilla histórica 2025–2026 (calientes/fríos + gráfico) · botón de jugar en línea. Verificación visual de UI con Chrome headless (`--headless=new`, ojo: fuerza ~500px de ancho, usar ventana ≥500 para que la imagen no recorte).

## Hoja de ruta (pendientes acordados)

1. ~~**Estadísticas de números que más salen**~~ ✅ HECHO (2026-07-09):
   - Enfoque elegido: **empezar vacío y crecer solo** (sin semilla de Kaggle). Cada resultado que el usuario digita en el comparador se guarda como sorteo y alimenta las estadísticas.
   - Datos: `sorteosCache`; Firestore por usuario en `balomio/{uid}/sorteos/{id}` (id = combinación, deduplica) si hay sesión, `localStorage` `sorteos-{juego}` si no. Migración a la nube al iniciar sesión (`migrarSorteosLocales`). Regla Firestore `sorteos` agregada.
   - UI (sección `#estadisticas`): gráfico de barras de frecuencia por número (una sola serie, `--acento`), calientes 🔥 / fríos ❄️ (fríos = balotas huecas para no depender solo del color). Aviso de que NO predice nada.
   - **Semillas históricas añadidas (2026-07-09):** `sorteos-baloto.json` (216 sorteos, ene-2025 → jul-2026; de resultadobaloto.com/resultados.php y resultados-de-loteria.com/baloto/resultados/2025) y `sorteos-miloto.json` (316 sorteos, ene-2025 → jul-2026; de quecayo.com/miloto/historico, paginado ?page=N). Se cargan con `fetch` (mapa `SEMILLAS` = ambos juegos) y se **combinan** con los sorteos del usuario vía `sorteosParaEstadisticas()` (dedup por combinación). La nota los declara como "historial oficial 2025–2026". Para ampliar: regenerar el JSON con más años (esquema `{fecha, numeros[5], superbalota|null}`; MiLoto superbalota=null).
2. El usuario iba a renombrar la carpeta local `azar` → `balomio` (si las rutas de memoria de Claude no coinciden, este archivo es la fuente de verdad).
3. ~~Revisar el botón "Entrar con Google" en móvil~~ ✅ HECHO (2026-07-09): era caché; el versionado lo resolvió. Se verificó con Chrome headless (no había overflow real: el "corte" en screenshots de 390px era artefacto porque headless fuerza ~500px de ancho). Se le agregó el logo "G" multicolor para que sea inequívocamente un botón de Google.

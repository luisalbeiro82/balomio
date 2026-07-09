# 🎱 BaloMio

Generador de tiquetes aleatorios para **Baloto** y **MiLoto** (loterías de Colombia), con guardado de apuestas en la nube y comparador de aciertos.

**App en vivo:** https://generador-suerte.web.app

## Funciones

- **Generador seguro**: números únicos y ordenados usando `crypto.getRandomValues()` con muestreo por rechazo (probabilidad uniforme exacta, como las balotas físicas).
- **Dos juegos**: MiLoto (5 números del 1–39) y Baloto (5 números del 1–43 + Superbalota 1–16).
- **Filtro anti-combinaciones populares**: evita fechas, secuencias y patrones que mucha gente juega, para no compartir el premio si ganas.
- **Mis apuestas**: guarda tus tiquetes con fecha. Con sesión de Google se sincronizan en Firestore entre dispositivos; sin sesión quedan en el navegador.
- **Comparador de aciertos**: digita los números ganadores del sorteo oficial y la app resalta los aciertos de todos tus tiquetes e indica la categoría de premio.
- **PWA-friendly**: manifest e íconos propios para instalar como acceso directo en el celular.

## Tecnología

- HTML, CSS y JavaScript puro (sin frameworks).
- Firebase Hosting, Authentication (Google) y Cloud Firestore.

## Desarrollo

```bash
# Servir localmente
firebase serve --only hosting:generador

# Desplegar
firebase deploy --only hosting:generador
```

## Aviso

Cada sorteo es independiente: ninguna estadística ni patrón aumenta la probabilidad de ganar. Probabilidad del premio mayor — MiLoto: 1 entre 575.757; Baloto: 1 entre 15.401.568. Juega con responsabilidad.

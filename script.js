// ===== Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore, collection, doc, setDoc, deleteDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseApp = initializeApp({
    apiKey: "AIzaSyCYN6knJqdnxOkQKsri4Zog8xFT1bXVJlE",
    authDomain: "mi-todo-list-premium.firebaseapp.com",
    projectId: "mi-todo-list-premium",
    storageBucket: "mi-todo-list-premium.firebasestorage.app",
    messagingSenderId: "782662211269",
    appId: "1:782662211269:web:b2a62865e89d5282f8c2ac"
});
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ===== Configuración de los juegos =====
const JUEGOS = {
    miloto: {
        nombre: "MiLoto",
        cantidad: 5,
        maximo: 39,
        superbalota: null,
        urlResultados: "https://baloto.com/miloto/resultados/",
        urlJugar: "https://apuestaaqui.baloto.com/#/seguridad/login",
        descripcion: "Elige 5 números del 1 al 39. Sorteos: lunes, martes, jueves y viernes 10:00 p.m.",
        // C(39,5)
        probabilidad: "1 entre 575.757",
        premios: { 5: "🏆 ¡Premio mayor!", 4: "🥈 4 aciertos: premio secundario", 3: "🥉 3 aciertos: premio", 2: "🎉 2 aciertos: premio menor" }
    },
    baloto: {
        nombre: "Baloto",
        cantidad: 5,
        maximo: 43,
        superbalota: 16,
        urlResultados: "https://baloto.com/resultados",
        urlJugar: "https://apuestaaqui.baloto.com/#/seguridad/login",
        descripcion: "Elige 5 números del 1 al 43 + Superbalota del 1 al 16. Sorteos: lunes, miércoles y sábados 11:00 p.m.",
        // C(43,5) × 16
        probabilidad: "1 entre 15.401.568",
        premios: {
            "5+S": "🏆 ¡ACUMULADO! 5 aciertos + Superbalota",
            "5": "🥇 5 aciertos: premio mayor secundario",
            "4+S": "🥈 4 + Superbalota",
            "4": "4 aciertos: premio",
            "3+S": "3 + Superbalota: premio",
            "3": "3 aciertos: premio",
            "2+S": "2 + Superbalota: premio",
            "1+S": "1 + Superbalota: premio menor",
            "0+S": "Solo Superbalota: premio menor"
        }
    }
};

let juegoActual = "miloto";
let tiquetesGenerados = []; // [{ numeros: [..], superbalota: n|null }]
let usuario = null;         // usuario de Firebase o null
let apuestasCache = [];     // apuestas guardadas del juego actual
let sorteosCache = [];      // resultados que el usuario registra al comparar (juego actual)
let sorteosSemilla = [];    // historial oficial precargado del juego actual (solo lectura)
let sorteosCompartidos = []; // histórico común aportado por toda la comunidad (juego actual)
let estadoJuego = null;     // { freq, calientes:Set, frios:Set, combos:Set, sumaProm } para anotar tiquetes

// Semilla histórica por juego (archivos servidos junto a la app). Sorteos oficiales
// 2025–2026: Baloto de resultadobaloto.com / resultados-de-loteria.com; MiLoto de quecayo.com.
const SEMILLAS = { baloto: "sorteos-baloto.json", miloto: "sorteos-miloto.json" };
const semillaCache = {};    // juego -> array (para no re-descargar)
const compartidosCache = {}; // juego -> array (histórico común, cacheado por sesión)

// ===== Aleatoriedad segura =====
// Entero uniforme en [1, maximo] usando crypto (sin sesgo, por rechazo)
function enteroAleatorio(maximo) {
    const limite = Math.floor(4294967296 / maximo) * maximo;
    const buffer = new Uint32Array(1);
    let valor;
    do {
        crypto.getRandomValues(buffer);
        valor = buffer[0];
    } while (valor >= limite);
    return (valor % maximo) + 1;
}

// ===== Generación de tiquetes =====
function generarTiquete(juego) {
    const numeros = new Set();
    while (numeros.size < juego.cantidad) {
        numeros.add(enteroAleatorio(juego.maximo));
    }
    return {
        numeros: [...numeros].sort((a, b) => a - b),
        superbalota: juego.superbalota ? enteroAleatorio(juego.superbalota) : null
    };
}

// Combinaciones que mucha gente juega: si ganas con una de estas, compartes el premio
function esCombinacionPopular(numeros) {
    // Todas parecen fechas (día/mes de nacimiento)
    if (numeros.every(n => n <= 31)) return true;
    // 5 números consecutivos (1-2-3-4-5, etc.)
    if (numeros.every((n, i) => i === 0 || n === numeros[i - 1] + 1)) return true;
    // Progresión aritmética (5-10-15-20-25, etc.)
    const paso = numeros[1] - numeros[0];
    if (numeros.every((n, i) => i === 0 || n - numeros[i - 1] === paso)) return true;
    // Todos terminan en el mismo dígito
    if (numeros.every(n => n % 10 === numeros[0] % 10)) return true;
    return false;
}

function generarTiquetes() {
    const juego = JUEGOS[juegoActual];
    const cantidad = Number(document.getElementById("cantidadTiquetes").value);
    const filtrarPopulares = document.getElementById("evitarPopulares").checked;

    const tiquetes = [];
    const vistos = new Set();
    while (tiquetes.length < cantidad) {
        const tiquete = generarTiquete(juego);
        const clave = tiquete.numeros.join("-");
        if (vistos.has(clave)) continue;
        if (filtrarPopulares && esCombinacionPopular(tiquete.numeros)) continue;
        vistos.add(clave);
        tiquetes.push(tiquete);
    }
    return tiquetes;
}

// ===== Apuestas guardadas (Firestore si hay sesión, localStorage si no) =====
function idApuesta(juego, tiquete) {
    return `${juego}_${tiquete.numeros.join("-")}_${tiquete.superbalota ?? "x"}`;
}

function coleccionApuestas() {
    return collection(db, "balomio", usuario.uid, "apuestas");
}

function leerLocales(juego) {
    return JSON.parse(localStorage.getItem(`apuestas-${juego}`) || "[]");
}

async function cargarApuestas() {
    if (usuario) {
        const captura = await getDocs(coleccionApuestas());
        apuestasCache = captura.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(a => a.juego === juegoActual)
            .sort((a, b) => b.fecha.localeCompare(a.fecha));
    } else {
        apuestasCache = leerLocales(juegoActual)
            .map(a => ({ ...a, id: idApuesta(juegoActual, a) }));
    }
}

async function guardarApuesta(tiquete) {
    const id = idApuesta(juegoActual, tiquete);
    if (apuestasCache.some(a => a.id === id)) return false;

    const apuesta = {
        juego: juegoActual,
        numeros: tiquete.numeros,
        superbalota: tiquete.superbalota,
        fecha: new Date().toISOString()
    };
    if (usuario) {
        await setDoc(doc(coleccionApuestas(), id), apuesta);
    } else {
        const locales = leerLocales(juegoActual);
        locales.unshift(apuesta);
        localStorage.setItem(`apuestas-${juegoActual}`, JSON.stringify(locales));
    }
    apuestasCache.unshift({ id, ...apuesta });
    return true;
}

async function borrarApuesta(indice) {
    const apuesta = apuestasCache[indice];
    if (usuario) {
        await deleteDoc(doc(coleccionApuestas(), apuesta.id));
    } else {
        const locales = leerLocales(juegoActual)
            .filter(a => idApuesta(juegoActual, a) !== apuesta.id);
        localStorage.setItem(`apuestas-${juegoActual}`, JSON.stringify(locales));
    }
    apuestasCache.splice(indice, 1);
    mostrarApuestasGuardadas();
}

// ===== Historial de sorteos (para estadísticas) =====
// Cada resultado que el usuario digita en el comparador se guarda aquí y así el
// dataset crece con el uso. Firestore por usuario si hay sesión, localStorage si no.
function coleccionSorteos() {
    return collection(db, "balomio", usuario.uid, "sorteos");
}

function leerSorteosLocales(juego) {
    return JSON.parse(localStorage.getItem(`sorteos-${juego}`) || "[]");
}

async function cargarSorteos() {
    if (usuario) {
        const captura = await getDocs(coleccionSorteos());
        sorteosCache = captura.docs
            .map(d => d.data())
            .filter(s => s.juego === juegoActual);
    } else {
        sorteosCache = leerSorteosLocales(juegoActual);
    }
}

// Carga (una sola vez) la semilla histórica del juego; si no hay o falla, arreglo vacío
async function cargarSemilla(juego) {
    if (!SEMILLAS[juego]) return [];
    if (semillaCache[juego]) return semillaCache[juego];
    try {
        const resp = await fetch(SEMILLAS[juego]);
        semillaCache[juego] = resp.ok ? await resp.json() : [];
    } catch (error) {
        console.error("No se pudo cargar la semilla histórica:", error);
        semillaCache[juego] = [];
    }
    return semillaCache[juego];
}

// ===== Histórico compartido (colección pública balomio_sorteos) =====
// Lo que cualquiera digita al comparar enriquece un histórico común, de lectura
// pública. Solo usuarios autenticados aportan (escritura validada por reglas).
function coleccionCompartida() {
    return collection(db, "balomio_sorteos");
}

async function cargarCompartidos(juego) {
    if (compartidosCache[juego]) return compartidosCache[juego];
    try {
        const captura = await getDocs(query(coleccionCompartida(), where("juego", "==", juego)));
        compartidosCache[juego] = captura.docs.map(d => d.data());
    } catch (error) {
        console.error("No se pudieron cargar los sorteos compartidos:", error);
        compartidosCache[juego] = [];
    }
    return compartidosCache[juego];
}

async function persistirCompartido(sorteo) {
    if (!usuario) return; // solo usuarios autenticados aportan al histórico común
    const id = idApuesta(sorteo.juego, sorteo);
    await setDoc(doc(coleccionCompartida(), id), sorteo);
    const arr = compartidosCache[sorteo.juego] || [];
    if (!arr.some(s => idApuesta(sorteo.juego, s) === id)) arr.push(sorteo);
    compartidosCache[sorteo.juego] = arr;
    if (sorteo.juego === juegoActual) sorteosCompartidos = arr;
}

// Une semilla histórica + histórico común + sorteos del usuario, sin duplicar combinaciones
function sorteosParaEstadisticas() {
    const mapa = new Map();
    for (const s of sorteosSemilla) mapa.set(idApuesta(juegoActual, s), s);
    for (const s of sorteosCompartidos) mapa.set(idApuesta(juegoActual, s), s);
    for (const s of sorteosCache) mapa.set(idApuesta(juegoActual, s), s);
    return [...mapa.values()];
}

// Persiste un sorteo (deduplica por combinación: reescribir el mismo resultado no lo cuenta doble)
async function persistirSorteo(sorteo) {
    const id = idApuesta(sorteo.juego, sorteo);
    if (usuario) {
        await setDoc(doc(coleccionSorteos(), id), sorteo);
    } else {
        const locales = leerSorteosLocales(sorteo.juego)
            .filter(s => idApuesta(sorteo.juego, s) !== id);
        locales.unshift(sorteo);
        localStorage.setItem(`sorteos-${sorteo.juego}`, JSON.stringify(locales));
    }
}

async function migrarSorteosLocales() {
    for (const juego of Object.keys(JUEGOS)) {
        const locales = leerSorteosLocales(juego);
        for (const s of locales) {
            await setDoc(doc(coleccionSorteos(), idApuesta(juego, s)), {
                juego,
                numeros: s.numeros,
                superbalota: s.superbalota ?? null,
                fecha: s.fecha || new Date().toISOString()
            });
        }
        if (locales.length) localStorage.removeItem(`sorteos-${juego}`);
    }
}

// Al iniciar sesión, sube las apuestas locales a Firestore y limpia el navegador
async function migrarLocalesANube() {
    for (const juego of Object.keys(JUEGOS)) {
        const locales = leerLocales(juego);
        for (const apuesta of locales) {
            const id = idApuesta(juego, apuesta);
            await setDoc(doc(coleccionApuestas(), id), {
                juego,
                numeros: apuesta.numeros,
                superbalota: apuesta.superbalota ?? null,
                fecha: apuesta.fecha || new Date().toISOString()
            });
        }
        if (locales.length) localStorage.removeItem(`apuestas-${juego}`);
    }
}

// ===== Interfaz =====
function pintarBalota(numero, esSuper = false) {
    const li = document.createElement("li");
    li.className = esSuper ? "balota super" : "balota";
    li.textContent = String(numero).padStart(2, "0");
    return li;
}

function crearTarjetaTiquete(tiquete, titulo) {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta tiquete";

    const encabezado = document.createElement("div");
    encabezado.className = "encabezado-tiquete";
    const etiqueta = document.createElement("span");
    etiqueta.className = "etiqueta";
    etiqueta.textContent = titulo;
    encabezado.appendChild(etiqueta);
    tarjeta.appendChild(encabezado);

    const lista = document.createElement("ul");
    lista.className = "balotas";
    tiquete.numeros.forEach(n => lista.appendChild(pintarBalota(n)));
    if (tiquete.superbalota !== null && tiquete.superbalota !== undefined) {
        lista.appendChild(pintarBalota(tiquete.superbalota, true));
    }
    tarjeta.appendChild(lista);

    const aciertos = document.createElement("p");
    aciertos.className = "aciertos";
    tarjeta.appendChild(aciertos);

    return tarjeta;
}

// Anota un tiquete contra el histórico (curiosidad; no cambia la probabilidad)
function anotarTiquete(tiquete) {
    if (!estadoJuego) return "";
    const cal = tiquete.numeros.filter(n => estadoJuego.calientes.has(n)).length;
    const fri = tiquete.numeros.filter(n => estadoJuego.frios.has(n)).length;
    const suma = tiquete.numeros.reduce((a, b) => a + b, 0);
    const yaSalio = estadoJuego.combos.has(tiquete.numeros.join("-"));
    const partes = [];
    if (cal) partes.push(`🔥 ${cal} caliente${cal > 1 ? "s" : ""}`);
    if (fri) partes.push(`❄️ ${fri} frío${fri > 1 ? "s" : ""}`);
    partes.push(`suma ${suma} (prom. ${estadoJuego.sumaProm})`);
    partes.push(yaSalio ? "⚠️ combinación ya salió antes" : "combinación nunca vista");
    return partes.join(" · ");
}

function mostrarTiquetes(tiquetes) {
    const zona = document.getElementById("zonaTiquetes");
    zona.innerHTML = "";
    tiquetes.forEach((tiquete, indice) => {
        const tarjeta = crearTarjetaTiquete(tiquete, `Tiquete ${indice + 1}`);

        const texto = anotarTiquete(tiquete);
        if (texto) {
            const nota = document.createElement("p");
            nota.className = "nota-historico";
            nota.title = "Dato histórico de curiosidad. Cada sorteo es independiente: esto NO cambia tu probabilidad.";
            nota.textContent = texto;
            tarjeta.insertBefore(nota, tarjeta.querySelector(".aciertos"));
        }

        const botonCompartir = document.createElement("button");
        botonCompartir.className = "boton-compartir";
        botonCompartir.textContent = "📤 Compartir";
        botonCompartir.addEventListener("click", () => compartirTiquete(tiquete));
        tarjeta.appendChild(botonCompartir);

        const botonGuardar = document.createElement("button");
        botonGuardar.className = "boton-guardar";
        botonGuardar.textContent = "💾 Guardar";
        botonGuardar.addEventListener("click", async () => {
            botonGuardar.disabled = true;
            try {
                botonGuardar.textContent = (await guardarApuesta(tiquete)) ? "✓ Guardada" : "Ya guardada";
                mostrarApuestasGuardadas();
            } catch (error) {
                console.error(error);
                botonGuardar.textContent = "Error, reintenta";
                botonGuardar.disabled = false;
            }
        });
        tarjeta.querySelector(".encabezado-tiquete").appendChild(botonGuardar);

        zona.appendChild(tarjeta);
    });
}

function mostrarApuestasGuardadas() {
    const seccion = document.getElementById("seccionGuardadas");
    const zona = document.getElementById("zonaGuardadas");
    document.getElementById("origenGuardadas").textContent =
        usuario ? "· en la nube ☁" : "· solo en este dispositivo";
    seccion.classList.toggle("oculto", apuestasCache.length === 0);
    zona.innerHTML = "";

    apuestasCache.forEach((apuesta, indice) => {
        const fecha = new Date(apuesta.fecha).toLocaleDateString("es-CO",
            { day: "numeric", month: "short", year: "numeric" });
        const tarjeta = crearTarjetaTiquete(apuesta, `Guardada · ${fecha}`);

        const botonBorrar = document.createElement("button");
        botonBorrar.className = "boton-borrar";
        botonBorrar.setAttribute("aria-label", "Borrar apuesta");
        botonBorrar.textContent = "🗑";
        botonBorrar.addEventListener("click", () => borrarApuesta(indice));
        tarjeta.querySelector(".encabezado-tiquete").appendChild(botonBorrar);

        zona.appendChild(tarjeta);
    });

    // Mostrar el comparador si hay algo que comparar
    if (apuestasCache.length > 0 || tiquetesGenerados.length > 0) {
        document.getElementById("comparador").classList.remove("oculto");
    }
}

async function actualizarJuego() {
    const juego = JUEGOS[juegoActual];
    document.getElementById("descripcionJuego").textContent = juego.descripcion;
    document.getElementById("probabilidad").textContent =
        `Probabilidad del premio mayor en ${juego.nombre}: ${juego.probabilidad}.`;

    document.querySelectorAll(".tab").forEach(tab =>
        tab.classList.toggle("activo", tab.dataset.juego === juegoActual));

    // Ajustar entradas del comparador y recuperar los últimos ganadores guardados
    const guardados = JSON.parse(localStorage.getItem(`ganadores-${juegoActual}`) || "{}");
    document.querySelectorAll("#entradasGanadores .entrada-num:not(.entrada-super)").forEach((entrada, i) => {
        entrada.max = juego.maximo;
        entrada.value = guardados.numeros?.[i] ?? "";
    });
    const entradaSuper = document.querySelector("#entradasGanadores .entrada-super");
    entradaSuper.classList.toggle("oculto", !juego.superbalota);
    entradaSuper.value = guardados.superbalota ?? "";

    // Registro manual: ajustar máximos, mostrar/ocultar superbalota y limpiar
    document.querySelectorAll(".entrada-manual").forEach(e => { e.max = juego.maximo; e.value = ""; });
    const superManual = document.querySelector(".entrada-manual-super");
    superManual.classList.toggle("oculto", !juego.superbalota);
    superManual.value = "";
    document.getElementById("resultadoManual").innerHTML = "";

    document.getElementById("enlaceResultados").href = juego.urlResultados;

    const jugar = document.getElementById("jugarEnLinea");
    jugar.href = juego.urlJugar;
    jugar.textContent = `🎟️ Jugar ${juego.nombre} en línea (oficial) ↗`;

    document.body.dataset.juego = juegoActual;
    document.getElementById("zonaTiquetes").innerHTML = "";
    document.getElementById("comparador").classList.add("oculto");
    document.getElementById("resultadoComparacion").innerHTML = "";
    tiquetesGenerados = [];

    // Estas no dependen de la red: se muestran de inmediato
    mostrarProximoSorteo();
    actualizarBotonRecordatorio();

    await cargarApuestas();
    mostrarApuestasGuardadas();
    sorteosSemilla = await cargarSemilla(juegoActual);
    await cargarSorteos();
    mostrarEstadisticas(); // ya muestra (y deja estadoJuego listo) con semilla + tus sorteos

    // El histórico común llega por red: cuando esté, refresca sin bloquear lo anterior
    const juegoAlPedir = juegoActual;
    cargarCompartidos(juegoActual).then(arr => {
        if (juegoAlPedir !== juegoActual) return; // el usuario ya cambió de juego
        sorteosCompartidos = arr;
        mostrarEstadisticas();
    });
}

// ===== Estadísticas de frecuencia =====
function calcularFrecuencias(sorteos, maximo) {
    const freq = new Array(maximo + 1).fill(0);
    sorteos.forEach(s => (s.numeros || []).forEach(n => {
        if (n >= 1 && n <= maximo) freq[n]++;
    }));
    return freq; // freq[num], índices 1..maximo
}

function crearChip(num, veces, esFrio) {
    const chip = document.createElement("div");
    chip.className = "chip";
    const balota = document.createElement("div");
    balota.className = esFrio ? "mini-balota frio" : "mini-balota";
    balota.textContent = String(num).padStart(2, "0");
    const detalle = document.createElement("small");
    detalle.textContent = `${veces} ${veces === 1 ? "vez" : "veces"}`;
    chip.appendChild(balota);
    chip.appendChild(detalle);
    return chip;
}

function grupoCalientesFrios(titulo, lista, esFrio) {
    const grupo = document.createElement("div");
    grupo.className = "grupo-cf";
    const h = document.createElement("h3");
    h.textContent = titulo;
    grupo.appendChild(h);
    const chips = document.createElement("div");
    chips.className = "chips";
    lista.forEach(({ num, veces }) => chips.appendChild(crearChip(num, veces, esFrio)));
    grupo.appendChild(chips);
    return grupo;
}

function mostrarEstadisticas() {
    const juego = JUEGOS[juegoActual];
    const seccion = document.getElementById("estadisticas");
    const sorteos = sorteosParaEstadisticas();
    const n = sorteos.length;

    if (n === 0) {
        seccion.classList.add("oculto");
        return;
    }
    seccion.classList.remove("oculto");

    const hayHistorial = sorteosSemilla.length > 0;
    document.getElementById("notaEstadisticas").textContent =
        `Basado en ${n} sorteos de ${juego.nombre}` +
        (hayHistorial
            ? `: historial oficial 2025–2026 más los que tú y la comunidad registran al comparar.`
            : ` registrados al comparar. Se enriquece con cada resultado nuevo.`);

    const freq = calcularFrecuencias(sorteos, juego.maximo);
    const maxFreq = Math.max(1, ...freq);

    // Gráfico de barras: frecuencia por número
    const grafico = document.getElementById("graficoFrecuencia");
    grafico.innerHTML = "";
    for (let num = 1; num <= juego.maximo; num++) {
        const col = document.createElement("div");
        col.className = "col-freq";
        col.title = `Número ${num}: ${freq[num]} ${freq[num] === 1 ? "vez" : "veces"}`;

        const pista = document.createElement("div");
        pista.className = "pista-freq";
        const barra = document.createElement("div");
        barra.className = "barra-freq";
        barra.style.height = `${(freq[num] / maxFreq) * 100}%`;
        pista.appendChild(barra);

        const etq = document.createElement("span");
        etq.className = "num-freq";
        etq.textContent = num;

        col.appendChild(pista);
        col.appendChild(etq);
        grafico.appendChild(col);
    }

    // Calientes (más frecuentes) y fríos (menos frecuentes)
    const ordenados = [];
    for (let num = 1; num <= juego.maximo; num++) ordenados.push({ num, veces: freq[num] });
    ordenados.sort((a, b) => b.veces - a.veces || a.num - b.num);

    const calientes = ordenados.slice(0, 6);
    const frios = ordenados.slice(-6).reverse();

    const cont = document.getElementById("calientesFrios");
    cont.innerHTML = "";
    cont.appendChild(grupoCalientesFrios("🔥 Más frecuentes", calientes, false));
    cont.appendChild(grupoCalientesFrios("❄️ Menos frecuentes", frios, true));

    // Estado del juego (para anotar los tiquetes generados contra el histórico)
    const sumas = sorteos.map(s => s.numeros.reduce((a, b) => a + b, 0));
    estadoJuego = {
        freq,
        calientes: new Set(calientes.map(c => c.num)),
        frios: new Set(frios.map(c => c.num)),
        combos: new Set(sorteos.map(s => s.numeros.join("-"))),
        sumaProm: Math.round(sumas.reduce((a, b) => a + b, 0) / (sumas.length || 1))
    };

    mostrarAnalisis(sorteos, juego);
}

// ===== Análisis del histórico (pares/impares, altos/bajos, decenas, primos, suma) =====
function esPrimo(n) {
    if (n < 2) return false;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
    return true;
}

// Una fila: etiqueta + barra proporcional + valor y porcentaje (texto, no solo color)
function filaAnalisis(etiqueta, valor, total, hueco = false) {
    const fila = document.createElement("div");
    fila.className = "fila-analisis";
    const et = document.createElement("span");
    et.className = "et-analisis";
    et.textContent = etiqueta;
    const pista = document.createElement("div");
    pista.className = "pista-analisis";
    const barra = document.createElement("div");
    barra.className = hueco ? "barra-analisis tenue" : "barra-analisis";
    barra.style.width = `${total ? (valor / total) * 100 : 0}%`;
    pista.appendChild(barra);
    const val = document.createElement("span");
    val.className = "val-analisis";
    const pct = total ? Math.round((valor / total) * 100) : 0;
    val.textContent = `${valor} · ${pct}%`;
    fila.appendChild(et);
    fila.appendChild(pista);
    fila.appendChild(val);
    return fila;
}

function bloqueAnalisis(titulo, filas) {
    const bloque = document.createElement("div");
    bloque.className = "bloque-analisis";
    const h = document.createElement("h4");
    h.textContent = titulo;
    bloque.appendChild(h);
    filas.forEach(f => bloque.appendChild(f));
    return bloque;
}

function mostrarAnalisis(sorteos, juego) {
    const cont = document.getElementById("analisisHistorico");
    if (!cont) return;
    cont.innerHTML = "";

    // Todas las balotas principales (sin superbalota) de todos los sorteos
    const balls = [];
    sorteos.forEach(s => (s.numeros || []).forEach(n => balls.push(n)));
    const total = balls.length;
    if (!total) return;

    const pares = balls.filter(n => n % 2 === 0).length;
    const primos = balls.filter(esPrimo).length;

    const t = Math.ceil(juego.maximo / 3);
    const bajos = balls.filter(n => n <= t).length;
    const altos = balls.filter(n => n > 2 * t).length;
    const medios = total - bajos - altos;

    cont.appendChild(bloqueAnalisis("Pares e impares", [
        filaAnalisis("Pares", pares, total),
        filaAnalisis("Impares", total - pares, total, true)
    ]));

    cont.appendChild(bloqueAnalisis(`Bajos (1–${t}), medios y altos (${2 * t + 1}–${juego.maximo})`, [
        filaAnalisis("Bajos", bajos, total),
        filaAnalisis("Medios", medios, total, true),
        filaAnalisis("Altos", altos, total)
    ]));

    cont.appendChild(bloqueAnalisis("Primos y no primos", [
        filaAnalisis("Primos", primos, total),
        filaAnalisis("No primos", total - primos, total, true)
    ]));

    // Decenas (1–9, 10–19, 20–29, 30–39, 40–43)
    const decenas = {};
    balls.forEach(n => { const d = Math.floor(n / 10); decenas[d] = (decenas[d] || 0) + 1; });
    const rangos = { 0: "1–9", 1: "10–19", 2: "20–29", 3: "30–39", 4: "40–43" };
    const filasDec = Object.keys(rangos)
        .filter(d => d * 10 <= juego.maximo)
        .map((d, i) => filaAnalisis(rangos[d], decenas[d] || 0, total, i % 2 === 1));
    cont.appendChild(bloqueAnalisis("Por decenas", filasDec));

    // Suma de la combinación
    const sumas = sorteos.map(s => s.numeros.reduce((a, b) => a + b, 0));
    const prom = Math.round(sumas.reduce((a, b) => a + b, 0) / sumas.length);
    const nota = document.createElement("p");
    nota.className = "nota-suma";
    nota.textContent = `Suma de los 5 números: promedio ${prom} (rango histórico ${Math.min(...sumas)}–${Math.max(...sumas)}).`;
    cont.appendChild(nota);
}

// ===== Registro manual de apuestas jugadas =====
async function guardarApuestaManual() {
    const juego = JUEGOS[juegoActual];
    const entradas = [...document.querySelectorAll(".entrada-manual")];
    const numeros = entradas.map(e => Number(e.value));
    const salida = document.getElementById("resultadoManual");

    if (numeros.some(n => !n || n < 1 || n > juego.maximo)) {
        salida.innerHTML = `<p class="error">Escribe los 5 números (entre 1 y ${juego.maximo}).</p>`;
        return;
    }
    if (new Set(numeros).size !== 5) {
        salida.innerHTML = `<p class="error">Los números no pueden repetirse.</p>`;
        return;
    }

    let superbalota = null;
    if (juego.superbalota) {
        superbalota = Number(document.querySelector(".entrada-manual-super").value);
        if (!superbalota || superbalota < 1 || superbalota > juego.superbalota) {
            salida.innerHTML = `<p class="error">Escribe la Superbalota (entre 1 y ${juego.superbalota}).</p>`;
            return;
        }
    }

    const tiquete = { numeros: [...numeros].sort((a, b) => a - b), superbalota };
    try {
        const nueva = await guardarApuesta(tiquete);
        if (nueva) {
            salida.innerHTML = `<p class="veredicto">✓ Guardada en «Mis apuestas». Puedes registrar otra.</p>`;
            entradas.forEach(e => (e.value = ""));
            const s = document.querySelector(".entrada-manual-super");
            if (s) s.value = "";
            entradas[0].focus();
            mostrarApuestasGuardadas();
        } else {
            salida.innerHTML = `<p class="error">Esa apuesta ya estaba guardada.</p>`;
        }
    } catch (error) {
        console.error(error);
        salida.innerHTML = `<p class="error">Error al guardar, reintenta.</p>`;
    }
}

// ===== Comparador de aciertos =====
function categoriaPremio(juego, aciertos, acertoSuper) {
    if (juego.superbalota) {
        const clave = acertoSuper ? `${aciertos}+S` : String(aciertos);
        return juego.premios[clave] || "Sin premio esta vez";
    }
    return juego.premios[aciertos] || "Sin premio esta vez";
}

// Compara un grupo de tiquetes con sus tarjetas en pantalla; devuelve el mejor puntaje
function compararGrupo(tiquetes, tarjetas, juego, conjuntoGanador, superGanadora) {
    let mejor = { puntaje: -1, aciertos: 0, acertoSuper: false };

    tiquetes.forEach((tiquete, i) => {
        const aciertos = tiquete.numeros.filter(n => conjuntoGanador.has(n)).length;
        const acertoSuper = juego.superbalota ? tiquete.superbalota === superGanadora : false;

        const balotas = tarjetas[i].querySelectorAll(".balota");
        tiquete.numeros.forEach((n, j) =>
            balotas[j].classList.toggle("acierto", conjuntoGanador.has(n)));
        if (juego.superbalota) {
            balotas[5].classList.toggle("acierto", acertoSuper);
        }

        tarjetas[i].querySelector(".aciertos").textContent = juego.superbalota
            ? `${aciertos} aciertos${acertoSuper ? " + Superbalota ⭐" : ""}`
            : `${aciertos} aciertos`;

        const puntaje = aciertos * 2 + (acertoSuper ? 1 : 0);
        if (puntaje > mejor.puntaje) mejor = { puntaje, aciertos, acertoSuper };
    });

    return mejor;
}

function compararTiquetes() {
    const juego = JUEGOS[juegoActual];
    const entradas = [...document.querySelectorAll("#entradasGanadores .entrada-num:not(.entrada-super)")];
    const ganadores = entradas.map(e => Number(e.value));
    const resultado = document.getElementById("resultadoComparacion");

    if (ganadores.some(n => !n || n < 1 || n > juego.maximo)) {
        resultado.innerHTML = `<p class="error">Escribe los 5 números ganadores (entre 1 y ${juego.maximo}).</p>`;
        return;
    }
    if (new Set(ganadores).size !== 5) {
        resultado.innerHTML = `<p class="error">Los números ganadores no pueden repetirse.</p>`;
        return;
    }

    let superGanadora = null;
    if (juego.superbalota) {
        superGanadora = Number(document.querySelector("#entradasGanadores .entrada-super").value);
        if (!superGanadora || superGanadora < 1 || superGanadora > juego.superbalota) {
            resultado.innerHTML = `<p class="error">Escribe la Superbalota (entre 1 y ${juego.superbalota}).</p>`;
            return;
        }
    }

    localStorage.setItem(`ganadores-${juegoActual}`,
        JSON.stringify({ numeros: ganadores, superbalota: superGanadora }));

    // Registrar el resultado para las estadísticas (crece con cada comparación)
    const sorteo = {
        juego: juegoActual,
        numeros: ganadores,
        superbalota: superGanadora,
        fecha: new Date().toISOString()
    };
    if (!sorteosCache.some(s => idApuesta(juegoActual, s) === idApuesta(juegoActual, sorteo))) {
        sorteosCache.unshift(sorteo);
    }
    mostrarEstadisticas();
    persistirSorteo(sorteo).catch(console.error);
    persistirCompartido(sorteo).catch(console.error);

    const conjuntoGanador = new Set(ganadores);

    const mejorGenerados = compararGrupo(
        tiquetesGenerados,
        document.querySelectorAll("#zonaTiquetes .tiquete"),
        juego, conjuntoGanador, superGanadora);

    const mejorGuardadas = compararGrupo(
        apuestasCache,
        document.querySelectorAll("#zonaGuardadas .tiquete"),
        juego, conjuntoGanador, superGanadora);

    const mejor = mejorGenerados.puntaje >= mejorGuardadas.puntaje ? mejorGenerados : mejorGuardadas;
    const mensaje = mejor.puntaje < 0
        ? "No hay tiquetes para comparar. Genera o guarda alguno primero."
        : `Mejor tiquete: ${categoriaPremio(juego, mejor.aciertos, mejor.acertoSuper)}`;
    resultado.innerHTML = `<p class="veredicto">${mensaje}</p>`;
}

// ===== Compartir / exportar tiquetes =====
function textoTiquete(tiquete) {
    const juego = JUEGOS[juegoActual];
    const nums = tiquete.numeros.map(n => String(n).padStart(2, "0")).join(" - ");
    const sb = tiquete.superbalota != null ? ` + Superbalota ${String(tiquete.superbalota).padStart(2, "0")}` : "";
    return `🎟️ Mi tiquete ${juego.nombre} (BaloMio):\n${nums}${sb}\n\nGenera los tuyos: https://generador-suerte.web.app`;
}

// Dibuja el tiquete en un canvas para compartirlo como imagen
function dibujarTiquete(tiquete) {
    const juego = JUEGOS[juegoActual];
    const r = 46, gap = 16, padX = 40, padTop = 118, padBottom = 54, escala = 2;
    const cuenta = tiquete.numeros.length + (tiquete.superbalota != null ? 1 : 0);
    const w = padX * 2 + cuenta * (r * 2) + (cuenta - 1) * gap;
    const h = padTop + r * 2 + padBottom;
    const canvas = document.createElement("canvas");
    canvas.width = w * escala;
    canvas.height = h * escala;
    const ctx = canvas.getContext("2d");
    ctx.scale(escala, escala);

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#0d1b2a");
    grad.addColorStop(1, "#23303f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const acento = juegoActual === "baloto" ? "#e63946" : "#00b4a0";
    const acentoOsc = juegoActual === "baloto" ? "#b32734" : "#00877a";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f2f5f7";
    ctx.font = "bold 34px 'Segoe UI', sans-serif";
    ctx.fillText("BaloMio", padX, 44);
    ctx.fillStyle = acento;
    ctx.font = "600 22px 'Segoe UI', sans-serif";
    ctx.fillText(`${juego.nombre} · tiquete aleatorio`, padX, 82);

    let x = padX + r;
    const y = padTop + r;
    const bola = (num, c1, c2) => {
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
        g.addColorStop(0, c1);
        g.addColorStop(1, c2);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 30px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(num).padStart(2, "0"), x, y + 1);
        ctx.textAlign = "left";
        x += r * 2 + gap;
    };
    tiquete.numeros.forEach(n => bola(n, acento, acentoOsc));
    if (tiquete.superbalota != null) bola(tiquete.superbalota, "#f5a623", "#c47d0e");

    ctx.fillStyle = "#a8b4bd";
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText("generador-suerte.web.app", padX, h - 32);
    return canvas;
}

async function compartirTiquete(tiquete) {
    const texto = textoTiquete(tiquete);
    const canvas = dibujarTiquete(tiquete);
    try {
        const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
        const archivo = new File([blob], "tiquete-balomio.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
            await navigator.share({ files: [archivo], text: texto });
            return;
        }
        if (navigator.share) {
            await navigator.share({ text: texto });
            return;
        }
    } catch (error) {
        if (error && error.name === "AbortError") return; // el usuario canceló
        console.error(error);
    }
    // Respaldo (escritorio o navegadores sin Web Share): descarga imagen + copia texto
    try {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "tiquete-balomio.png";
        a.click();
        if (navigator.clipboard) await navigator.clipboard.writeText(texto);
        alert("Imagen descargada y texto copiado. Ya puedes pegarlo en WhatsApp.");
    } catch (error) {
        console.error(error);
    }
}

// ===== Próximo sorteo y recordatorio =====
// getDay(): 0=domingo … 6=sábado. Hora local (Colombia, sin horario de verano).
const DIAS_SORTEO = {
    miloto: { dias: [1, 2, 4, 5], hora: 22, nombreHora: "10:00 p.m." },
    baloto: { dias: [1, 3, 6], hora: 23, nombreHora: "11:00 p.m." }
};
const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function proximoSorteo(juego) {
    const cfg = DIAS_SORTEO[juego];
    const ahora = new Date();
    for (let i = 0; i < 8; i++) {
        const d = new Date(ahora);
        d.setDate(ahora.getDate() + i);
        d.setHours(cfg.hora, 0, 0, 0);
        if (cfg.dias.includes(d.getDay()) && d > ahora) return d;
    }
    return null;
}

function mostrarProximoSorteo() {
    const el = document.getElementById("proximoSorteo");
    if (!el) return;
    const cfg = DIAS_SORTEO[juegoActual];
    const prox = proximoSorteo(juegoActual);
    if (!prox) { el.textContent = ""; return; }
    const ms = prox - new Date();
    const dias = Math.floor(ms / 86400000);
    const hrs = Math.floor((ms % 86400000) / 3600000);
    const falta = dias > 0 ? `en ${dias}d ${hrs}h` : (hrs > 0 ? `en ${hrs}h` : "muy pronto");
    el.textContent = `⏰ Próximo sorteo de ${JUEGOS[juegoActual].nombre}: ${NOMBRE_DIA[prox.getDay()]} ${cfg.nombreHora} (${falta})`;
}

function actualizarBotonRecordatorio() {
    const btn = document.getElementById("botonRecordatorio");
    if (!btn) return;
    const activo = localStorage.getItem(`recordatorio-${juegoActual}`) === "1";
    btn.textContent = activo ? "🔔 Recordatorio activado" : "🔕 Recordarme";
    btn.classList.toggle("activo", activo);
}

async function alternarRecordatorio() {
    const clave = `recordatorio-${juegoActual}`;
    if (localStorage.getItem(clave) === "1") {
        localStorage.removeItem(clave);
        actualizarBotonRecordatorio();
        return;
    }
    if ("Notification" in window) {
        let permiso = Notification.permission;
        if (permiso === "default") permiso = await Notification.requestPermission();
        if (permiso !== "granted") {
            alert("Activa las notificaciones del navegador para recibir el recordatorio de los días de sorteo.");
            return;
        }
    }
    localStorage.setItem(clave, "1");
    actualizarBotonRecordatorio();
    notificarSiEsDiaDeSorteo(true);
}

// Notifica si hoy hay sorteo de algún juego con recordatorio activo (al abrir la app)
function notificarSiEsDiaDeSorteo(forzar = false) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const hoy = new Date();
    for (const juego of Object.keys(DIAS_SORTEO)) {
        if (localStorage.getItem(`recordatorio-${juego}`) !== "1") continue;
        if (!DIAS_SORTEO[juego].dias.includes(hoy.getDay())) continue;
        if (!forzar && localStorage.getItem(`avisado-${juego}`) === hoy.toDateString()) continue;
        new Notification("🎰 BaloMio", {
            body: `Hoy hay sorteo de ${JUEGOS[juego].nombre} a las ${DIAS_SORTEO[juego].nombreHora}. ¡Genera y juega tus números!`,
            icon: "icon-192.png"
        });
        localStorage.setItem(`avisado-${juego}`, hoy.toDateString());
    }
}

// ===== Sesión =====
function actualizarInterfazUsuario() {
    document.getElementById("botonLogin").classList.toggle("oculto", !!usuario);
    document.getElementById("infoUsuario").classList.toggle("oculto", !usuario);
    if (usuario) {
        document.getElementById("fotoUsuario").src = usuario.photoURL || "icon-192.png";
        document.getElementById("nombreUsuario").textContent =
            (usuario.displayName || usuario.email || "").split(" ")[0];
    }
}

document.getElementById("botonLogin").addEventListener("click", async () => {
    const proveedor = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, proveedor);
    } catch (error) {
        // Algunos navegadores móviles bloquean el popup: usar redirección
        if (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment") {
            await signInWithRedirect(auth, proveedor);
        } else if (error.code !== "auth/popup-closed-by-user" && error.code !== "auth/cancelled-popup-request") {
            console.error(error);
            alert("No se pudo iniciar sesión. Intenta de nuevo.");
        }
    }
});

document.getElementById("botonLogout").addEventListener("click", () => signOut(auth));

getRedirectResult(auth).catch(console.error);

onAuthStateChanged(auth, async usuarioFirebase => {
    usuario = usuarioFirebase;
    actualizarInterfazUsuario();
    try {
        if (usuario) {
            await migrarLocalesANube();
            await migrarSorteosLocales();
        }
        await cargarApuestas();
        sorteosSemilla = await cargarSemilla(juegoActual);
        await cargarSorteos();
        sorteosCompartidos = await cargarCompartidos(juegoActual);
    } catch (error) {
        console.error("Error sincronizando datos:", error);
    }
    mostrarApuestasGuardadas();
    mostrarEstadisticas();
});

// ===== Eventos =====
document.getElementById("tabs").addEventListener("click", evento => {
    const tab = evento.target.closest(".tab");
    if (!tab || tab.dataset.juego === juegoActual) return;
    juegoActual = tab.dataset.juego;
    actualizarJuego();
});

document.getElementById("generar").addEventListener("click", () => {
    tiquetesGenerados = generarTiquetes();
    mostrarTiquetes(tiquetesGenerados);
    document.getElementById("comparador").classList.remove("oculto");
    document.getElementById("resultadoComparacion").innerHTML = "";
});

document.getElementById("comparar").addEventListener("click", compararTiquetes);

document.getElementById("botonRecordatorio").addEventListener("click", alternarRecordatorio);

document.getElementById("toggleManual").addEventListener("click", () => {
    const form = document.getElementById("formManual");
    const abierto = form.classList.toggle("oculto") === false;
    document.getElementById("toggleManual").setAttribute("aria-expanded", String(abierto));
    if (abierto) document.querySelector(".entrada-manual").focus();
});

document.getElementById("guardarManual").addEventListener("click", guardarApuestaManual);

// ===== PWA: service worker para funcionar offline e instalarse =====
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(err =>
            console.warn("No se pudo registrar el service worker:", err));
    });
}

actualizarJuego();
notificarSiEsDiaDeSorteo();

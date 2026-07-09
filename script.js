// ===== Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore, collection, doc, setDoc, deleteDoc, getDocs
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
let sorteosCache = [];      // resultados oficiales registrados al comparar (juego actual)

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

function mostrarTiquetes(tiquetes) {
    const zona = document.getElementById("zonaTiquetes");
    zona.innerHTML = "";
    tiquetes.forEach((tiquete, indice) => {
        const tarjeta = crearTarjetaTiquete(tiquete, `Tiquete ${indice + 1}`);

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
    document.querySelectorAll(".entrada-num:not(.entrada-super)").forEach((entrada, i) => {
        entrada.max = juego.maximo;
        entrada.value = guardados.numeros?.[i] ?? "";
    });
    const entradaSuper = document.querySelector(".entrada-super");
    entradaSuper.classList.toggle("oculto", !juego.superbalota);
    entradaSuper.value = guardados.superbalota ?? "";

    document.getElementById("enlaceResultados").href = juego.urlResultados;

    document.body.dataset.juego = juegoActual;
    document.getElementById("zonaTiquetes").innerHTML = "";
    document.getElementById("comparador").classList.add("oculto");
    document.getElementById("resultadoComparacion").innerHTML = "";
    tiquetesGenerados = [];

    await cargarApuestas();
    mostrarApuestasGuardadas();
    await cargarSorteos();
    mostrarEstadisticas();
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
    const n = sorteosCache.length;

    if (n === 0) {
        seccion.classList.add("oculto");
        return;
    }
    seccion.classList.remove("oculto");

    document.getElementById("notaEstadisticas").textContent =
        `Basado en ${n} sorteo${n === 1 ? "" : "s"} de ${juego.nombre} que has registrado al comparar. ` +
        `Se enriquece cada vez que digitas un resultado nuevo.`;

    const freq = calcularFrecuencias(sorteosCache, juego.maximo);
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

    const cont = document.getElementById("calientesFrios");
    cont.innerHTML = "";
    cont.appendChild(grupoCalientesFrios("🔥 Más frecuentes", ordenados.slice(0, 6), false));
    cont.appendChild(grupoCalientesFrios("❄️ Menos frecuentes",
        ordenados.slice(-6).reverse(), true));
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
    const entradas = [...document.querySelectorAll(".entrada-num:not(.entrada-super)")];
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
        superGanadora = Number(document.querySelector(".entrada-super").value);
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
        await cargarSorteos();
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

actualizarJuego();

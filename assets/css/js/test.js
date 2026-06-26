const API_BASE_URL = "http://localhost:3000/api";

let idAplicacion = null;
let tiempoRestante = 0;
let intervalo = null;
let items = [];
let indiceTestActual = 0;
let guardandoFinalizacion = false;

document.addEventListener("DOMContentLoaded", async () => {
    console.log("test.js cargado correctamente");

    const params = new URLSearchParams(window.location.search);

    idAplicacion = localStorage.getItem("idAplicacion") || params.get("idAplicacion");
    const nombreEvaluado = localStorage.getItem("nombreEvaluado") || "Evaluado";

    if (!idAplicacion) {
        Swal.fire({
            icon: "warning",
            title: "Sesión no encontrada",
            text: "Debe iniciar sesión nuevamente."
        }).then(() => {
            window.location.href = "index.html";
        });
        return;
    }

    const nombreSpan = document.getElementById("nombreEvaluado");

    if (nombreSpan) {
        nombreSpan.textContent = nombreEvaluado;
    }

    await cargarTest();

    const btnFinalizar = document.getElementById("btnFinalizar");

    if (btnFinalizar) {
        btnFinalizar.addEventListener("click", confirmarFinalizar);
    }
});

async function cargarTest() {
    try {
        clearInterval(intervalo);
        guardandoFinalizacion = false;

        const respuesta = await fetch(
            `${API_BASE_URL}/test/${idAplicacion}?t=${Date.now()}`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!respuesta.ok) {
            throw new Error("No se pudo conectar con el servidor Node.");
        }

        const data = await respuesta.json();

        console.log("Datos recibidos desde Node:", data);

        if (!data.ok) {
            Swal.fire({
                icon: "error",
                title: "Error",
                text: data.mensaje || "No se pudo cargar el test."
            }).then(() => {
                window.location.href = "index.html";
            });
            return;
        }

        items = data.items || [];
        indiceTestActual = Number(data.indiceTestActual || 0);

        const tituloTest = document.getElementById("tituloTest");

        if (tituloTest) {
            if (Number(data.totalTests || 0) > 1) {
                tituloTest.textContent = `${data.nombreTest} (${indiceTestActual + 1} de ${data.totalTests})`;
            } else {
                tituloTest.textContent = data.nombreTest || "Test de razonamiento";
            }
        }

        const instruccionesTest = document.getElementById("instruccionesTest");

        if (instruccionesTest) {
            instruccionesTest.textContent = data.instrucciones || "Sin instrucciones registradas.";
        }

        const contadorPreguntas = document.getElementById("contadorPreguntas");

        if (contadorPreguntas) {
            contadorPreguntas.textContent = `${items.length} ítems`;
        }

        renderizarPreguntas(items);
        restaurarRespuestasTemporales();

        tiempoRestante = Number(
            data.tiempoRestanteSegundos ?? (data.tiempoMinutos * 60)
        );

        tiempoRestante = Math.max(0, tiempoRestante);

        if (tiempoRestante <= 0) {
            actualizarTemporizador();

            Swal.fire({
                icon: "warning",
                title: "Tiempo finalizado",
                text: "El tiempo del test actual ha terminado."
            }).then(() => finalizarTest(true));

            return;
        }

        iniciarTemporizador();

    } catch (error) {
        console.error("Error al cargar test:", error);

        Swal.fire(
            "Error",
            "No se pudo cargar el test desde PostgreSQL. Verifique que Node esté ejecutándose en localhost:3000.",
            "error"
        );
    }
}

function renderizarPreguntas(listaItems) {
    const contenedor = document.getElementById("contenedorPreguntas");

    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = "";

    if (!listaItems || listaItems.length === 0) {
        contenedor.innerHTML = `
            <div class="alert alert-warning rounded-4">
                <i class="bi bi-exclamation-triangle me-2"></i>
                Este test no tiene ítems registrados en OpenXava.
            </div>
        `;
        return;
    }

    listaItems.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = "question-card mb-4";

        card.innerHTML = `
            <div class="question-header">
                <span class="question-number">${index + 1}</span>
                <div>
                    <div class="text-muted small">Ítem ${item.numero}</div>
                    <p class="question-text mb-0">${item.enunciado || ""}</p>
                </div>
            </div>

            <div class="answers-grid mt-3">
                ${crearOpcion(item.numero, "A", item.opcion_a)}
                ${crearOpcion(item.numero, "B", item.opcion_b)}
                ${crearOpcion(item.numero, "C", item.opcion_c)}
                ${crearOpcion(item.numero, "D", item.opcion_d)}
            </div>
        `;

        contenedor.appendChild(card);
    });

    activarGuardadoTemporal();
}

function crearOpcion(numeroItem, letra, texto) {
    return `
        <div class="answer-option">
            <input
                class="form-check-input"
                type="radio"
                name="item_${numeroItem}"
                id="item_${numeroItem}_${letra}"
                value="${letra}"
            >
            <label class="answer-label" for="item_${numeroItem}_${letra}">
                <span class="answer-letter">${letra}</span>
                <span>${texto || ""}</span>
            </label>
        </div>
    `;
}

function iniciarTemporizador() {
    clearInterval(intervalo);

    actualizarTemporizador();

    intervalo = setInterval(() => {
        tiempoRestante--;

        if (tiempoRestante < 0) {
            tiempoRestante = 0;
        }

        actualizarTemporizador();

        if (tiempoRestante <= 0) {
            clearInterval(intervalo);
            finalizarTest(true);
        }
    }, 1000);
}

function actualizarTemporizador() {
    const temporizador = document.getElementById("temporizador");

    if (!temporizador) {
        return;
    }

    const minutos = Math.floor(tiempoRestante / 60);
    const segundos = tiempoRestante % 60;

    temporizador.textContent =
        `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

function activarGuardadoTemporal() {
    const radios = document.querySelectorAll("#contenedorPreguntas input[type='radio']");

    radios.forEach((radio) => {
        radio.addEventListener("change", guardarRespuestasTemporales);
    });
}

function obtenerClaveTemporal() {
    return `respuestasTemporales_${idAplicacion}_${indiceTestActual}`;
}

function guardarRespuestasTemporales() {
    const respuestasTemporales = {};

    items.forEach((item) => {
        const seleccionada = document.querySelector(
            `input[name="item_${item.numero}"]:checked`
        );

        respuestasTemporales[item.numero] = seleccionada ? seleccionada.value : null;
    });

    localStorage.setItem(
        obtenerClaveTemporal(),
        JSON.stringify(respuestasTemporales)
    );
}

function restaurarRespuestasTemporales() {
    const guardadas = localStorage.getItem(obtenerClaveTemporal());

    if (!guardadas) {
        return;
    }

    const respuestasTemporales = JSON.parse(guardadas);

    Object.keys(respuestasTemporales).forEach((numeroItem) => {
        const valor = respuestasTemporales[numeroItem];

        if (!valor) {
            return;
        }

        const radio = document.getElementById(`item_${numeroItem}_${valor}`);

        if (radio) {
            radio.checked = true;
        }
    });
}

function confirmarFinalizar() {
    Swal.fire({
        icon: "question",
        title: "¿Finalizar test?",
        text: "Se guardarán las respuestas del test actual.",
        showCancelButton: true,
        confirmButtonText: "Sí, finalizar",
        cancelButtonText: "Cancelar"
    }).then((result) => {
        if (result.isConfirmed) {
            finalizarTest(false);
        }
    });
}

async function finalizarTest(porTiempo) {
    if (guardandoFinalizacion) {
        return;
    }

    guardandoFinalizacion = true;
    clearInterval(intervalo);

    const respuestas = items.map((item) => {
        const seleccionada = document.querySelector(
            `input[name="item_${item.numero}"]:checked`
        );

        return {
            numeroItem: item.numero,
            respuestaSeleccionada: seleccionada ? seleccionada.value : null
        };
    });

    try {
        const respuesta = await fetch(`${API_BASE_URL}/respuestas`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                idAplicacion: Number(idAplicacion),
                respuestas: respuestas
            })
        });

        const data = await respuesta.json();

        console.log("=== RESPUESTA AL FINALIZAR TEST ===", JSON.stringify(data));

        if (!data.ok) {
            guardandoFinalizacion = false;

            Swal.fire(
                "Error",
                data.mensaje || "No se pudieron guardar las respuestas.",
                "error"
            );

            if (!porTiempo) {
                iniciarTemporizador();
            }

            return;
        }

        localStorage.removeItem(obtenerClaveTemporal());

        if (data.siguienteTest === true) {
            await Swal.fire({
                icon: "success",
                title: porTiempo ? "Tiempo finalizado" : "Test guardado",
                text: data.mensaje || "Ahora continuará con el siguiente test.",
                confirmButtonText: "Continuar"
            });

            if (data.siguienteAplicacion && data.idAplicacionSiguiente) {
                idAplicacion = String(data.idAplicacionSiguiente);
                localStorage.setItem("idAplicacion", idAplicacion);
            }

            items = [];
            tiempoRestante = 0;
            guardandoFinalizacion = false;

            await cargarTest();

            return;
        }

        if (data.finalizada === true) {
            await Swal.fire({
                icon: "success",
                title: porTiempo ? "Tiempo finalizado" : "Evaluación finalizada",
                text: data.mensaje || "Sus respuestas fueron guardadas correctamente.",
                confirmButtonText: "Aceptar"
            });

            localStorage.removeItem("idAplicacion");
            localStorage.removeItem("idEvaluado");
            localStorage.removeItem("nombreEvaluado");

            window.location.href = "index.html";
            return;
        }

        guardandoFinalizacion = false;

        Swal.fire(
            "Aviso",
            data.mensaje || "Las respuestas fueron guardadas.",
            "info"
        );

    } catch (error) {
        guardandoFinalizacion = false;

        console.error("Error al guardar respuestas:", error);

        Swal.fire(
            "Error",
            "No se pudieron guardar las respuestas en PostgreSQL.",
            "error"
        );

        if (!porTiempo) {
            iniciarTemporizador();
        }
    }
}
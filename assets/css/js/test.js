const API_BASE_URL = "http://localhost:3000/api";

let idAplicacion = null;
let tiempoRestante = 0;
let intervalo = null;
let items = [];

document.addEventListener("DOMContentLoaded", async () => {
    idAplicacion = localStorage.getItem("idAplicacion");
    const nombreEvaluado = localStorage.getItem("nombreEvaluado");

    if (!idAplicacion) {
        Swal.fire("Sesión no encontrada", "Debe iniciar sesión nuevamente.", "warning")
            .then(() => window.location.href = "index.html");
        return;
    }

    const nombreSpan = document.getElementById("nombreEvaluado");
    if (nombreSpan) {
        nombreSpan.textContent = nombreEvaluado || "";
    }

    await cargarTest();

    const btnFinalizar = document.getElementById("btnFinalizar");
    if (btnFinalizar) {
        btnFinalizar.addEventListener("click", () => confirmarFinalizar());
    }
});

async function cargarTest() {
    try {
        const respuesta = await fetch(`${API_BASE_URL}/test/${idAplicacion}`);

        if (!respuesta.ok) {
            throw new Error("No se pudo conectar con el servidor.");
        }

        const data = await respuesta.json();

        if (!data.ok) {
            Swal.fire("Error", data.mensaje, "error").then(() => {
                window.location.href = "index.html";
            });
            return;
        }

        items = data.items || [];

        document.getElementById("tituloTest").textContent =
            `Razonamiento Forma ${data.tipoTest}`;

        document.getElementById("instruccionesTest").textContent =
            data.instrucciones || "Sin instrucciones registradas.";

        renderizarPreguntas(items);

        tiempoRestante = Number(data.tiempoMinutos) * 60;

        if (tiempoRestante <= 0) {
            Swal.fire("Error", "El test no tiene tiempo asignado.", "error");
            return;
        }

        iniciarTemporizador();

    } catch (error) {
        console.error("Error al cargar test:", error);

        Swal.fire(
            "Error",
            "No se pudo cargar el test asignado desde OpenXava/PostgreSQL.",
            "error"
        );
    }
}

function renderizarPreguntas(items) {
    const contenedor = document.getElementById("contenedorPreguntas");
    contenedor.innerHTML = "";

    if (!items || items.length === 0) {
        contenedor.innerHTML = `
            <div class="alert alert-warning">
                Este test no tiene ítems registrados. Revise el módulo Test razonamiento en OpenXava.
            </div>
        `;
        return;
    }

    items.forEach((item) => {
        const div = document.createElement("div");
        div.className = "card mb-3";

        div.innerHTML = `
            <div class="card-body">
                <h5 class="mb-3">Ítem ${item.numero}</h5>
                <p class="fw-semibold">${item.enunciado}</p>

                ${crearOpcion(item.numero, "A", item.opcion_a)}
                ${crearOpcion(item.numero, "B", item.opcion_b)}
                ${crearOpcion(item.numero, "C", item.opcion_c)}
                ${crearOpcion(item.numero, "D", item.opcion_d)}
            </div>
        `;

        contenedor.appendChild(div);
    });
}

function crearOpcion(numeroItem, letra, texto) {
    return `
        <div class="form-check mb-2">
            <input 
                class="form-check-input" 
                type="radio" 
                name="item_${numeroItem}" 
                id="item_${numeroItem}_${letra}" 
                value="${letra}"
            >
            <label class="form-check-label" for="item_${numeroItem}_${letra}">
                ${letra}) ${texto}
            </label>
        </div>
    `;
}

function iniciarTemporizador() {
    actualizarTemporizador();

    intervalo = setInterval(() => {
        tiempoRestante--;
        actualizarTemporizador();

        if (tiempoRestante <= 0) {
            clearInterval(intervalo);
            finalizarTest(true);
        }
    }, 1000);
}

function actualizarTemporizador() {
    const minutos = Math.floor(tiempoRestante / 60);
    const segundos = tiempoRestante % 60;

    document.getElementById("temporizador").textContent =
        `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

function confirmarFinalizar() {
    Swal.fire({
        icon: "question",
        title: "¿Finalizar test?",
        text: "Después de finalizar no podrá modificar sus respuestas.",
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

        if (!data.ok) {
            Swal.fire("Error", data.mensaje, "error");
            return;
        }

        localStorage.clear();

        Swal.fire({
            icon: "success",
            title: porTiempo ? "Tiempo finalizado" : "Test finalizado",
            text: "Sus respuestas fueron guardadas correctamente."
        }).then(() => {
            window.location.href = "index.html";
        });

    } catch (error) {
        console.error("Error al guardar respuestas:", error);

        Swal.fire(
            "Error",
            "No se pudieron guardar las respuestas en PostgreSQL.",
            "error"
        );
    }
}
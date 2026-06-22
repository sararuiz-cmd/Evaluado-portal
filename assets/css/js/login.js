document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");

    if (!form) {
        console.error("No se encontró el formulario loginForm");
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const usuario = document.getElementById("usuario").value.trim();
        const contrasena = document.getElementById("contrasena").value.trim();

        if (!usuario || !contrasena) {
            Swal.fire("Campos vacíos", "Ingrese usuario y contraseña.", "warning");
            return;
        }

        try {
            const respuesta = await fetch(`${API_BASE_URL}/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    usuario: usuario,
                    contrasena: contrasena
                })
            });

            const data = await respuesta.json();

            if (!data.ok) {
                Swal.fire("Acceso denegado", data.mensaje, "error");
                return;
            }

            localStorage.setItem("idEvaluado", data.idEvaluado);
            localStorage.setItem("idAplicacion", data.idAplicacion);
            localStorage.setItem("nombreEvaluado", data.nombreEvaluado);

            window.location.href = "test.html";

        } catch (error) {
            console.error("Error en login:", error);
            Swal.fire(
                "Error de conexión",
                "No se pudo conectar con el servidor Node en localhost:3000.",
                "error"
            );
        }
    });
});
document.addEventListener("DOMContentLoaded", function () {
    const loginForm = document.getElementById("loginForm");

    if (!loginForm) {
        console.error("No se encontró el formulario con id='loginForm'");
        return;
    }

    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        event.stopPropagation();

        const usuario = document.getElementById("usuario").value.trim();
        const contrasena = document.getElementById("contrasena").value.trim();

        if (usuario === "" || contrasena === "") {
            Swal.fire({
                icon: "warning",
                title: "Campos vacíos",
                text: "Ingrese usuario y contraseña."
            });
            return;
        }

        const hashContrasena = await generarHashSHA256(contrasena);

        /*
            Hash SHA-256 de la contraseña: 123
        */
        const usuarioPrueba = "sara@gmail.com";
        const passwordHashPrueba = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";

        if (usuario === usuarioPrueba && hashContrasena === passwordHashPrueba) {
            localStorage.setItem("evaluadoLogueado", usuario);

            Swal.fire({
                icon: "success",
                title: "Bienvenido",
                text: "Inicio de sesión correcto.",
                timer: 1200,
                showConfirmButton: false
            }).then(() => {
                window.location.href = "test.html";
            });
        } else {
            Swal.fire({
                icon: "error",
                title: "Credenciales incorrectas",
                text: "El usuario o la contraseña no son válidos."
            });
        }
    });
});

async function generarHashSHA256(texto) {
    const encoder = new TextEncoder();
    const data = encoder.encode(texto);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);

    const hashArray = Array.from(new Uint8Array(hashBuffer));

    return hashArray
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}
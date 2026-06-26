const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ===============================
// CONEXIÓN A POSTGRESQL
// ===============================
const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: "razonamiento_db",
    user: "postgres",
    password: "123"
});

// ===============================
// UTILIDADES
// ===============================
function sha256(texto) {
    return crypto.createHash("sha256").update(texto).digest("hex");
}

function esRazonamientoA(test) {
    const codigo = String(test.codigo || "").toUpperCase();
    const nombre = String(test.nombre || "").toUpperCase();

    return codigo === "A" || nombre.includes("RAZONAMIENTO A");
}

function esRazonamientoB(test) {
    const codigo = String(test.codigo || "").toUpperCase();
    const nombre = String(test.nombre || "").toUpperCase();

    return codigo === "B" || nombre.includes("RAZONAMIENTO B");
}

function normalizarRespuesta(respuesta) {
    if (!respuesta) {
        return null;
    }

    return String(respuesta).trim().toUpperCase();
}

// ===============================
// LOGIN DEL EVALUADO
// ===============================
app.post("/api/login", async (req, res) => {
    const { usuario, contrasena } = req.body;

    if (!usuario || !contrasena) {
        return res.json({
            ok: false,
            mensaje: "Ingrese usuario y contraseña."
        });
    }

    const contrasenaHash = sha256(contrasena);

    try {
        const evaluadoResult = await pool.query(
            `SELECT 
                id_evaluado, 
                nombres, 
                apellidos, 
                usuario
             FROM evaluados
             WHERE usuario = $1
             AND contrasena = $2`,
            [usuario, contrasenaHash]
        );

        if (evaluadoResult.rows.length === 0) {
            return res.json({
                ok: false,
                mensaje: "Usuario o contraseña incorrectos."
            });
        }

        const evaluado = evaluadoResult.rows[0];

        const aplicacionResult = await pool.query(
            `SELECT 
                idaplicacion
             FROM aplicaciontest
             WHERE evaluado_id_evaluado = $1
             AND estado <> 'FINALIZADA'
             ORDER BY idaplicacion DESC
             LIMIT 1`,
            [evaluado.id_evaluado]
        );

        if (aplicacionResult.rows.length === 0) {
            return res.json({
                ok: false,
                mensaje: "Este evaluado no tiene un test asignado."
            });
        }

        return res.json({
            ok: true,
            idEvaluado: evaluado.id_evaluado,
            idAplicacion: aplicacionResult.rows[0].idaplicacion,
            nombreEvaluado: `${evaluado.nombres} ${evaluado.apellidos}`
        });

    } catch (error) {
        console.error("Error en login:", error);

        return res.status(500).json({
            ok: false,
            mensaje: "Error al conectar con PostgreSQL.",
            error: error.message
        });
    }
});

// ===============================
// CARGAR TEST ACTUAL DE UNA APLICACIÓN
// ===============================
app.get("/api/test/:idAplicacion", async (req, res) => {
    const { idAplicacion } = req.params;

    try {
        const aplicacionResult = await pool.query(
            `SELECT 
                idaplicacion,
                estado,
                fechainicio,
                fechafin,
                indice_test_actual,
                fecha_inicio_test_actual,
                fecha_fin_test_actual
             FROM aplicaciontest
             WHERE idaplicacion = $1`,
            [idAplicacion]
        );

        if (aplicacionResult.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                mensaje: "Aplicación no encontrada."
            });
        }

        let aplicacion = aplicacionResult.rows[0];

        const testsResult = await pool.query(
            `SELECT 
                att.orden,
                t.id_test,
                t.codigo,
                t.nombre,
                t.tiempo_limite,
                t.instrucciones
             FROM aplicaciontest_tests att
             INNER JOIN tests_razonamiento t
                ON t.id_test = att.test_id
             WHERE att.aplicacion_id = $1
             ORDER BY att.orden ASC`,
            [idAplicacion]
        );

        if (testsResult.rows.length === 0) {
            return res.json({
                ok: false,
                mensaje: "Esta aplicación no tiene tests asignados."
            });
        }

        if (aplicacion.estado === "FINALIZADA") {
            return res.json({
                ok: false,
                mensaje: "Esta aplicación ya fue finalizada."
            });
        }

        if (aplicacion.fechainicio === null || aplicacion.estado === "PENDIENTE") {
            const inicioResult = await pool.query(
                `UPDATE aplicaciontest
                 SET estado = 'EN_CURSO',
                     fechainicio = COALESCE(fechainicio, NOW()),
                     fechafin = NULL,
                     indice_test_actual = COALESCE(indice_test_actual, 0),
                     fecha_inicio_test_actual = COALESCE(fecha_inicio_test_actual, NOW()),
                     fecha_fin_test_actual = NULL
                 WHERE idaplicacion = $1
                 RETURNING 
                    estado,
                    fechainicio,
                    fechafin,
                    indice_test_actual,
                    fecha_inicio_test_actual,
                    fecha_fin_test_actual`,
                [idAplicacion]
            );

            aplicacion.estado = inicioResult.rows[0].estado;
            aplicacion.fechainicio = inicioResult.rows[0].fechainicio;
            aplicacion.fechafin = inicioResult.rows[0].fechafin;
            aplicacion.indice_test_actual = inicioResult.rows[0].indice_test_actual;
            aplicacion.fecha_inicio_test_actual = inicioResult.rows[0].fecha_inicio_test_actual;
            aplicacion.fecha_fin_test_actual = inicioResult.rows[0].fecha_fin_test_actual;
        }

        let indiceActual = Number(aplicacion.indice_test_actual || 0);

        if (indiceActual < 0 || indiceActual >= testsResult.rows.length) {
            indiceActual = 0;

            const resetResult = await pool.query(
                `UPDATE aplicaciontest
                 SET indice_test_actual = 0,
                     fecha_inicio_test_actual = COALESCE(fecha_inicio_test_actual, NOW()),
                     fecha_fin_test_actual = NULL
                 WHERE idaplicacion = $1
                 RETURNING indice_test_actual, fecha_inicio_test_actual, fecha_fin_test_actual`,
                [idAplicacion]
            );

            aplicacion.indice_test_actual = resetResult.rows[0].indice_test_actual;
            aplicacion.fecha_inicio_test_actual = resetResult.rows[0].fecha_inicio_test_actual;
            aplicacion.fecha_fin_test_actual = resetResult.rows[0].fecha_fin_test_actual;
        }

        const testActual = testsResult.rows[indiceActual];
        const tiempoMinutos = Number(testActual.tiempo_limite || 0);

        if (tiempoMinutos <= 0) {
            return res.json({
                ok: false,
                mensaje: "El test actual no tiene tiempo configurado."
            });
        }

        const fechaInicioTestActual = aplicacion.fecha_inicio_test_actual || aplicacion.fechainicio;

        const segundosTranscurridos = fechaInicioTestActual
            ? Math.max(0, Math.floor((Date.now() - new Date(fechaInicioTestActual).getTime()) / 1000))
            : 0;

        const tiempoTotalSegundos = tiempoMinutos * 60;
        const tiempoRestanteSegundos = Math.max(
            0,
            tiempoTotalSegundos - segundosTranscurridos
        );

        const itemsResult = await pool.query(
            `SELECT 
                id_item,
                numero,
                enunciado,
                opcion_a,
                opcion_b,
                opcion_c,
                opcion_d
             FROM items_razonamiento
             WHERE id_test_fk = $1
             ORDER BY numero ASC`,
            [testActual.id_test]
        );

        return res.json({
            ok: true,

            idAplicacion: aplicacion.idaplicacion,
            estado: aplicacion.estado,

            idTest: testActual.id_test,
            codigoTest: testActual.codigo,
            tipoTest: testActual.codigo,
            nombreTest: testActual.nombre,

            indiceTestActual: indiceActual,
            totalTests: testsResult.rows.length,
            haySiguienteTest: indiceActual < testsResult.rows.length - 1,

            tiempoMinutos: tiempoMinutos,
            tiempoTotalSegundos: tiempoTotalSegundos,
            tiempoRestanteSegundos: tiempoRestanteSegundos,

            fechaInicio: aplicacion.fechainicio,
            fechaInicioTestActual: fechaInicioTestActual,

            instrucciones: testActual.instrucciones,
            items: itemsResult.rows
        });

    } catch (error) {
        console.error("Error al cargar test:", error);

        return res.status(500).json({
            ok: false,
            mensaje: "Error al cargar el test.",
            error: error.message
        });
    }
});

// ===============================
// CALCULAR Y GUARDAR RESULTADO
// ===============================
async function calcularYGuardarResultado(client, idAplicacion) {
    const resultado = await client.query(
        `SELECT
            t.id_test,
            t.codigo,
            t.nombre,
            COUNT(i.id_item) FILTER (
                WHERE r.respuesta_seleccionada = i.respuesta_correcta
            ) AS aciertos
         FROM aplicaciontest_tests att
         INNER JOIN tests_razonamiento t
            ON t.id_test = att.test_id
         INNER JOIN items_razonamiento i
            ON i.id_test_fk = t.id_test
         LEFT JOIN aplicacion_respuestas r
            ON r.aplicaciontest_idaplicacion = att.aplicacion_id
           AND r.numero_item = i.numero
         WHERE att.aplicacion_id = $1
         GROUP BY t.id_test, t.codigo, t.nombre, att.orden
         ORDER BY att.orden ASC`,
        [idAplicacion]
    );

    if (resultado.rows.length === 0) {
        throw new Error("No se encontró la aplicación o los tests no tienen ítems.");
    }

    let r1 = 0;
    let r2 = 0;
    let aciertos = 0;

    for (const fila of resultado.rows) {
        const puntos = Number(fila.aciertos || 0);
        aciertos += puntos;

        if (esRazonamientoA(fila)) {
            r1 += puntos;
        } else if (esRazonamientoB(fila)) {
            r2 += puntos;
        }
    }

    const rt = r1 + r2;

    await client.query(
        `INSERT INTO resultados_razonamiento
            (
                aplicacion_idaplicacion,
                aciertos,
                r1,
                r2,
                rt,
                percentil_r1,
                percentil_r2,
                percentil_rt,
                baremo_r1_id,
                baremo_r2_id,
                baremo_rt_id
            )
         VALUES
            ($1, $2, $3, $4, $5, NULL, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT (aplicacion_idaplicacion)
         DO UPDATE SET
            aciertos = EXCLUDED.aciertos,
            r1 = EXCLUDED.r1,
            r2 = EXCLUDED.r2,
            rt = EXCLUDED.rt,
            percentil_r1 = NULL,
            percentil_r2 = NULL,
            percentil_rt = NULL,
            baremo_r1_id = NULL,
            baremo_r2_id = NULL,
            baremo_rt_id = NULL`,
        [
            idAplicacion,
            aciertos,
            r1,
            r2,
            rt
        ]
    );
}

// ===============================
// RECALCULAR RESULTADO MANUALMENTE
// ===============================
app.get("/api/recalcular/:idAplicacion", async (req, res) => {
    const { idAplicacion } = req.params;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await calcularYGuardarResultado(client, idAplicacion);

        await client.query("COMMIT");

        return res.json({
            ok: true,
            mensaje: "Resultado recalculado correctamente.",
            idAplicacion: Number(idAplicacion)
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Error al recalcular resultado:", error);

        return res.status(500).json({
            ok: false,
            mensaje: "No se pudo recalcular el resultado.",
            error: error.message
        });

    } finally {
        client.release();
    }
});

// ===============================
// GUARDAR RESPUESTAS DEL TEST ACTUAL
// ===============================
app.post("/api/respuestas", async (req, res) => {
    const { idAplicacion, respuestas } = req.body;

    if (!idAplicacion || !Array.isArray(respuestas)) {
        return res.json({
            ok: false,
            mensaje: "Datos incompletos."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const r of respuestas) {
            const respuestaSeleccionada = normalizarRespuesta(r.respuestaSeleccionada);
            const estadoRespuesta = respuestaSeleccionada ? "RESPONDIDA" : "OMITIDA";

            await client.query(
                `INSERT INTO aplicacion_respuestas
                    (
                        aplicaciontest_idaplicacion,
                        numero_item,
                        respuesta_seleccionada,
                        estado_respuesta,
                        fecha_registro
                    )
                 VALUES
                    ($1, $2, $3, $4, NOW())
                 ON CONFLICT (aplicaciontest_idaplicacion, numero_item)
                 DO UPDATE SET
                    respuesta_seleccionada = EXCLUDED.respuesta_seleccionada,
                    estado_respuesta = EXCLUDED.estado_respuesta,
                    fecha_registro = NOW()`,
                [
                    idAplicacion,
                    r.numeroItem,
                    respuestaSeleccionada,
                    estadoRespuesta
                ]
            );
        }

        const aplicacionResult = await client.query(
            `SELECT 
                indice_test_actual
             FROM aplicaciontest
             WHERE idaplicacion = $1`,
            [idAplicacion]
        );

        if (aplicacionResult.rows.length === 0) {
            throw new Error("Aplicación no encontrada.");
        }

        const totalTestsResult = await client.query(
            `SELECT COUNT(*) AS total
             FROM aplicaciontest_tests
             WHERE aplicacion_id = $1`,
            [idAplicacion]
        );

        const indiceActual = Number(aplicacionResult.rows[0].indice_test_actual || 0);
        const totalTests = Number(totalTestsResult.rows[0].total || 0);

        if (totalTests === 0) {
            throw new Error("La aplicación no tiene tests asignados.");
        }

        if (indiceActual < totalTests - 1) {
            const nuevoIndice = indiceActual + 1;

            await client.query(
                `UPDATE aplicaciontest
                 SET estado = 'EN_CURSO',
                     indice_test_actual = $2,
                     fecha_inicio_test_actual = NOW(),
                     fecha_fin_test_actual = NULL,
                     fechafin = NULL
                 WHERE idaplicacion = $1`,
                [idAplicacion, nuevoIndice]
            );

            await client.query("COMMIT");

            return res.json({
                ok: true,
                finalizada: false,
                siguienteTest: true,
                indiceTestActual: nuevoIndice,
                mensaje: "Respuestas guardadas. Continúe con el siguiente test."
            });
        }

        await client.query(
            `UPDATE aplicaciontest
             SET estado = 'FINALIZADA',
                 fecha_fin_test_actual = NOW(),
                 fechafin = NOW()
             WHERE idaplicacion = $1`,
            [idAplicacion]
        );

        await calcularYGuardarResultado(client, idAplicacion);

        await client.query("COMMIT");

        return res.json({
            ok: true,
            finalizada: true,
            siguienteTest: false,
            mensaje: "Respuestas y resultado guardados correctamente."
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error al guardar respuestas:", error);

        return res.status(500).json({
            ok: false,
            mensaje: "Error al guardar respuestas o calcular resultado.",
            error: error.message
        });

    } finally {
        client.release();
    }
});

// ===============================
// ESTADO DEL SERVIDOR
// ===============================
app.get("/api/health", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW() AS fecha");
        return res.json({
            ok: true,
            mensaje: "Servidor funcionando.",
            fecha: result.rows[0].fecha
        });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            mensaje: "Error de conexión con PostgreSQL.",
            error: error.message
        });
    }
});

// ===============================
// PROBAR CONEXIÓN Y LEVANTAR SERVIDOR
// ===============================
pool.query("SELECT NOW()")
    .then(() => {
        console.log("Conexión a PostgreSQL correcta.");

        app.listen(PORT, () => {
            console.log(`Servidor del portal ejecutándose en http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error("No se pudo conectar a PostgreSQL:");
        console.error(error);
    });
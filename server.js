const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Conexión a PostgreSQL local
const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: "razonamiento_db",
    user: "postgres",
    password: "123"
});

function sha256(texto) {
    return crypto.createHash("sha256").update(texto).digest("hex");
}

// LOGIN
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
            `SELECT id_evaluado, nombres, apellidos, usuario
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
            `SELECT idaplicacion
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
            mensaje: "Error al conectar con PostgreSQL."
        });
    }
});

// CARGAR TEST ASIGNADO
app.get("/api/test/:idAplicacion", async (req, res) => {
    const { idAplicacion } = req.params;

    try {
        const aplicacionResult = await pool.query(
            `SELECT 
                a.idaplicacion,
                a.estado,
                a.fechainicio,
                t.id_test,
                t.tipo_test,
                t.instrucciones
             FROM aplicaciontest a
             INNER JOIN tests_razonamiento t
                ON a.testrazonamiento_id_test = t.id_test
             WHERE a.idaplicacion = $1`,
            [idAplicacion]
        );

        if (aplicacionResult.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                mensaje: "Aplicación no encontrada."
            });
        }

        const aplicacion = aplicacionResult.rows[0];

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
            [aplicacion.id_test]
        );

        let tiempoMinutos = 0;

        if (aplicacion.tipo_test === "A") {
            tiempoMinutos = 10;
        } else if (aplicacion.tipo_test === "B") {
            tiempoMinutos = 12;
        }

        if (aplicacion.estado === "PENDIENTE") {
            await pool.query(
                `UPDATE aplicaciontest
                 SET estado = 'EN_CURSO',
                     fechainicio = NOW(),
                     fechafin = NULL
                 WHERE idaplicacion = $1`,
                [idAplicacion]
            );
        }

        return res.json({
            ok: true,
            idAplicacion: aplicacion.idaplicacion,
            tipoTest: aplicacion.tipo_test,
            tiempoMinutos: tiempoMinutos,
            instrucciones: aplicacion.instrucciones,
            items: itemsResult.rows
        });

    } catch (error) {
        console.error("Error al cargar test:", error);

        return res.status(500).json({
            ok: false,
            mensaje: "Error al cargar el test."
        });
    }
});

// CALCULAR Y GUARDAR RESULTADO
async function calcularYGuardarResultado(client, idAplicacion) {
    const resultado = await client.query(
        `SELECT
            t.tipo_test,

            COUNT(i.id_item) FILTER (
                WHERE r.respuesta_seleccionada = i.respuesta_correcta
            ) AS aciertos

         FROM aplicaciontest a

         INNER JOIN tests_razonamiento t
            ON a.testrazonamiento_id_test = t.id_test

         INNER JOIN items_razonamiento i
            ON i.id_test_fk = t.id_test

         LEFT JOIN aplicacion_respuestas r
            ON r.aplicaciontest_idaplicacion = a.idaplicacion
           AND r.numero_item = i.numero

         WHERE a.idaplicacion = $1

         GROUP BY t.tipo_test`,
        [idAplicacion]
    );

    if (resultado.rows.length === 0) {
        throw new Error("No se encontró la aplicación o el test no tiene ítems.");
    }

    const tipoTest = resultado.rows[0].tipo_test;
    const aciertos = Number(resultado.rows[0].aciertos || 0);

    let r1 = 0;
    let r2 = 0;
    let rt = 0;

    /*
     * IMPORTANTE:
     * Si solo se aplicó Forma A, NO se guarda RT.
     * Si solo se aplicó Forma B, NO se guarda RT.
     * Como la BD tiene NOT NULL, se guarda 0 en RT.
     */
    if (tipoTest === "A") {
        r1 = aciertos;
        r2 = 0;
        rt = 0;
    } else if (tipoTest === "B") {
        r1 = 0;
        r2 = aciertos;
        rt = 0;
    } else {
        throw new Error("Tipo de test no válido.");
    }

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

// RECALCULAR RESULTADO MANUALMENTE
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

// GUARDAR RESPUESTAS
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
            const respuestaSeleccionada = r.respuestaSeleccionada || null;
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

        await client.query(
            `UPDATE aplicaciontest
             SET estado = 'FINALIZADA',
                 fechafin = NOW()
             WHERE idaplicacion = $1`,
            [idAplicacion]
        );

        await calcularYGuardarResultado(client, idAplicacion);

        await client.query("COMMIT");

        return res.json({
            ok: true,
            mensaje: "Respuestas y resultado guardados correctamente."
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error al guardar respuestas:", error);

        return res.status(500).json({
            ok: false,
            mensaje: "Error al guardar respuestas o calcular resultado."
        });

    } finally {
        client.release();
    }
});

// Probar conexión y levantar servidor
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
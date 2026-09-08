const db = require('../config/conexion_db');
const bcrypt = require('bcrypt');
const { enviarCredenciales } = require("../services/emailService");

class InstructoresController {
    //Obtener Todos Los Usuarios Con Su Rol
    async obtenerInstructores(req, res) {
        try {
            const [instructores] = await db.query(
                `SELECT i.id_instructor, i.cedula, i.nombre, i.email, r.nombre AS rol,
                    COALESCE(GROUP_CONCAT(p.nombre ORDER BY p.id_permiso SEPARATOR ', '), 'Sin Permisos') AS permisos
                FROM instructores i
                LEFT JOIN roles r ON i.id_rol = r.id_rol
                LEFT JOIN roles_permisos rp ON r.id_rol = rp.id_rol
                LEFT JOIN permisos p ON rp.id_permiso = p.id_permiso
                GROUP BY i.id_instructor, i.cedula, i.nombre, i.email, r.nombre`
            );

            res.json(instructores);
        } catch (error) {
            console.error(error);
            res.status(500).json({ mensaje: 'Error al obtener usuarios' });
        }
    }

    async obtenerInstructorPorId(req, res) {
        const { id } = req.params;
        try {
            const [instructor] = await db.query(
                `SELECT
                i.id_instructor,
                i.nombre,
                i.email,
                i.cedula,
                i.id_rol,
                r.nombre AS rol,
                COALESCE(GROUP_CONCAT(p.nombre SEPARATOR ', '), 'Sin Permisos') AS permisos
            FROM instructores i
            LEFT JOIN roles r ON i.id_rol = r.id_rol
            LEFT JOIN roles_permisos rp ON r.id_rol = rp.id_rol
            LEFT JOIN permisos p ON rp.id_permiso = p.id_permiso
            WHERE i.id_instructor = ?
            GROUP BY i.id_instructor, i.nombre, i.email, r.nombre`,
                [id]
            );

            if (instructor.length === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            res.json(instructor[0]);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener usuario' });
        }
    }

    //Agregar Un Usuario Nuevo
    async agregarInstructor(req, res) {
        const { id_rol, nombre, email, contrasena, cedula, estado } = req.body;
        try {
            // Cifrar contrasena
            const hash = await bcrypt.hash(contrasena, 10);

            await db.query(
                'INSERT INTO instructores (id_rol, nombre, email, contrasena, cedula, estado) VALUES (?, ?, ?, ?, ?, ?)',
                [id_rol, nombre, email, hash, cedula, estado]
            );
            res.json({ mensaje: 'Instructor agregado exitosamente' });
        } catch (error) {
            console.error("❌ Error en agregarInstructor:", error);
            res.status(500).json({ mensaje: 'Error al agregar instructor' });
        }
    }

    //Actualizar Usuario (Opcionalmente Cambiar contrasena)
    async actualizarInstructor(req, res) {
        // PRIMERO: Obtener los parámetros y el cuerpo de la solicitud
        const { id } = req.params;  // ← ESTO DEBE IR PRIMERO
        const { cedula, nombre, email, contrasena, id_rol, estado } = req.body;
        
        console.log("🔄 Actualizando instructor ID:", id);
        console.log("📝 Datos recibidos:", { cedula, nombre, email, id_rol, estado });

        // Validar cédula duplicada al actualizar
        try {
            const [cedulaExiste] = await db.query(
                "SELECT id_instructor FROM instructores WHERE cedula = ? AND id_instructor != ?",
                [cedula, id]
            );

            if (cedulaExiste.length > 0) {
                return res.status(400).json({ error: "La cédula ya está registrada por otro instructor" });
            }
        } catch (error) {
            console.error("Error validando cédula:", error);
            return res.status(500).json({ error: "Error al validar cédula" });
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: "El correo no tiene un formato válido" });
        }

        try {
            if (contrasena && contrasena.trim() !== '') {
                console.log("🔐 Cambiando contraseña también...");
                const hash = await bcrypt.hash(contrasena, 10);
                await db.query(
                    'UPDATE instructores SET nombre = ?, email = ?, contrasena = ?, id_rol = ?, cedula = ?, estado = ? WHERE id_instructor = ?',
                    [nombre, email, hash, id_rol, cedula, estado, id]
                );
            } else {
                console.log("🔄 Actualizando sin cambiar contraseña...");
                await db.query(
                    'UPDATE instructores SET nombre = ?, email = ?, id_rol = ?, cedula = ?, estado = ? WHERE id_instructor = ?',
                    [nombre, email, id_rol, cedula, estado, id]
                );
            }
            
            console.log("✅ Instructor actualizado exitosamente");
            res.json({ mensaje: 'Instructor actualizado exitosamente' });
        } catch (error) {
            console.error("❌ Error al actualizar instructor:", error);
            res.status(500).json({ mensaje: 'Error al actualizar usuario', error: error.message });
        }
    }

    //Eliminar Usuario
    async eliminarInstructor(req, res) {
        const { id } = req.params;
        try {
            await db.query('DELETE FROM instructores WHERE id_instructor = ?', [id]);
            res.json({ mensaje: 'Instructor eliminado exitosamente' });
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar usuario' });
        }
    }

    async obtenerInstructorPorEmail(req, res) {
        const { email } = req.params;

        try {
            const [rows] = await db.query(
                `SELECT 
                id_instructor,
                nombre,
                email,
                cedula,
                id_rol
            FROM instructores
            WHERE email = ?`,
                [email]
            );

            if (rows.length === 0) {
                return res.status(404).json({ mensaje: "Instructor no encontrado" });
            }

            res.json(rows[0]);

        } catch (error) {
            console.error("❌ Error al buscar instructor por email:", error);
            res.status(500).json({ mensaje: "Error interno al buscar instructor" });
        }
    }

    // Camila G.
    // Obtener fichas asignadas a un instructor
    async obtenerFichasPorInstructor(req, res) {
        const { id } = req.params;

        try {
            const [fichas] = await db.query(
                `SELECT 
                f.id_ficha,
                f.codigo_ficha,
                f.modalidad,
                f.jornada,
                f.ambiente,
                f.fecha_inicio,
                f.fecha_final,
                f.cantidad_trimestre,
                p.id_programa,
                p.nombre_programa,
                p.codigo_programa
            FROM instructor_ficha inf
            INNER JOIN fichas f ON inf.id_ficha = f.id_ficha
            LEFT JOIN programa_formacion p ON p.id_programa = f.id_programa
            WHERE inf.id_instructor = ?`,
                [id]
            );

            res.json(fichas);
        } catch (error) {
            console.error("❌ Error al obtener fichas del instructor:", error);
            res.status(500).json({ error: "Error al obtener fichas del instructor" });
        }
    }

    async cambiarContrasena(req, res) {
        try {
            const { id } = req.params;
            const { nueva_contrasena } = req.body;

            console.log("🔄 Cambiando contraseña para instructor ID:", id);
            console.log("📝 Nuevo estado primer_acceso: 0");

            if (!nueva_contrasena) {
                return res.status(400).json({ error: 'La nueva contraseña es obligatoria' });
            }

            const hashed = await bcrypt.hash(nueva_contrasena, 10);

            // ACTUALIZAR LA CONTRASEÑA Y MARCAR QUE YA NO ES PRIMER ACCESO
            const [result] = await db.query(
                "UPDATE instructores SET contrasena = ?, primer_acceso = 0 WHERE id_instructor = ?",
                [hashed, id]
            );

            console.log("✅ Contraseña actualizada. Filas afectadas:", result.affectedRows);

            // Verificar el cambio
            const [updatedUser] = await db.query(
                "SELECT primer_acceso FROM instructores WHERE id_instructor = ?",
                [id]
            );

            console.log("🔍 Estado actual de primer_acceso:", updatedUser[0]?.primer_acceso);

            return res.json({
                mensaje: 'Contraseña actualizada correctamente',
                primer_acceso: false
            });
        } catch (error) {
            console.error("❌ Error al cambiar contraseña:", error);
            res.status(500).json({ error: 'Error del servidor' });
        }
    }

}
module.exports = InstructoresController;
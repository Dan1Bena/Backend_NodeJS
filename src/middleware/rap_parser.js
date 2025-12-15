class RapParser {
    /**
     * Normaliza texto para comparación (sin acentos, mayúsculas)
     */
    static normalizar(texto) {
        if (!texto) return '';
        return texto
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Extrae los items de una sección (líneas que empiezan con *)
     */
    static extraerBloque(texto) {
        if (!texto) return '';

        const items = texto
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('*'))
            .map(l => l.replace(/^\*\s*/, '').trim());

        if (items.length === 0) return '';

        return items.join('\n');
    }

    /**
     * Detecta si el texto tiene estructura con títulos de sección
     */
    static tieneTitulosSecciones(textoCompleto) {
        if (!textoCompleto) return false;
        const patronTitulo = /\n[A-ZÑÁÉÍÓÚ][A-ZÑÁÉÍÓÚ\s]{20,}:/;
        return patronTitulo.test(textoCompleto);
    }

    /**
     * Parsea conocimientos CON títulos de sección
     * Usa búsqueda MÁS FLEXIBLE para encontrar coincidencias
     */
    static parsearConTitulos(textoCompleto, listaRaps) {
        const resultado = {};

        // Normalizar RAPs para búsqueda
        const rapsNormalizados = listaRaps.map(rap => {
            const normalizado = this.normalizar(rap);
            const sinNumero = normalizado.replace(/^\d+\s+/, '');

            // Extraer palabras clave significativas (más de 4 letras)
            const palabrasClave = sinNumero
                .split(' ')
                .filter(p => p.length > 4)
                .slice(0, 5); // Primeras 5 palabras importantes

            return {
                original: rap,
                normalizado: normalizado,
                clave: sinNumero.substring(0, 40),
                palabrasClave: palabrasClave
            };
        });

        // Dividir el texto en secciones
        const secciones = textoCompleto.split(/\n(?=[A-ZÑÁÉÍÓÚ][A-ZÑÁÉÍÓÚ\s]{15,}:)/);

        for (const seccion of secciones) {
            if (!seccion.trim()) continue;

            const lineas = seccion.split('\n');
            const titulo = lineas[0].trim().replace(/:$/, '');
            const tituloNorm = this.normalizar(titulo);

            // 🔥 BÚSQUEDA MÁS FLEXIBLE
            const rapEncontrado = rapsNormalizados.find(rap => {
                // 1. Coincidencia exacta de clave
                if (tituloNorm.includes(rap.clave) || rap.clave.includes(tituloNorm)) {
                    return true;
                }

                // 2. Coincidencia por palabras clave (al menos 2 palabras)
                const coincidencias = rap.palabrasClave.filter(palabra =>
                    tituloNorm.includes(palabra)
                );

                return coincidencias.length >= 2;
            });

            if (rapEncontrado) {
                const bloque = this.extraerBloque(seccion);
                if (bloque.length > 0) {
                    resultado[rapEncontrado.original] = bloque;
                }
            } else {
                // Log para debug
                console.log(`    ⚠️  No se encontró RAP para: ${titulo.substring(0, 50)}...`);
            }
        }

        return resultado;
    }

    /**
     * 🔥 NUEVO: Parsea SIN títulos → COPIA TODO EL CONTENIDO A TODOS LOS RAPs
     * (En lugar de dividir equitativamente)
     */
    static parsearSinTitulos(textoCompleto, listaRaps) {
        const resultado = {};

        // Extraer todo el contenido limpio
        const texto = this.extraerBloque(textoCompleto);

        if (!texto) return resultado;

        // 🔥 COPIAR el MISMO contenido a TODOS los RAPs
        for (const rap of listaRaps) {
            resultado[rap] = texto;
        }

        return resultado;
    }

    /**
     * AUTO-DETECTA formato y usa el parser apropiado
     */
    static parsearPorRap(textoCompleto, listaRaps) {
        if (!textoCompleto || !listaRaps || listaRaps.length === 0) {
            return {};
        }

        if (this.tieneTitulosSecciones(textoCompleto)) {
            console.log('  📋 Formato CON títulos detectado');
            return this.parsearConTitulos(textoCompleto, listaRaps);
        } else {
            console.log('  📋 Formato SIN títulos detectado (contenido completo para todos)');
            return this.parsearSinTitulos(textoCompleto, listaRaps);
        }
    }

    /**
     * Procesa una competencia completa y retorna RAPs estructurados
     */
    static procesarCompetencia(competencia) {
        const raps = competencia.resultados_aprendizaje || [];

        if (raps.length === 0) {
            console.warn(`⚠️  Competencia sin RAPs`);
            return [];
        }

        console.log(`\n📚 Procesando competencia: ${competencia.competencia}`);
        console.log(`   RAPs: ${raps.length}`);

        // Parsear cada tipo
        const conocimientosProcesoPorRap = this.parsearPorRap(
            competencia.conocimientos_proceso,
            raps
        );

        const conocimientosSaberPorRap = this.parsearPorRap(
            competencia.conocimientos_saber,
            raps
        );

        const criteriosPorRap = this.parsearPorRap(
            competencia.criterios_evaluacion,
            raps
        );

        // Construir array de RAPs estructurados
        return raps.map((rap, index) => {
            const rapLimpio = rap.replace(/\n/g, ' ').trim();
            const match = rapLimpio.match(/^(\d{1,2})\s+(.+)/);
            const codigo = match ? match[1].padStart(2, '0') : String(index + 1).padStart(2, '0');
            const denominacion = match ? match[2].trim() : rapLimpio;

            const conocimientosProceso = conocimientosProcesoPorRap[rap] || '';
            const conocimientosSaber = conocimientosSaberPorRap[rap] || '';
            const criteriosEvaluacion = criteriosPorRap[rap] || '';

            // Log de advertencia si falta contenido
            if (!conocimientosProceso && !conocimientosSaber && !criteriosEvaluacion) {
                console.log(`    ⚠️  ${codigo}: Sin conocimientos/criterios`);
            }

            return {
                codigo,
                denominacion,
                conocimientos_proceso: conocimientosProceso,
                conocimientos_saber: conocimientosSaber,
                criterios_evaluacion: criteriosEvaluacion
            };
        });
    }
}

module.exports = RapParser;
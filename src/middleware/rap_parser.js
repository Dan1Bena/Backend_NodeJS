// rap_parser.js
// Parser robusto y depurado para procesar RAPs desde el JSON del extractor Python

class RapParser {
  /**
   * Normaliza texto: quita acentos, convierte a mayúsculas, colapsa espacios
   */
  static normalizar(texto) {
    if (!texto) return "";
    return texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\r/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Extrae código numérico de un RAP (ej: "02 PLANEAR..." → "02")
   */
  static extraerCodigoRap(rapDenominacion) {
    const match = rapDenominacion.trim().match(/^(\d{1,2})\s+/);
    return match ? match[1].padStart(2, "0") : null;
  }

  /**
   * Divide texto por secciones con títulos (líneas en MAYÚSCULAS seguidas de ":")
   * Retorna: [{ titulo, contenido }, ...]
   */
  static dividirPorTitulos(textoCompleto) {
    if (!textoCompleto || !textoCompleto.trim()) return [];

    // Regex para detectar títulos: línea en mayúsculas de 10+ chars que termina en ":"
    const patronTitulo = /^([A-ZÑÁÉÍÓÚ0-9][A-ZÑÁÉÍÓÚ0-9\s\-\.,()\/]{9,}):$/gm;
    const secciones = [];
    let match;
    let ultimoIndice = 0;

    // Encontrar todos los títulos
    const titulos = [];
    const regex = new RegExp(patronTitulo);
    while ((match = regex.exec(textoCompleto)) !== null) {
      titulos.push({
        titulo: match[1].trim(),
        indice: match.index,
        finTitulo: match.index + match[0].length,
      });
    }

    // Extraer contenido entre títulos
    for (let i = 0; i < titulos.length; i++) {
      const actual = titulos[i];
      const siguiente = titulos[i + 1];

      const inicio = actual.finTitulo;
      const fin = siguiente ? siguiente.indice : textoCompleto.length;

      const contenido = textoCompleto.substring(inicio, fin).trim();

      if (contenido) {
        secciones.push({
          titulo: actual.titulo,
          contenido: contenido,
        });
      }
    }

    // Si no se encontraron títulos, retornar todo como una sección
    if (secciones.length === 0 && textoCompleto.trim()) {
      secciones.push({
        titulo: "",
        contenido: textoCompleto.trim(),
      });
    }

    return secciones;
  }

  /**
   * Intenta matchear un título de sección con un RAP específico
   * Retorna: índice del RAP o null
   */
  static matchearTituloConRap(titulo, listaRaps) {
    if (!titulo || !Array.isArray(listaRaps) || listaRaps.length === 0) {
      return null;
    }

    const tituloNorm = this.normalizar(titulo);

    // 1. Buscar por código numérico exacto (si el título empieza con número)
    const codigoTitulo = this.extraerCodigoRap(titulo);
    if (codigoTitulo) {
      for (let i = 0; i < listaRaps.length; i++) {
        const codigoRap = this.extraerCodigoRap(listaRaps[i]);
        if (codigoRap === codigoTitulo) {
          return i;
        }
      }
    }

    // 2. Buscar por coincidencia de palabras clave (>=3 palabras coinciden)
    const palabrasTitulo = tituloNorm
      .split(/\s+/)
      .filter((w) => w.length > 3) // palabras de 4+ letras
      .slice(0, 10); // máx 10 palabras

    if (palabrasTitulo.length < 2) return null;

    let mejorIndice = null;
    let mejorScore = 0;

    for (let i = 0; i < listaRaps.length; i++) {
      const rapNorm = this.normalizar(listaRaps[i]);
      let score = 0;

      for (const palabra of palabrasTitulo) {
        if (rapNorm.includes(palabra)) {
          score++;
        }
      }

      // Requerir al menos 3 coincidencias
      if (score > mejorScore && score >= 3) {
        mejorScore = score;
        mejorIndice = i;
      }
    }

    return mejorIndice;
  }

  /**
   * Distribuye secciones de un campo (proceso/saber/criterios) entre los RAPs
   */
  static distribuirSeccionesPorRap(textoCompleto, listaRaps) {
    if (!textoCompleto || !Array.isArray(listaRaps) || listaRaps.length === 0) {
      return {};
    }

    const secciones = this.dividirPorTitulos(textoCompleto);
    const contenidoPorRap = {};

    // Inicializar resultado vacío
    listaRaps.forEach((rap) => {
      contenidoPorRap[rap] = "";
    });

    // Si no hay secciones tituladas, copiar todo a todos los RAPs
    if (secciones.length === 1 && !secciones[0].titulo) {
      const contenidoLimpio = secciones[0].contenido.trim();
      listaRaps.forEach((rap) => {
        contenidoPorRap[rap] = contenidoLimpio;
      });
      return contenidoPorRap;
    }

    // Distribuir secciones según coincidencia con RAPs
    for (const seccion of secciones) {
      const indiceRap = this.matchearTituloConRap(seccion.titulo, listaRaps);

      if (indiceRap !== null && indiceRap >= 0 && indiceRap < listaRaps.length) {
        // Asignar a RAP específico
        const rapKey = listaRaps[indiceRap];
        const anterior = contenidoPorRap[rapKey];
        contenidoPorRap[rapKey] = anterior ? `${anterior}\n${seccion.contenido}` : seccion.contenido;
      } else {
        // Si no se puede matchear, agregar a todos los RAPs que estén vacíos
        // (evita duplicar contenido innecesariamente)
        const rapsVacios = listaRaps.filter((rap) => !contenidoPorRap[rap]);
        if (rapsVacios.length > 0) {
          rapsVacios.forEach((rap) => {
            contenidoPorRap[rap] = seccion.contenido;
          });
        }
      }
    }

    // FALLBACK: Si algún RAP quedó vacío, copiarle todo el contenido
    listaRaps.forEach((rap) => {
      if (!contenidoPorRap[rap] || contenidoPorRap[rap].trim() === "") {
        contenidoPorRap[rap] = textoCompleto.trim();
      }
    });

    return contenidoPorRap;
  }

  /**
   * Procesa una competencia completa y retorna array de RAPs estructurados
   */
  static procesarCompetencia(competencia) {
    // Validar entrada
    if (!competencia || !competencia.resultados_aprendizaje) {
      console.warn("⚠️ Competencia sin resultados_aprendizaje");
      return [];
    }

    const resultados = Array.isArray(competencia.resultados_aprendizaje) ? competencia.resultados_aprendizaje : [];

    if (resultados.length === 0) {
      console.warn("⚠️ Competencia sin RAPs");
      return [];
    }

    // Normalizar lista de RAPs (denominaciones exactas como vienen del JSON)
    const listaRaps = resultados.map((r) => String(r).trim()).filter(Boolean);

    console.log(`\n📋 Procesando competencia con ${listaRaps.length} RAPs`);

    // Obtener campos de contenido
    const textoProceso = String(competencia.conocimientos_proceso || "").trim();
    const textoSaber = String(competencia.conocimientos_saber || "").trim();
    const textoCriterios = String(competencia.criterios_evaluacion || "").trim();

    // Distribuir contenido por RAP
    const procesoPorRap = this.distribuirSeccionesPorRap(textoProceso, listaRaps);
    const saberPorRap = this.distribuirSeccionesPorRap(textoSaber, listaRaps);
    const criteriosPorRap = this.distribuirSeccionesPorRap(textoCriterios, listaRaps);

    // Construir array final de RAPs
    const rapsEstructurados = listaRaps.map((rapCompleto, idx) => {
      // Extraer código y denominación
      // Capturar código y toda la denominación incluso si tiene saltos de línea
      const match = rapCompleto.match(/^(\d{1,2})\s+([\s\S]+)/);
      const codigo = match ? match[1].padStart(2, "0") : String(idx + 1).padStart(2, "0");

      // Preservar saltos de línea internos pero limpiar retornos de carro y espacios duplicados
      let denominacion = match ? match[2] : rapCompleto;
      denominacion = denominacion
        .replace(/\r/g, "")
        .replace(/\n{2,}/g, "\n")
        .trim();

      // Obtener contenidos para este RAP
      const conocimientos_proceso = (procesoPorRap[rapCompleto] || "").trim();
      const conocimientos_saber = (saberPorRap[rapCompleto] || "").trim();
      const criterios_evaluacion = (criteriosPorRap[rapCompleto] || "").trim();

      // Log de longitud de contenido
      console.log(
        `  ✓ RAP ${codigo}: Proceso=${conocimientos_proceso.length} Saber=${conocimientos_saber.length} Criterios=${criterios_evaluacion.length}`
      );

      return {
        codigo,
        denominacion,
        conocimientos_proceso,
        conocimientos_saber,
        criterios_evaluacion,
      };
    });

    return rapsEstructurados;
  }
}

module.exports = RapParser;

import json
import pdfplumber
import re
import sys
import unicodedata
import os

def log_debug(mensaje):
    """Enviar logs a stderr para no contaminar stdout"""
    print(mensaje, file=sys.stderr, flush=True)


def strip_accents(s: str) -> str:
    """Eliminar acentos de un texto"""
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def norm(s: str) -> str:
    """Normalizar texto: sin acentos, mayúsculas, espacios limpios"""
    s = strip_accents(s or "").upper()
    s = re.sub(r"\s+", " ", s)
    return s.strip()


# === PALABRAS CLAVE ===
TARGET_COMPETENCIA = "UNIDAD DE COMPETENCIA"
TARGET_CODIGO = "CODIGO NORMA DE COMPETENCIA LABORAL"
TARGET_NOMBRE = "NOMBRE DE LA COMPETENCIA"
TARGET_HORA = "DURACION MAXIMA ESTIMADA"
TARGET_RESULTADOS = "RESULTADOS DE APRENDIZAJE"
TARGET_CONOCIMIENTOS_PROCESO = "CONOCIMIENTOS DE PROCESO"
TARGET_CRITERIOS_EVALUACION = "CRITERIOS DE EVALUACION"
TARGET_CONOCIMIENTOS_SABER = "CONOCIMIENTOS DEL SABER"

IGNORE_KEYS = [
    "LINEA TECNOLOGICA",
    "RED TECNOLOGICA",
    "RED DE CONOCIMIENTO",
    "DENOMINACION"
]

# Patrones de fin de sección
FIN_SECCION_PATTERNS = [
    r"PERFIL DEL INSTRUCTOR",
    r"REQUISITOS ACADEMICOS",
    r"4\.8\s+PERFIL",
    r"4\.8\.1",
    r"CONTENIDOS CURRICULARES DE LA COMPETENCIA"
]


def es_fin_seccion(texto):
    """Detecta si llegamos al final de la sección"""
    texto_norm = norm(texto)
    for pattern in FIN_SECCION_PATTERNS:
        if re.search(pattern, texto_norm):
            return True
    return False


def extraer_raps(pdf_path: str) -> list:
    """
    Extrae RAPs del PDF del programa SENA en el formato correcto
    
    Returns:
        list: Lista de diccionarios con estructura:
        {
            "codigo_competencia": "220201501",
            "competencia": "FISICA",
            "resultados_aprendizaje": ["RAP1", "RAP2", ...],
            "conocimientos_proceso": "texto con saltos de línea",
            "conocimientos_saber": "texto con saltos de línea",
            "criterios_evaluacion": "texto con saltos de línea"
        }
    """
    
    resultados = []
    registro_actual = {}
    
    # Flags de captura
    capturando_resultados = False
    capturando_conocimientos = False
    capturando_criterios = False
    capturando_saber = False
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for num_pagina, page in enumerate(pdf.pages, 1):
                log_debug(f"Procesando página {num_pagina}")
                
                tablas = page.extract_tables()
                
                for tabla in tablas:
                    for fila in tabla:
                        if not fila or not any(fila):
                            continue
                        
                        fila_texto = " ".join([c for c in fila if c]).strip()
                        fila_norm = norm(fila_texto)
                        celda_izq = norm(fila[0] or "")
                        
                        # === IGNORAR ENCABEZADOS ===
                        if any(key in fila_norm for key in IGNORE_KEYS):
                            continue
                        
                        # === DETECTAR NUEVA COMPETENCIA ===
                        if TARGET_COMPETENCIA in celda_izq:
                            # Guardar registro anterior si existe
                            if registro_actual:
                                    # Limpiar posibles líneas erróneas dentro de los resultados
                                if "resultados_aprendizaje" in registro_actual:
                                        registro_actual["resultados_aprendizaje"] = [ # type: ignore
                                            r for r in registro_actual["resultados_aprendizaje"]
                                            if not re.search(r"^\s*4\.6\s*CONOCIMIENTOS", norm(r))
                                        ] 
                                # Convertir listas a texto antes de guardar
                                if "conocimientos_proceso" in registro_actual and isinstance(registro_actual["conocimientos_proceso"], list):
                                    registro_actual["conocimientos_proceso"] = "\n".join(registro_actual["conocimientos_proceso"])
                                if "conocimientos_saber" in registro_actual and isinstance(registro_actual["conocimientos_saber"], list):
                                    registro_actual["conocimientos_saber"] = "\n".join(registro_actual["conocimientos_saber"])
                                if "criterios_evaluacion" in registro_actual and isinstance(registro_actual["criterios_evaluacion"], list):
                                    registro_actual["criterios_evaluacion"] = "\n".join(registro_actual["criterios_evaluacion"])
                                
                                resultados.append(registro_actual)
                                log_debug(f"Competencia guardada: {registro_actual.get('codigo_competencia')}")
                            
                            # Iniciar nuevo registro
                            registro_actual = {"competencia": (fila[1] or "").strip()}
                            capturando_resultados = False
                            capturando_conocimientos = False
                            capturando_criterios = False
                            capturando_saber = False
                            continue
                        
                        # === CAPTURAR CÓDIGO ===
                        if TARGET_CODIGO in celda_izq:
                            codigo = (fila[1] or "").strip()
                            if codigo and codigo != "999999999":  # Ignorar etapa práctica
                                registro_actual["codigo_competencia"] = codigo
                                log_debug(f"Código: {codigo}")
                            continue
                        
                        # === CAPTURAR NOMBRE ===
                        if TARGET_NOMBRE in celda_izq:
                            registro_actual["competencia"] = (fila[1] or "").strip()
                            continue
                        
                        # === DETECTAR FIN DE SECCIÓN ===
                        if es_fin_seccion(fila_texto):
                            capturando_resultados = False
                            capturando_conocimientos = False
                            capturando_criterios = False
                            capturando_saber = False
                            continue
                        
                        # === CAMBIAR SECCIÓN ===
                        if TARGET_RESULTADOS in celda_izq:
                            capturando_resultados = True
                            capturando_conocimientos = False
                            capturando_criterios = False
                            capturando_saber = False
                            registro_actual["resultados_aprendizaje"] = [] # type: ignore
                            log_debug("Capturando Resultados de Aprendizaje")
                            continue
                        
                        if TARGET_CONOCIMIENTOS_PROCESO in celda_izq:
                            capturando_conocimientos = True
                            capturando_resultados = False
                            capturando_criterios = False
                            capturando_saber = False
                            registro_actual["conocimientos_proceso"] = [] # type: ignore
                            log_debug("Capturando Conocimientos de Proceso")
                            continue
                        
                        if TARGET_CRITERIOS_EVALUACION in celda_izq:
                            capturando_criterios = True
                            capturando_resultados = False
                            capturando_conocimientos = False
                            capturando_saber = False
                            registro_actual["criterios_evaluacion"] = [] # type: ignore
                            log_debug("Capturando Criterios de Evaluación")
                            continue
                        
                        if TARGET_CONOCIMIENTOS_SABER in celda_izq:
                            capturando_saber = True
                            capturando_resultados = False
                            capturando_conocimientos = False
                            capturando_criterios = False
                            registro_actual["conocimientos_saber"] = [] # type: ignore
                            log_debug("Capturando Conocimientos del Saber")
                            continue
                        
                        # === CAPTURAR CONTENIDO ===
                        if capturando_resultados and fila_texto.strip():
                            registro_actual.setdefault("resultados_aprendizaje", []).append(fila_texto) # type: ignore
                        
                        elif capturando_conocimientos and fila_texto.strip():
                            registro_actual.setdefault("conocimientos_proceso", []).append(fila_texto) # type: ignore
                        
                        elif capturando_criterios and fila_texto.strip():
                            registro_actual.setdefault("criterios_evaluacion", []).append(fila_texto) # type: ignore
                        
                        elif capturando_saber and fila_texto.strip():
                            registro_actual.setdefault("conocimientos_saber", []).append(fila_texto) # type: ignore
        
        # === GUARDAR EL ÚLTIMO REGISTRO ===
        if registro_actual and registro_actual.get("codigo_competencia"):
            # Limpiar posibles líneas erróneas dentro de los resultados
            if "resultados_aprendizaje" in registro_actual:
                registro_actual["resultados_aprendizaje"] = [ # type: ignore
                    r for r in registro_actual["resultados_aprendizaje"]
                    if not re.search(r"^\s*4\.6\s*CONOCIMIENTOS", norm(r))
                    ]
            # Convertir listas a texto
            if "conocimientos_proceso" in registro_actual and isinstance(registro_actual["conocimientos_proceso"], list):
                registro_actual["conocimientos_proceso"] = "\n".join(registro_actual["conocimientos_proceso"])
            if "conocimientos_saber" in registro_actual and isinstance(registro_actual["conocimientos_saber"], list):
                registro_actual["conocimientos_saber"] = "\n".join(registro_actual["conocimientos_saber"])
            if "criterios_evaluacion" in registro_actual and isinstance(registro_actual["criterios_evaluacion"], list):
                registro_actual["criterios_evaluacion"] = "\n".join(registro_actual["criterios_evaluacion"])
            
            resultados.append(registro_actual)
            log_debug(f"Última competencia guardada: {registro_actual.get('codigo_competencia')}")
        
        log_debug(f"\nTotal competencias extraídas: {len(resultados)}")
        
        return resultados
    
    except Exception as e:
        log_debug(f"Error en extracción: {str(e)}")
        import traceback
        log_debug(traceback.format_exc())
        raise


def generar_resumen(competencias):
    """Genera resumen de extracción"""
    resumen = {}
    for comp in competencias:
        codigo = comp.get("codigo_competencia", "SIN_CODIGO")
        num_raps = len(comp.get("resultados_aprendizaje", []))
        resumen[codigo] = {
            "nombre": comp.get("competencia", ""),
            "num_raps": num_raps,
        }
    return resumen

# === PRUEBA DEL MÓDULO ===
if __name__ == "__main__":
    
    if len(sys.argv) < 2:
        print("Uso: python raps_extractor.py <ruta_pdf>", file=sys.stderr)
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    log_debug("=" * 60)
    log_debug("INICIANDO EXTRACCIÓN DE COMPETENCIAS Y RAPs")
    log_debug("=" * 60)
    
    # Extraer competencias
    competencias = extraer_raps(pdf_path)
    
    # Generar resumen
    resumen = generar_resumen(competencias)
    
    log_debug("\nResumen por competencia:")
    for cod in sorted(resumen.keys()):
        info = resumen[cod]
        log_debug(f"{info['nombre'][:60]}...")
    
    # Crear resultado en formato JSON
    resultado = {
        "success": True,
        "data": {
            "competencias": competencias,
            "resumen": {
                "total_competencias": len(competencias),
                "total_raps": sum(len(c.get("resultados_aprendizaje", [])) for c in competencias)
            }
        }
    }
    # --- SALIDA A STDOUT (PARA SERVER.JS) ---
    print(json.dumps(resultado, ensure_ascii=False, indent=2), flush=True)
/**
 * Recorrer el árbol de carpetas.
 *
 * La ruta de migas se reconstruía con un `while` dentro de la página del
 * Drive. Ahora hace falta en dos sitios (el Drive y la cabecera de un
 * documento), y conviene que el recorrido esté en un solo lugar por una razón
 * concreta: la base no tiene ni límite de profundidad ni nada que impida un
 * ciclo (`A.parent_id = B`, `B.parent_id = A` es perfectamente insertable).
 * Un `while` ingenuo sobre un ciclo no se detiene nunca y cuelga el render.
 */
export type Carpeta = {
  id: string;
  name: string;
  parent_id: string | null;
};

/** Hasta aquí llega el árbol antes de que demos por hecho que algo va mal. */
const MAX_PROFUNDIDAD = 50;

/**
 * Ruta desde la raíz hasta la carpeta dada, ambas incluidas.
 * Devuelve `[]` si la carpeta no existe (borrada, o de otra cuenta).
 */
export function rutaDeCarpeta(
  carpetas: Carpeta[],
  id: string | null | undefined
): Carpeta[] {
  if (!id) return [];

  const porId = new Map(carpetas.map((c) => [c.id, c]));
  const ruta: Carpeta[] = [];
  const vistas = new Set<string>();

  let actual = porId.get(id);
  while (actual && !vistas.has(actual.id) && ruta.length < MAX_PROFUNDIDAD) {
    vistas.add(actual.id);
    ruta.unshift(actual);
    actual = actual.parent_id ? porId.get(actual.parent_id) : undefined;
  }

  return ruta;
}

/** Carpetas que cuelgan directamente de `id` (o de la raíz con `null`). */
export function hijasDe(carpetas: Carpeta[], id: string | null): Carpeta[] {
  return carpetas.filter((c) => (c.parent_id ?? null) === id);
}

/**
 * Todo el subárbol que cuelga de `id`, sin incluirla. Hace falta para decir
 * cuánto se va a perder antes de borrar una carpeta.
 */
export function descendientesDe(carpetas: Carpeta[], id: string): Carpeta[] {
  const resultado: Carpeta[] = [];
  const vistas = new Set<string>([id]);
  let frontera = hijasDe(carpetas, id);

  let nivel = 0;
  while (frontera.length > 0 && nivel < MAX_PROFUNDIDAD) {
    const siguiente: Carpeta[] = [];
    for (const c of frontera) {
      if (vistas.has(c.id)) continue;
      vistas.add(c.id);
      resultado.push(c);
      siguiente.push(...hijasDe(carpetas, c.id));
    }
    frontera = siguiente;
    nivel++;
  }

  return resultado;
}

/**
 * Nombre con su ruta, para listas donde el nombre suelto no basta: en un
 * resultado de búsqueda hay que saber dónde vive cada documento.
 */
export function rutaLegible(
  carpetas: Carpeta[],
  id: string | null
): string {
  const ruta = rutaDeCarpeta(carpetas, id);
  if (ruta.length === 0) return "Mis documentos";
  return ["Mis documentos", ...ruta.map((c) => c.name)].join(" / ");
}

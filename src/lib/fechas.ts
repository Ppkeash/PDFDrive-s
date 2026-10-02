/**
 * Fechas, en un solo sitio y en una sola zona.
 *
 * Antes cada componente formateaba por su cuenta y en el cliente
 * (`document-row`, `document-workspace`, `plan-banner`), con dos
 * consecuencias: el formato dependía del ICU que tuviera instalado el
 * navegador, y un "hoy" calculado con la zona del equipo. Alguien conectado
 * desde otra zona veía un documento de ayer agrupado bajo "Hoy".
 *
 * FirmaDrive se usa en Colombia y los documentos son actas con fecha: la zona
 * se fija aquí, en el servidor, y a la pantalla llegan cadenas ya formadas.
 */
export const ZONA = "America/Bogota";

const fmtFecha = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const fmtFechaCorta = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA,
  day: "2-digit",
  month: "short",
});

const fmtHora = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fmtMesYAno = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA,
  month: "long",
  year: "numeric",
});

/** "02 oct 2026" */
export function formatearFecha(iso: string): string {
  return limpiar(fmtFecha.format(new Date(iso)));
}

/** "02 oct" — para lo del año en curso, donde el año es ruido. */
export function formatearFechaCorta(iso: string): string {
  return limpiar(fmtFechaCorta.format(new Date(iso)));
}

/** "14:32" */
export function formatearHora(iso: string): string {
  return fmtHora.format(new Date(iso));
}

/** "02 oct 2026, 14:32" */
export function formatearFechaHora(iso: string): string {
  return `${formatearFecha(iso)}, ${formatearHora(iso)}`;
}

/**
 * Días que faltan para una fecha, contando por días civiles y no por horas:
 * algo que vence mañana a las 8 am "falta 1 día", aunque falten 14 horas.
 */
export function diasHasta(iso: string): number {
  return Math.max(0, diferenciaEnDias(diaCivil(new Date(iso)), hoyCivil()));
}

/** Días transcurridos desde una fecha, por días civiles. */
export function diasDesde(iso: string): number {
  return Math.max(0, diferenciaEnDias(hoyCivil(), diaCivil(new Date(iso))));
}

// `es-CO` escribe los meses abreviados con punto ("02 oct. 2026") y, en
// algunos ICU, mete un espacio fino antes del año. Se limpia para que la
// cadena sea estable entre servidor y navegador.
function limpiar(s: string): string {
  return s.replace(/\./g, "").replace(/ | /g, " ");
}

/** Año, mes y día tal como se viven en Bogotá, no en UTC. */
type DiaCivil = { ano: number; mes: number; dia: number };

function diaCivil(d: Date): DiaCivil {
  // `en-CA` da directamente "2026-10-02", que es lo más fácil de partir.
  const [ano, mes, dia] = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .split("-")
    .map(Number);
  return { ano, mes, dia };
}

function hoyCivil(): DiaCivil {
  return diaCivil(new Date());
}

/** Días enteros entre dos días civiles (a - b). */
function diferenciaEnDias(a: DiaCivil, b: DiaCivil): number {
  const ms =
    Date.UTC(a.ano, a.mes - 1, a.dia) - Date.UTC(b.ano, b.mes - 1, b.dia);
  return Math.round(ms / 86_400_000);
}

/**
 * Lo más corto que sigue siendo claro: la hora si es de hoy, "Ayer" con hora
 * si es de ayer, día y mes si es de este año, y con año si es más viejo.
 *
 * Dentro de un grupo "Hoy" repetir la fecha no informa de nada; la hora sí.
 */
export function etiquetaDeFecha(iso: string): string {
  const d = new Date(iso);
  const dia = diaCivil(d);
  const hoy = hoyCivil();
  const dias = diferenciaEnDias(hoy, dia);

  if (dias <= 0) return formatearHora(iso);
  if (dias === 1) return `Ayer, ${formatearHora(iso)}`;
  if (dia.ano === hoy.ano) return limpiar(fmtFechaCorta.format(d));
  return limpiar(fmtFecha.format(d));
}

/**
 * Medianoche en Bogotá de hace `diasAtras` días, en ISO, para filtrar por
 * fecha de subida.
 *
 * El desplazamiento va escrito (`-05:00`) en vez de calculado: Colombia no
 * tiene horario de verano, así que es un dato fijo y no una suposición. Si
 * algún día dejara de serlo, esto es lo que habría que cambiar.
 */
export function inicioDelDia(diasAtras = 0): string {
  const hoy = hoyCivil();
  const base = new Date(Date.UTC(hoy.ano, hoy.mes - 1, hoy.dia));
  base.setUTCDate(base.getUTCDate() - diasAtras);

  const a = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  return new Date(`${a}-${m}-${d}T00:00:00-05:00`).toISOString();
}

export type GrupoDeFecha<T> = {
  /** Estable, para la `key` de React y para comparar grupos. */
  clave: string;
  titulo: string;
  items: T[];
};

/**
 * Agrupa por antigüedad, como un gestor de archivos: Hoy · Ayer · Esta
 * semana · Este mes · Septiembre 2026 · Agosto 2026…
 *
 * No reordena: recorre la lista en el orden en que llega y abre un grupo
 * nuevo cada vez que cambia la clave. Eso la deja servir igual para "más
 * reciente primero" y para "más antiguo primero", y evita que el orden que
 * eligió la persona se pierda al agrupar.
 */
export function agruparPorFecha<T>(
  items: T[],
  fechaDe: (item: T) => string
): GrupoDeFecha<T>[] {
  const hoy = hoyCivil();
  const grupos: GrupoDeFecha<T>[] = [];

  for (const item of items) {
    const fecha = new Date(fechaDe(item));
    const dia = diaCivil(fecha);
    const dias = diferenciaEnDias(hoy, dia);
    const mismoMes = dia.ano === hoy.ano && dia.mes === hoy.mes;

    let clave: string;
    let titulo: string;

    if (dias <= 0) {
      clave = "hoy";
      titulo = "Hoy";
    } else if (dias === 1) {
      clave = "ayer";
      titulo = "Ayer";
    } else if (dias < 7) {
      clave = "semana";
      titulo = "Esta semana";
    } else if (mismoMes) {
      clave = "mes";
      titulo = "Este mes";
    } else {
      clave = `${dia.ano}-${dia.mes}`;
      titulo = capitalizar(fmtMesYAno.format(fecha));
    }

    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.items.push(item);
    else grupos.push({ clave, titulo, items: [item] });
  }

  return grupos;
}

/** "septiembre de 2026" → "Septiembre de 2026" */
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Texto para buscar: sin tildes y en minúsculas, igual que la columna
 * `name_norm` que calcula la base (`lower(f_unaccent(name))`). Las dos
 * normalizaciones tienen que coincidir o el buscador no encuentra nada.
 */
export function normalizarBusqueda(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

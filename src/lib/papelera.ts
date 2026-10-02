/**
 * Cuánto vive un documento en la papelera antes de que la tarea programada
 * (`purge-trash`) lo borre de verdad.
 *
 * Vive aquí y no en la página porque una página de Next no puede exportar
 * nada que no sea el componente y su configuración. El mismo número está en
 * la migración que programa la purga: si cambia uno, hay que cambiar el otro.
 */
export const DIAS_EN_PAPELERA = 30;

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/spinner";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, FileUp, UploadCloud, X } from "lucide-react";

const ACEPTADOS = ".pdf,.docx";
const MIME_OK = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/**
 * Tope por archivo. No había ninguno: un archivo de 300 MB se intentaba subir
 * entero y fallaba contra el límite del bucket, con un mensaje que no decía
 * nada. Mejor decirlo antes de gastar la conexión de la persona.
 */
const MAX_BYTES = 25 * 1024 * 1024;

type Estado = "espera" | "subiendo" | "listo" | "error";

type EnCola = {
  id: string;
  file: File | null;
  /** Nombre final, ya desambiguado si había otro igual en la carpeta. */
  nombre: string;
  estado: Estado;
  motivo?: string;
};

/**
 * Subida de documentos: varios a la vez, y con arrastrar y soltar.
 *
 * Antes se subía de uno en uno (`files?.[0]`), lo que para un lote de actas
 * de una reunión significaba repetir el diálogo del sistema veinte veces.
 *
 * La cola es **secuencial a propósito**. Veinte subidas en paralelo saturan
 * una conexión de oficina, hacen que todas vayan lentas a la vez y convierten
 * un fallo en veinte fallos simultáneos imposibles de leer. De a uno, se ve
 * exactamente en qué archivo va y cuál falló.
 *
 * Nota sobre el plan: subir no consume cupo. El cupo cuenta documentos
 * *completados* en el mes (`billing_usage_events`), así que aquí no hay nada
 * que comprobar -- poner un freno antes de subir sería inventarse un límite
 * que no existe.
 */
export function Uploader({
  folderId = null,
  folderName = null,
}: {
  folderId?: string | null;
  folderName?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [cola, setCola] = useState<EnCola[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  // Un contador, no un booleano: `dragleave` salta también al pasar de un
  // hijo a otro, y con un booleano el aviso parpadeaba sin parar.
  const profundidad = useRef(0);

  const destino = folderName ?? "Mis documentos";

  /** Nombres ya ocupados en la carpeta, para no dejar dos "Acta.pdf". */
  const nombresOcupados = useCallback(async () => {
    const q = supabase
      .from("documents")
      .select("name")
      .is("deleted_at", null)
      .limit(1000);
    const { data } = folderId
      ? await q.eq("folder_id", folderId)
      : await q.is("folder_id", null);
    return new Set((data ?? []).map((d) => d.name.toLowerCase()));
  }, [folderId, supabase]);

  const subir = useCallback(
    async (archivos: File[]) => {
      if (archivos.length === 0) return;

      const rechazados: EnCola[] = [];
      const buenos: File[] = [];

      for (const file of archivos) {
        if (!MIME_OK.includes(file.type)) {
          rechazados.push({
            id: crypto.randomUUID(),
            file: null,
            nombre: file.name,
            estado: "error",
            motivo: "No es un PDF ni un .docx",
          });
        } else if (file.size > MAX_BYTES) {
          rechazados.push({
            id: crypto.randomUUID(),
            file: null,
            nombre: file.name,
            estado: "error",
            motivo: `Pesa ${megas(file.size)} MB; el máximo es ${megas(MAX_BYTES)} MB`,
          });
        } else {
          buenos.push(file);
        }
      }

      const ocupados: Set<string> =
        buenos.length > 0 ? await nombresOcupados() : new Set();
      const pendientes: EnCola[] = buenos.map((file) => {
        const nombre = nombreLibre(file.name, ocupados);
        // Se reserva ya, para que dos archivos del mismo lote con el mismo
        // nombre no acaben los dos como "Acta (2).pdf".
        ocupados.add(nombre.toLowerCase());
        return {
          id: crypto.randomUUID(),
          file,
          nombre,
          estado: "espera" as Estado,
        };
      });

      setCola((c) => [...c, ...rechazados, ...pendientes]);
      if (pendientes.length === 0) return;

      setTrabajando(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      for (const item of pendientes) {
        if (!user) {
          marcar(item.id, "error", "Tu sesión caducó. Vuelve a entrar.");
          continue;
        }
        marcar(item.id, "subiendo");

        const file = item.file!;
        const ruta = `${user.id}/${crypto.randomUUID()}-${item.nombre}`;

        const { error: errSubida } = await supabase.storage
          .from("originals")
          .upload(ruta, file, { contentType: file.type });
        if (errSubida) {
          marcar(item.id, "error", errSubida.message);
          continue;
        }

        const { error: errFila } = await supabase.from("documents").insert({
          owner_id: user.id,
          name: item.nombre,
          storage_path: ruta,
          mime: file.type,
          status: "borrador",
          folder_id: folderId,
        });

        if (errFila) {
          // Sin esto quedaba un archivo en Storage que ninguna fila nombra:
          // invisible en la aplicación y imposible de limpiar sin entrar al
          // panel de Supabase.
          await supabase.storage.from("originals").remove([ruta]);
          marcar(item.id, "error", errFila.message);
          continue;
        }

        marcar(item.id, "listo");
      }

      setTrabajando(false);
      router.refresh();
    },
    [folderId, nombresOcupados, router, supabase]
  );

  function marcar(id: string, estado: Estado, motivo?: string) {
    setCola((c) =>
      c.map((i) => (i.id === id ? { ...i, estado, motivo } : i))
    );
  }

  // Arrastrar sobre cualquier parte de la página: pedirle a la persona que
  // acierte en un rectángulo pequeño con el ratón cargado de archivos es una
  // prueba de pulso, no una interfaz.
  useEffect(() => {
    function tieneArchivos(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }

    function onEnter(e: DragEvent) {
      if (!tieneArchivos(e)) return;
      profundidad.current++;
      setArrastrando(true);
    }
    function onOver(e: DragEvent) {
      if (!tieneArchivos(e)) return;
      e.preventDefault(); // sin esto el navegador abre el archivo
    }
    function onLeave() {
      profundidad.current = Math.max(0, profundidad.current - 1);
      if (profundidad.current === 0) setArrastrando(false);
    }
    function onDrop(e: DragEvent) {
      if (!tieneArchivos(e)) return;
      e.preventDefault();
      profundidad.current = 0;
      setArrastrando(false);
      void subir(Array.from(e.dataTransfer?.files ?? []));
    }

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [subir]);

  const listos = cola.filter((i) => i.estado === "listo").length;
  const fallidos = cola.filter((i) => i.estado === "error").length;
  const enCurso = cola.find((i) => i.estado === "subiendo");
  // Solo cuentan los que de verdad se intentan subir: lo rechazado por tipo
  // o por tamaño nunca entró a la cola.
  const total = cola.filter((i) => i.file).length;
  const resueltos = cola.filter(
    (i) => i.file && (i.estado === "listo" || i.estado === "error")
  ).length;

  return (
    <>
      {/* Un `label` de verdad sobre un input real: funciona con teclado y el
          lector de pantalla lo anuncia como lo que es. */}
      <label
        className={cn(
          "inline-flex h-10 cursor-pointer items-center gap-2 rounded bg-seal px-3.5 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90",
          trabajando && "pointer-events-none opacity-60"
        )}
      >
        {trabajando ? <Spinner /> : <FileUp className="h-4 w-4" />}
        {trabajando ? "Subiendo…" : "Subir documentos"}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACEPTADOS}
          className="sr-only"
          onChange={(e) => {
            void subir(Array.from(e.target.files ?? []));
            // Permite volver a elegir el mismo archivo después de un fallo.
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
      </label>

      {arrastrando && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-6 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-seal bg-surface px-10 py-12 text-center">
            <UploadCloud className="h-8 w-8 text-seal" aria-hidden />
            <p className="font-display text-lg font-semibold">
              Suelta los archivos
            </p>
            <p className="text-sm text-muted">
              Se suben a <strong className="font-medium text-ink">{destino}</strong>
              . PDF o .docx, hasta {megas(MAX_BYTES)} MB cada uno.
            </p>
          </div>
        </div>
      )}

      {cola.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[65] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-pop md:bottom-5 md:right-5">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-sm font-medium" aria-live="polite">
              {trabajando
                ? `Subiendo ${Math.min(resueltos + 1, total)} de ${total}`
                : fallidos > 0
                  ? `${listos} de ${total} subidos · ${fallidos} con error`
                  : `${listos} ${listos === 1 ? "documento" : "documentos"} subidos`}
            </p>
            <button
              onClick={() => setCola([])}
              disabled={trabajando}
              aria-label="Cerrar el detalle de la subida"
              className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="max-h-64 divide-y divide-line overflow-y-auto">
            {cola.map((i) => (
              <li key={i.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <span className="mt-0.5 shrink-0">
                  {i.estado === "listo" ? (
                    <Check className="h-4 w-4 text-ok" aria-hidden />
                  ) : i.estado === "error" ? (
                    <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
                  ) : i.estado === "subiendo" ? (
                    <Spinner className="h-4 w-4 text-seal" />
                  ) : (
                    <span className="block h-4 w-4 rounded-full border border-line-strong" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{i.nombre}</span>
                  {i.estado === "error" ? (
                    <span className="block text-xs text-danger">{i.motivo}</span>
                  ) : i.estado === "espera" ? (
                    <span className="block text-xs text-muted">En espera</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          {!trabajando && fallidos > 0 && (
            <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
              Lo que falló no se subió. Puedes volver a intentarlo con esos
              archivos; el resto ya está en {destino}.
            </p>
          )}
        </div>
      )}

      {/* Mientras algo se sube, el detalle de arriba lo cuenta. Esto es para
          quien navegue con lector de pantalla y no tenga el panel enfocado. */}
      <span className="sr-only" role="status">
        {enCurso ? `Subiendo ${enCurso.nombre}` : ""}
      </span>
    </>
  );
}

function megas(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
}

/**
 * "Acta.pdf" ya ocupado → "Acta (2).pdf". Se conserva la extensión: un
 * "Acta.pdf (2)" dejaría de abrirse como PDF en la mitad de los programas.
 */
function nombreLibre(nombre: string, ocupados: Set<string>): string {
  if (!ocupados.has(nombre.toLowerCase())) return nombre;

  const punto = nombre.lastIndexOf(".");
  const base = punto > 0 ? nombre.slice(0, punto) : nombre;
  const ext = punto > 0 ? nombre.slice(punto) : "";

  for (let n = 2; n < 1000; n++) {
    const intento = `${base} (${n})${ext}`;
    if (!ocupados.has(intento.toLowerCase())) return intento;
  }
  return `${base} (${Date.now()})${ext}`;
}

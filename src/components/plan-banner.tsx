import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

/**
 * Aviso del plan sobre el Drive.
 *
 * Existe para que el límite no sea una sorpresa: el día que se encienda el
 * cobro (`billing_enforcement_enabled`), nadie debería enterarse de que tenía
 * un cupo justo en el momento en que se queda sin él.
 *
 * Solo aparece cuando hay algo que decir: con la prueba recién empezada y
 * documentos de sobra, estorba.
 */
export interface Cupo {
  plan: string;
  en_prueba?: boolean;
  vence?: string | null;
  incluidos?: number;
  usados?: number;
  restantes?: number;
  creditos?: number;
  permitido?: boolean;
  sin_espacio?: boolean;
}

function diasHasta(fecha: string): number {
  const ms = new Date(fecha).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function PlanBanner({ cupo }: { cupo: Cupo | null }) {
  if (!cupo || cupo.sin_espacio) return null;

  const restantes = cupo.restantes ?? 0;
  const creditos = cupo.creditos ?? 0;
  const dias = cupo.vence ? diasHasta(cupo.vence) : null;

  const sinCupo = restantes === 0 && creditos === 0;
  const pocosDocumentos = restantes > 0 && restantes <= 3;
  const pruebaAcabando = Boolean(cupo.en_prueba && dias !== null && dias <= 5);

  // Silencio mientras todo va bien.
  if (!sinCupo && !pocosDocumentos && !pruebaAcabando) return null;

  const grave = sinCupo;
  const Icono = grave ? AlertTriangle : Clock;

  let mensaje: string;
  if (sinCupo) {
    mensaje =
      "Se acabaron los documentos de este mes. Puedes seguir subiendo y firmando, pero conviene activar un plan.";
  } else if (pruebaAcabando && dias === 0) {
    mensaje = "Tu prueba termina hoy.";
  } else if (pruebaAcabando) {
    mensaje = `Te ${dias === 1 ? "queda" : "quedan"} ${dias} ${
      dias === 1 ? "día" : "días"
    } de prueba.`;
  } else {
    mensaje = `Te ${restantes === 1 ? "queda" : "quedan"} ${restantes} ${
      restantes === 1 ? "documento" : "documentos"
    } este mes.`;
  }

  return (
    <div
      className={`mt-6 flex gap-2.5 rounded border-l-2 px-4 py-3 text-sm ${
        grave
          ? "border-danger bg-surface-2 text-ink"
          : "border-wait bg-wait-soft text-muted"
      }`}
    >
      <Icono
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          grave ? "text-danger" : "text-wait"
        }`}
        aria-hidden
      />
      <span>
        {mensaje}{" "}
        {creditos > 0 && (
          <>
            Te {creditos === 1 ? "queda" : "quedan"} {creditos} de tus
            documentos sueltos.{" "}
          </>
        )}
        <Link
          href="/planes"
          className="font-medium text-seal underline decoration-seal/30 underline-offset-4 hover:decoration-seal"
        >
          Ver planes
        </Link>
      </span>
    </div>
  );
}

import Link from "next/link";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  BILLING_PLANS,
  DOCUMENT_CREDIT_PACK,
  PLAN_CODES,
  formatCop,
} from "@/lib/billing/plans";
import type { Cupo } from "@/components/plan-banner";

/**
 * Planes y consumo.
 *
 * Todavía no hay checkout: el botón de cada plan no cobra, porque conectar
 * Wompi es otro trabajo. Pero la pantalla ya existe, y eso importa antes de
 * encender el límite -- enterarse de que hay un cupo justo cuando se acaba es
 * la peor forma de descubrirlo.
 */
export default async function PlanesPage() {
  const supabase = createClient();
  const { data: cupoRaw } = await supabase.rpc("mi_cupo_de_documentos");
  const cupo = (cupoRaw as Cupo | null) ?? null;

  const actual = cupo?.plan ?? "free";
  const dias = cupo?.vence
    ? Math.max(
        0,
        Math.ceil((new Date(cupo.vence).getTime() - Date.now()) / 86_400_000)
      )
    : null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="font-display text-3xl font-semibold">Planes</h1>
        <p className="mt-1.5 text-sm text-muted">
          Se cuenta un documento cuando queda firmado por todas las partes.
          Subirlo, compartirlo o firmarlo a medias no gasta nada, y quien firma
          por invitación nunca paga.
        </p>
      </header>

      {cupo && !cupo.sin_espacio && (
        <section className="mt-6 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-micro uppercase text-muted">Tu consumo</h2>
          <p className="mt-2 text-sm">
            Plan{" "}
            <strong className="font-medium">
              {BILLING_PLANS[actual as keyof typeof BILLING_PLANS]?.name ??
                actual}
            </strong>
            {cupo.en_prueba && dias !== null && (
              <>
                {" "}
                — en prueba, {dias === 0 ? "termina hoy" : `${dias} día${dias === 1 ? "" : "s"} restante${dias === 1 ? "" : "s"}`}
              </>
            )}
            .
          </p>
          <p className="mt-1 text-sm text-muted">
            {cupo.usados ?? 0} de {cupo.incluidos ?? 0} documentos este mes
            {(cupo.creditos ?? 0) > 0 && <> · {cupo.creditos} sueltos</>}
          </p>
        </section>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {PLAN_CODES.map((code) => {
          const plan = BILLING_PLANS[code];
          const esActual = code === actual;

          return (
            <article
              key={code}
              className={`flex flex-col rounded-lg border bg-surface p-5 ${
                esActual ? "border-seal" : "border-line"
              }`}
            >
              <h3 className="font-display text-lg font-semibold">
                {plan.name}
              </h3>
              <p className="mt-1 text-2xl font-semibold">
                {plan.monthlyPriceCop === 0
                  ? "Gratis"
                  : formatCop(plan.monthlyPriceCop)}
                {plan.monthlyPriceCop > 0 && (
                  <span className="text-sm font-normal text-muted"> /mes</span>
                )}
              </p>
              <p className="mt-2 text-sm text-muted">
                {plan.completedDocumentsPerMonth} documentos al mes
              </p>

              <ul className="mt-4 flex flex-col gap-1.5 text-sm text-muted">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-seal"
                      aria-hidden
                    />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-5 pt-1">
                {esActual ? (
                  <span className="text-micro uppercase text-seal">
                    Tu plan
                  </span>
                ) : (
                  <span className="text-sm text-muted">
                    Escríbenos para activarlo
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="mt-5 rounded-lg border border-dashed border-line-strong bg-surface-2 p-5">
        <h2 className="font-display text-base font-semibold">
          {DOCUMENT_CREDIT_PACK.name}
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          {formatCop(DOCUMENT_CREDIT_PACK.priceCop)} por{" "}
          {DOCUMENT_CREDIT_PACK.quantity} documentos, sin suscripción. Se usan
          cuando se acaban los del mes y duran un año.
        </p>
      </section>

      <p className="mt-6 text-sm text-muted">
        El pago todavía no está conectado. Mientras tanto, escríbenos y lo
        activamos a mano.{" "}
        <Link
          href="/drive"
          className="font-medium text-seal underline decoration-seal/30 underline-offset-4 hover:decoration-seal"
        >
          Volver a mis documentos
        </Link>
      </p>
    </div>
  );
}

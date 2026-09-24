import { getPlan, type PlanCode } from "@/lib/billing/plans";

export interface BillingUsageSnapshot {
  planCode: PlanCode;
  completedDocumentsThisPeriod: number;
  documentCreditsAvailable: number;
}

export interface DocumentEntitlement {
  allowed: boolean;
  includedRemaining: number;
  creditsRemaining: number;
  source: "included" | "credits" | "none";
}

/**
 * Evaluación pura y sin efectos. Todavía no está conectada al flujo de firma:
 * sirve para que UI, Server Actions y Edge Functions compartan la misma regla
 * cuando se active el cobro.
 */
export function evaluateDocumentEntitlement(
  usage: BillingUsageSnapshot
): DocumentEntitlement {
  const plan = getPlan(usage.planCode);
  const includedRemaining = Math.max(
    0,
    plan.completedDocumentsPerMonth - usage.completedDocumentsThisPeriod
  );
  const creditsRemaining = Math.max(0, usage.documentCreditsAvailable);

  if (includedRemaining > 0) {
    return {
      allowed: true,
      includedRemaining,
      creditsRemaining,
      source: "included",
    };
  }

  if (creditsRemaining > 0) {
    return {
      allowed: true,
      includedRemaining,
      creditsRemaining,
      source: "credits",
    };
  }

  return {
    allowed: false,
    includedRemaining,
    creditsRemaining,
    source: "none",
  };
}

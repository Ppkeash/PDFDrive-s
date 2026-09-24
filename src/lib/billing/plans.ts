/**
 * Catálogo comercial visible en la aplicación.
 *
 * La base de datos conserva una copia autoritativa para facturación. Mantener
 * ambos catálogos sincronizados cuando se cambien precios o cupos.
 */
export const PLAN_CODES = ["free", "personal", "team"] as const;

export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  monthlyPriceCop: number;
  annualPriceCop: number;
  completedDocumentsPerMonth: number;
  organizerSeats: number;
  externalSignersAreFree: true;
  features: readonly string[];
}

export const BILLING_PLANS: Record<PlanCode, PlanDefinition> = {
  free: {
    code: "free",
    name: "Gratis",
    monthlyPriceCop: 0,
    annualPriceCop: 0,
    completedDocumentsPerMonth: 3,
    organizerSeats: 1,
    externalSignersAreFree: true,
    features: ["Firmantes externos gratis", "Auditoría básica"],
  },
  personal: {
    code: "personal",
    name: "Personal",
    monthlyPriceCop: 12_900,
    annualPriceCop: 129_000,
    completedDocumentsPerMonth: 20,
    organizerSeats: 1,
    externalSignersAreFree: true,
    features: [
      "Firmantes externos gratis",
      "Vencimientos y recordatorios",
      "5 plantillas",
    ],
  },
  team: {
    code: "team",
    name: "Equipo",
    monthlyPriceCop: 39_900,
    annualPriceCop: 399_000,
    completedDocumentsPerMonth: 100,
    organizerSeats: 3,
    externalSignersAreFree: true,
    features: [
      "Firmantes externos gratis",
      "Espacio compartido",
      "Plantillas y comentarios",
      "Marca y reportes de auditoría",
    ],
  },
};

/** Alternativa para quien no quiere otra suscripción. */
export const DOCUMENT_CREDIT_PACK = {
  code: "documents_10",
  name: "10 documentos",
  priceCop: 14_900,
  quantity: 10,
  validForDays: 365,
} as const;

export function getPlan(code: string | null | undefined): PlanDefinition {
  return BILLING_PLANS[code as PlanCode] ?? BILLING_PLANS.free;
}

export function formatCop(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

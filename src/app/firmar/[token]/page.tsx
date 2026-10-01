import { Cartel, FirmarCliente, type Cupo } from "./firmar-cliente";

/**
 * Pantalla pública de firma por enlace.
 *
 * No hay sesión ni la va a haber: quien llega aquí recibió un enlace por
 * WhatsApp o correo. Todo lo que decide si puede firmar vive en la edge
 * function `open-signing-link`, que valida el token con service_role — desde
 * aquí nunca se consulta la base directamente.
 */
export const dynamic = "force-dynamic";

const MOTIVOS: Record<string, { titulo: string; detalle: string }> = {
  no_existe: {
    titulo: "Este enlace no funciona",
    detalle:
      "Puede estar mal copiado o haber sido desactivado. Pídele uno nuevo a quien te lo envió.",
  },
  ya_usado: {
    titulo: "Este enlace ya se usó",
    detalle:
      "Sirve una sola vez y alguien ya firmó con él. Si necesitas firmar otra vez, pide un enlace nuevo.",
  },
  revocado: {
    titulo: "Este enlace fue desactivado",
    detalle: "Quien lo envió lo dio de baja. Pídele uno nuevo.",
  },
  vencido: {
    titulo: "Este enlace venció",
    detalle: "Pídele uno nuevo a quien te lo envió.",
  },
  documento_cerrado: {
    titulo: "El documento ya está cerrado",
    detalle: "Se firmó por completo y ya no admite más firmas.",
  },
  lista_completa: {
    titulo: "Ya firmaron todos",
    detalle:
      "Todas las personas de la lista firmaron este documento. Si creías que faltaba tu firma, avísale a quien te envió el enlace.",
  },
  cupo_lleno: {
    titulo: "Este enlace ya se llenó",
    detalle:
      "Recibió todas las firmas que admitía. Si faltaba la tuya, pídele uno nuevo a quien te lo envió.",
  },
  sin_espacios: {
    titulo: "Ya no quedan espacios",
    detalle:
      "Se ocuparon todos los espacios de firma de este documento. Avísale a quien te envió el enlace.",
  },
  campo_ya_firmado: {
    titulo: "Ese espacio ya está firmado",
    detalle: "Alguien firmó ahí antes. Pide un enlace nuevo si hace falta.",
  },
  pdf_no_disponible: {
    titulo: "No se pudo abrir el documento",
    detalle: "Vuelve a intentarlo en un momento.",
  },
};

export default async function FirmarPage({
  params,
}: {
  params: { token: string };
}) {
  let data: Record<string, unknown> | null = null;

  try {
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/open-signing-link`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ token: params.token }),
        cache: "no-store",
      }
    );
    data = await r.json();
  } catch {
    data = null;
  }

  if (!data?.ok) {
    const motivo = (data?.motivo as string) ?? "no_existe";
    const copia = MOTIVOS[motivo] ?? MOTIVOS.no_existe;
    return <Cartel titulo={copia.titulo} detalle={copia.detalle} />;
  }

  return (
    <FirmarCliente
      token={params.token}
      datos={{
        kind: (data.kind as "individual" | "grupal") ?? "individual",
        cupos: (data.cupos as Cupo[] | null) ?? null,
        documento: data.documento as string,
        etiqueta: (data.etiqueta as string | null) ?? null,
        pdfUrl: data.pdf_url as string,
        campo: (data.campo as DatosCampo | null) ?? null,
      }}
    />
  );
}

type DatosCampo = { page: number; x: number; y: number; w: number; h: number };

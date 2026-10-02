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
    titulo: "El enlace no es válido",
    detalle:
      "Puede estar mal copiado o haber sido desactivado. Solicita uno nuevo a quien te lo envió.",
  },
  ya_usado: {
    titulo: "El enlace ya fue utilizado",
    detalle:
      "Es válido una sola vez y ya se registró una firma con él. Si necesitas firmar de nuevo, solicita otro enlace.",
  },
  revocado: {
    titulo: "El enlace fue desactivado",
    detalle: "Quien lo envió lo desactivó. Solicita uno nuevo.",
  },
  vencido: {
    titulo: "El enlace caducó",
    detalle: "Solicita uno nuevo a quien te lo envió.",
  },
  documento_cerrado: {
    titulo: "El documento ya está cerrado",
    detalle: "Se firmó por completo y no admite más firmas.",
  },
  lista_completa: {
    titulo: "Las firmas están completas",
    detalle:
      "Todas las personas de la lista firmaron el documento. Si consideras que falta tu firma, comunícate con quien te envió el enlace.",
  },
  cupo_lleno: {
    titulo: "El enlace alcanzó su límite de firmas",
    detalle:
      "Registró todas las firmas que admitía. Si falta la tuya, solicita un enlace nuevo a quien te lo envió.",
  },
  sin_espacios: {
    titulo: "No quedan espacios de firma",
    detalle:
      "Se ocuparon todos los espacios de firma del documento. Comunícate con quien te envió el enlace.",
  },
  campo_ya_firmado: {
    titulo: "Ese espacio ya está firmado",
    detalle:
      "Otra persona firmó allí antes. Solicita un enlace nuevo si es necesario.",
  },
  pdf_no_disponible: {
    titulo: "No se pudo abrir el documento",
    detalle: "Inténtalo de nuevo en un momento.",
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

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  ACCESS_COOKIE,
  accessCookieIsValid,
  clientIp,
  gateEnabled,
  ipIsAllowed,
  issueAccessCookie,
  passphraseFromRequest,
  passphraseMatches,
  stripPassphrase,
} from "@/lib/access-gate";

// `robots.txt` se sirve siempre: es justamente lo que le pide a los buscadores
// que no indexen nada. Taparlo con un 404 sería contraproducente.
const GATE_EXEMPT = new Set(["/robots.txt"]);

// Los enlaces de firma se mandan a gente de fuera -- un proveedor, un cliente,
// alguien que no trabaja aquí. Si la puerta se enciende, esto tiene que seguir
// abriendo o el enlace deja de servir para lo único que sirve. El token es su
// propia credencial, así que no se está abriendo nada más.
const GATE_EXEMPT_PREFIX = ["/firmar/"];

/** 404 seco: ni marca, ni pista de que aquí haya una aplicación. */
function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Se resuelven antes que nada: `updateSession` protege rutas privadas y
  // mandaría `robots.txt` a /login, que es justo lo contrario de lo buscado.
  if (
    GATE_EXEMPT.has(path) ||
    GATE_EXEMPT_PREFIX.some((p) => path.startsWith(p))
  )
    return NextResponse.next({ request });

  if (gateEnabled()) {
    // Canje de la frase por cookie: se redirige a la misma URL sin el
    // parámetro para que no quede en el historial ni en un enlace compartido.
    const candidate = passphraseFromRequest(request);
    if (candidate !== null) {
      if (!passphraseMatches(candidate)) return notFound();

      const { value, maxAge } = await issueAccessCookie();
      const response = NextResponse.redirect(
        stripPassphrase(request.nextUrl)
      );
      response.cookies.set(ACCESS_COOKIE, value, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge,
      });
      return response;
    }

    const allowed =
      ipIsAllowed(clientIp(request)) ||
      (await accessCookieIsValid(request.cookies.get(ACCESS_COOKIE)?.value));

    if (!allowed) return notFound();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    // Todo excepto estáticos.
    //
    // La lista solo tenía imágenes, y eso rompía la firma por enlace: el visor
    // de PDF carga `/pdf.worker.min.mjs`, el middleware lo trataba como una
    // ruta privada y le devolvía una redirección al login a quien no tuviera
    // sesión. El visor recibía HTML donde esperaba código y moría con un
    // escueto "No se pudo abrir el PDF".
    //
    // Pasaba desapercibido porque pdf.js, al no poder cargar el worker, cae a
    // un modo de respaldo que corre en el hilo principal: en un equipo rápido
    // el documento igual aparecía.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|mjs|js|css|map|json|txt|woff|woff2|ttf|otf)$).*)",
  ],
};

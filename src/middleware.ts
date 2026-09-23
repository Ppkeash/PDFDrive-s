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

/** 404 seco: ni marca, ni pista de que aquí haya una aplicación. */
function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Se resuelven antes que nada: `updateSession` protege rutas privadas y
  // mandaría `robots.txt` a /login, que es justo lo contrario de lo buscado.
  if (GATE_EXEMPT.has(path)) return NextResponse.next({ request });

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
    // Todo excepto estáticos e imágenes.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

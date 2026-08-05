import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Display: serif variable con carácter — títulos y marca, uso restringido.
// Sin `weight`: se carga como variable, que es lo que permite ajustar los
// ejes SOFT/WONK de Fraunces en globals.css.
const display = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-display",
  display: "swap",
});

// UI: gesto de ingeniería, más carácter que las grotescas por defecto.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

// Datos: hashes, certificados y sellos de tiempo llevan cara de máquina.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FirmaDrive",
  description:
    "Sube, comparte y firma documentos PDF con validez criptográfica.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Declara ambos esquemas explícitamente: sin esto, algunos navegadores
  // (sobre todo Edge/Android con "oscurecer sitios web" activado) reinvierten
  // colores puestos a mano como bg-white, pensando que la página no soporta
  // modo oscuro por su cuenta.
  colorScheme: "light dark",
};

// Aplica el tema guardado antes del primer pintado para evitar parpadeo.
const themeScript = `(function(){try{var t=localStorage.getItem("fd-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans text-base antialiased">
        {children}
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";

// Nada de esto es para el público: ningún buscador debe indexarlo. Se refuerza
// con la cabecera `X-Robots-Tag` en `next.config.mjs`, porque robots.txt es una
// petición, no una garantía.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}

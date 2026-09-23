/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        // `X-Robots-Tag` manda sobre robots.txt: aunque un buscador llegue a
        // una URL por otro camino (un enlace pegado en algún lado), no la
        // indexa ni la guarda en caché.
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

"use client";

import { useEffect, useRef } from "react";

/**
 * Roseta guilloche — el grabado de línea fina que llevan billetes, títulos y
 * certificados. Es el único gesto decorativo de la app: aparece solo en el
 * acceso y se dibuja con la tinta del acento, así que responde al tema.
 *
 * Se dibuja en canvas (no SVG a mano) porque son miles de segmentos.
 */
export function Guilloche({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let raf = 0;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    function draw() {
      const el = ref.current;
      if (!el || !ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = el.clientWidth;
      if (size === 0) return;

      el.width = size * dpr;
      el.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // Toma la tinta del acento vigente para que el grabado siga al tema.
      const seal =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--seal")
          .trim() || "126 43 60";

      const cx = size / 2;
      const cy = size / 2;
      const R = size * 0.46;

      // Progreso del trazado: se dibuja como si lo grabaran.
      const progress = reduced ? 1 : Math.min(frame / 90, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      ctx.lineWidth = 0.5;

      // Anillos concéntricos de rosetas, cada uno con distinta razón.
      const rings = [
        { r: 0.30, d: 0.72, turns: 26, alpha: 0.5 },
        { r: 0.22, d: 0.60, turns: 34, alpha: 0.38 },
        { r: 0.14, d: 0.86, turns: 44, alpha: 0.26 },
      ];

      for (const ring of rings) {
        const rr = R * ring.r;
        const dd = R * ring.d;
        const steps = 1400;
        const limit = Math.floor(steps * eased);

        ctx.strokeStyle = `rgb(${seal} / ${ring.alpha * 0.55})`;
        ctx.beginPath();

        for (let i = 0; i <= limit; i++) {
          const t = (i / steps) * Math.PI * 2 * ring.turns;
          const k = (R - rr) / rr;
          const x = cx + (R - rr) * Math.cos(t) + dd * Math.cos(k * t);
          const y = cy + (R - rr) * Math.sin(t) - dd * Math.sin(k * t);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Filete exterior: el borde impreso que encierra el grabado.
      ctx.strokeStyle = `rgb(${seal} / 0.22)`;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.03, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * eased);
      ctx.stroke();

      if (progress < 1) {
        frame += 1;
        raf = requestAnimationFrame(draw);
      }
    }

    draw();

    const onResize = () => {
      frame = 90; // ya trazado: al redimensionar no se vuelve a animar
      draw();
    };
    window.addEventListener("resize", onResize);

    // El grabado se redibuja cuando cambia el tema (cambia la tinta).
    const observer = new MutationObserver(onResize);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none aspect-square w-full select-none ${className}`}
    />
  );
}

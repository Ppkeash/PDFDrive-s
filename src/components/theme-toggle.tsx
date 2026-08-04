"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Alterna claro/oscuro sellando data-theme en <html>, que en globals.css gana
 * sobre prefers-color-scheme en ambos sentidos. El valor se recuerda.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme as
      | "light"
      | "dark"
      | undefined;
    if (stored) return setTheme(stored);
    setTheme(
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
    );
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("fd-theme", next);
    } catch {
      // Modo privado: el tema simplemente no se recuerda.
    }
  }

  return (
    <button
      onClick={toggle}
      className="rounded p-2 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema oscuro"}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

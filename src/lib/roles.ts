import type { ShareRole } from "@/types";

/** Los tres permisos que se pueden conceder. `propietario` no se reparte. */
export type GrantableRole = Exclude<ShareRole, "propietario">;

export const ROLES: { value: GrantableRole; label: string; hint: string }[] = [
  { value: "editor", label: "Editor", hint: "Firma y coloca campos a otros" },
  { value: "firmante", label: "Firmante", hint: "Puede ver y firmar" },
  { value: "lector", label: "Lector", hint: "Solo ve y descarga" },
];

const LABELS: Record<ShareRole, string> = {
  propietario: "Propietario",
  editor: "Editor",
  firmante: "Firmante",
  lector: "Lector",
};

export function roleLabel(role: string): string {
  return LABELS[role as ShareRole] ?? role;
}

export const canEdit = (role: string) =>
  role === "propietario" || role === "editor";

export const canSign = (role: string) =>
  role === "propietario" || role === "editor" || role === "firmante";

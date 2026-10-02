import type { ShareRole } from "@/types";

/** Los tres permisos que se pueden conceder. `propietario` no se reparte. */
export type GrantableRole = Exclude<ShareRole, "propietario">;

export const ROLES: { value: GrantableRole; label: string; hint: string }[] = [
  {
    value: "editor",
    label: "Editor",
    hint: "Firma y asigna campos a otros firmantes",
  },
  { value: "firmante", label: "Firmante", hint: "Consulta y firma el documento" },
  { value: "lector", label: "Lector", hint: "Solo consulta y descarga" },
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

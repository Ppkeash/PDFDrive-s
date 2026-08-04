import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export default function VerifyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="font-display text-3xl font-semibold">
          Verificar un documento
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Comprueba que un PDF firmado no se modificó después de firmarse.
        </p>
      </header>

      <section className="mt-6 rounded-lg border border-line bg-surface p-6">
        <h2 className="font-display text-lg font-semibold">
          Verifica desde el propio documento
        </h2>
        <p className="mt-2 text-sm text-muted">
          Abre el documento en{" "}
          <Link
            href="/drive"
            className="font-medium text-seal underline decoration-seal/30 underline-offset-4 hover:decoration-seal"
          >
            Mis documentos
          </Link>{" "}
          y pulsa <strong className="font-medium text-ink">Verificar firma</strong>.
          FirmaDrive vuelve a calcular la huella SHA-256 del archivo y la compara
          con la que se registró en el momento de firmar.
        </p>

        <dl className="mt-5 flex flex-col gap-3 border-t border-line pt-5">
          <Item term="Firma detectada">
            Confirma que el PDF lleva incrustada al menos una firma digital.
          </Item>
          <Item term="Integridad (hash)">
            Si alguien cambió un solo byte del archivo, la huella deja de
            coincidir y la verificación falla.
          </Item>
          <Item term="Firmantes">
            Muestra quién firmó, cuándo y con qué certificado.
          </Item>
        </dl>
      </section>

      <p className="mt-5 flex gap-2.5 rounded border-l-2 border-wait bg-wait-soft px-4 py-3 text-sm text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-wait" aria-hidden />
        <span>
          El certificado actual es de desarrollo y autofirmado: sirve para probar
          integridad y autoría dentro de FirmaDrive, pero todavía no equivale a
          una firma con validez legal ante terceros.
        </span>
      </p>
    </div>
  );
}

function Item({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 font-mono text-xs text-muted">{term}</dt>
      <dd className="flex-1 text-sm">{children}</dd>
    </div>
  );
}

/** Utilidades para CNPJ/CPF (armazenados só com dígitos). */

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Formata progressivamente enquanto o usuário digita: até 11 dígitos = CPF, depois CNPJ. */
export function maskDocument(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function formatDocument(doc: string | null | undefined): string {
  if (!doc) return "";
  const d = onlyDigits(doc);
  if (d.length === 11 || d.length === 14) return maskDocument(d);
  return doc;
}

export function documentKind(doc: string): "CPF" | "CNPJ" | null {
  const d = onlyDigits(doc);
  if (d.length === 11) return "CPF";
  if (d.length === 14) return "CNPJ";
  return null;
}

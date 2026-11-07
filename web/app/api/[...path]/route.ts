// Proxy em tempo de execução para a API Go. Lê API_URL a cada requisição,
// então a mesma imagem funciona em qualquer ambiente (standalone).
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "expect",
]);

function apiBase(): string {
  return (process.env.API_URL || "http://localhost:8080").replace(/\/+$/, "");
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${apiBase()}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    // Evita respostas comprimidas: o fetch do Node descomprime e o header
    // content-encoding chegaria inconsistente ao navegador.
    if (k === "accept-encoding") return;
    headers.set(key, value);
  });
  const url = req.nextUrl;
  headers.set("x-forwarded-host", req.headers.get("host") ?? url.host);
  headers.set("x-forwarded-proto", req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", ""));
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: req.signal,
      cache: "no-store",
      // Necessário para enviar ReadableStream (uploads multipart) sem bufferizar.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[api-proxy]", target, err);
    return Response.json({ error: "API indisponível" }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || k === "set-cookie" || k === "content-encoding") return;
    out.set(key, value);
  });
  // Corpo já descomprimido pelo fetch: o content-length original pode estar errado.
  if (upstream.headers.get("content-encoding")) out.delete("content-length");
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS };

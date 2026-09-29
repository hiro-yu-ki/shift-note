const PUBLIC_HOST = "shift-note.yuki-nova.workers.dev";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.hostname !== PUBLIC_HOST) {
      return new Response("Unknown host", { status: 421 });
    }

    // The VPC Service pins the destination to 127.0.0.1:8002 through the named
    // private tunnel. This URL supplies the Host header checked by FastAPI.
    const target = new URL(request.url);
    target.protocol = "http:";
    target.port = "8002";
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-host");
    headers.delete("x-forwarded-proto");
    let response;
    try {
      response = await env.SHIFT_BACKEND.fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        }),
      );
    } catch {
      return new Response(JSON.stringify({ detail: "サーバーに接続できません。少し待ってから再試行してください" }), {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "no-store");
    return result;
  },
};

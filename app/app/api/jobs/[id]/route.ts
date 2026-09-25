import { ApiError, job } from "@/lib/api";

// The progress page polls this. It relays the engine's job record and nothing
// else; the engine key, if any, stays on the server.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json(await job(id), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "engine unreachable" }, { status: 503 });
  }
}

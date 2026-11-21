import { deleteSource, updateSource } from "@/lib/registry-store";
import type { SourceInput } from "@/lib/registry";

export async function PATCH(request: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  const item = await updateSource(id, (await request.json()) as Partial<SourceInput>);
  return item ? Response.json(item) : Response.json({ error: "Не найдено" }, { status: 404 });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  const withPlots = new URL(request.url).searchParams.get("withPlots") === "1";
  return (await deleteSource(id, withPlots)) ? new Response(null, { status: 204 }) : Response.json({ error: "Не найдено" }, { status: 404 });
}

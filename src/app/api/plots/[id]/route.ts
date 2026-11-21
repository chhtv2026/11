import { deletePlot, RegistryError, updatePlot } from "@/lib/registry-store";
import type { PlotInput } from "@/lib/registry";

export async function PATCH(request: Request, ctx: RouteContext<"/api/plots/[id]">) {
  const { id } = await ctx.params;
  let item;
  try {
    item = await updatePlot(id, (await request.json()) as Partial<PlotInput>);
  } catch (err) {
    if (err instanceof RegistryError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  return item ? Response.json(item) : Response.json({ error: "Не найдено" }, { status: 404 });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/plots/[id]">) {
  const { id } = await ctx.params;
  return (await deletePlot(id)) ? new Response(null, { status: 204 }) : Response.json({ error: "Не найдено" }, { status: 404 });
}

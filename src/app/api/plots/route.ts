import { createPlot, RegistryError } from "@/lib/registry-store";
import type { PlotInput } from "@/lib/registry";

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<PlotInput>;
  try {
    return Response.json(await createPlot(input), { status: 201 });
  } catch (err) {
    if (err instanceof RegistryError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

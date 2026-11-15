import { createPlot } from "@/lib/registry-store";
import type { PlotInput } from "@/lib/registry";

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<PlotInput>;
  return Response.json(await createPlot(input), { status: 201 });
}

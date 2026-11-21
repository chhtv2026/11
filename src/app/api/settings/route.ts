import { updateVri, updateWeights } from "@/lib/registry-store";
import type { Weights } from "@/lib/registry";

export async function PATCH(request: Request) {
  const { weights, vri } = (await request.json()) as { weights?: Partial<Weights>; vri?: Record<string, unknown> };
  if (vri) await updateVri(vri);
  return Response.json(await updateWeights(weights ?? {}));
}

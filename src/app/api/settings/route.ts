import { updateWeights } from "@/lib/registry-store";
import type { Weights } from "@/lib/registry";

export async function PATCH(request: Request) {
  const { weights } = (await request.json()) as { weights?: Partial<Weights> };
  return Response.json(await updateWeights(weights ?? {}));
}

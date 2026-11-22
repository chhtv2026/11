import { updateApplicant, updateVri, updateWeights } from "@/lib/registry-store";
import type { Weights } from "@/lib/registry";

export async function PATCH(request: Request) {
  const { weights, vri, applicant } = (await request.json()) as {
    weights?: Partial<Weights>;
    vri?: Record<string, unknown>;
    applicant?: unknown;
  };
  if (vri) await updateVri(vri);
  if (applicant) await updateApplicant(applicant);
  return Response.json(await updateWeights(weights ?? {}));
}

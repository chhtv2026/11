import { createSource } from "@/lib/registry-store";
import type { SourceInput } from "@/lib/registry";

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<SourceInput>;
  return Response.json(await createSource(input), { status: 201 });
}

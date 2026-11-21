import { importPlots } from "@/lib/registry-store";

export async function POST(request: Request) {
  const input = (await request.json()) as { numbers?: unknown; sourceName?: unknown; owner?: unknown };
  return Response.json(await importPlots(input));
}

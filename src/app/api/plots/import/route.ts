import { importPlots } from "@/lib/registry-store";

export async function POST(request: Request) {
  const input = (await request.json()) as Parameters<typeof importPlots>[0];
  return Response.json(await importPlots(input));
}

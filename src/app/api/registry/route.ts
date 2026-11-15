import { connection } from "next/server";
import { getRegistry } from "@/lib/registry-store";

export async function GET() {
  await connection();
  return Response.json(await getRegistry());
}

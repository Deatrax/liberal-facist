import { notFound } from "next/navigation";
import { ROOM_CODE_RE } from "@/lib/game";
import { RoomPage } from "@/components/RoomPage";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  if (!ROOM_CODE_RE.test(code)) notFound();
  return <RoomPage code={code} />;
}

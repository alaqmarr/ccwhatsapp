import { redirect } from "next/navigation";
import { getAppBootContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { setup, user } = await getAppBootContext();

  if (!setup.hasDevAccount) {
    redirect("/setup");
  }

  if (!user) {
    redirect("/login");
  }

  if (user.status !== "ACTIVE") {
    redirect("/onboarding");
  }

  if (user.role === "CLIENT") {
    redirect("/dashboard/pricing");
  }

  redirect("/dashboard/inbox");
}

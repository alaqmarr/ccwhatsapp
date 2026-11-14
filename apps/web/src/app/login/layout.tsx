import { redirect } from "next/navigation";
import { getAppBootContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setup, user } = await getAppBootContext();

  if (!setup.hasDevAccount) {
    redirect("/setup");
  }

  if (user) {
    if (user.status === "ACTIVE") {
      redirect(user.role === "CLIENT" ? "/dashboard/pricing" : "/dashboard/inbox");
    }
    redirect("/onboarding");
  }

  return <>{children}</>;
}

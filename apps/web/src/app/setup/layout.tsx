import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { getAppBootContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setup, user } = await getAppBootContext();
  if (setup.hasDevAccount) {
    if (!user) {
      redirect("/login");
    }
    if (!isDevRole(user.role) || user.status !== "ACTIVE") {
      redirect("/dashboard/inbox");
    }
  }
  return <>{children}</>;
}

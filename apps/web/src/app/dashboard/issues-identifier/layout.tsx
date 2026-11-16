import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DevIssuesIdentifierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }
  return <>{children}</>;
}

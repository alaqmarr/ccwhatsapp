import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "templates:manage", user.status)) {
    redirect("/dashboard/inbox");
  }
  return <>{children}</>;
}

import type React from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  Contact2,
  Cpu,
  FileCode,
  FileText,
  HardDrive,
  IndianRupee,
  LayoutDashboard,
  Mail,
  Megaphone,
  PhoneCall,
  Settings,
  ShieldAlert,
  Truck,
  UserCheck,
  Users,
  Workflow,
} from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";
import {
  canViewCostBreakdown,
  isDevRole,
  isSuperAdminCapable,
} from "@cc/rbac";
import { WhatsAppLogoIcon } from "@cc/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
  badge?: string;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

export function buildNavSections(
  user: AuthenticatedUser,
  pendingApprovalsCount: number
): NavSection[] {
  const isActiveAccount = user.status === "ACTIVE";
  const canSuperAdmin = isSuperAdminCapable(user.role) && isActiveAccount;
  const isDev = isDevRole(user.role) && isActiveAccount;
  const canViewPricing = isActiveAccount && canViewCostBreakdown(user.role);
  const canManageFlows =
    isActiveAccount &&
    ["DEV", "SUPERADMIN", "MANAGER", "ADMIN"].includes(user.role);
  const isInternalStaff = isActiveAccount && user.role !== "CLIENT";

  return [
    {
      heading: "Workspace",
      items: [
        {
          href: "/dashboard",
          label: "Dashboard",
          icon: LayoutDashboard,
          visible: isInternalStaff,
        },
        {
          href: "/dashboard/inbox",
          label: "Customer Chats",
          icon: WhatsAppLogoIcon,
          visible: isInternalStaff,
        },
        {
          href: "/dashboard/enquiries",
          label: "Website Enquiries",
          icon: Mail,
          visible: isInternalStaff,
          badge: "CC+CE53",
        },
        {
          href: "/dashboard/call-queue",
          label: "Call & Lead Queue",
          icon: PhoneCall,
          visible: isInternalStaff,
          badge: "Queue",
        },
        {
          href: "/dashboard/contacts",
          label: "Contacts Database",
          icon: Contact2,
          visible: isInternalStaff,
        },
        {
          href: "/dashboard/teams",
          label: "Teams & Escalation",
          icon: Users,
          visible: isInternalStaff,
        },
        {
          href: "/dashboard/analytics",
          label: "Analytics & Reports",
          icon: BarChart3,
          visible: isActiveAccount,
        },
        {
          href: "/onboarding",
          label: "How to Use",
          icon: BookOpen,
          visible: true,
        },
      ],
    },
    {
      heading: "Campaigns & Flows",
      items: [
        {
          href: "/dashboard/tracking",
          label: "Order Tracking",
          icon: Truck,
          visible: isInternalStaff,
        },
        {
          href: "/dashboard/marketing",
          label: "Broadcasts & Short Links",
          icon: Megaphone,
          visible: isInternalStaff,
        },
        {
          href: "/dashboard/templates",
          label: "Templates & Button Flows",
          icon: FileText,
          visible: canManageFlows,
        },
        {
          href: "/dashboard/automations",
          label: "Auto-Replies Builder",
          icon: Workflow,
          visible: canManageFlows,
        },
        {
          href: "/dashboard/ai-training",
          label: "AI Training Studio",
          icon: Bot,
          visible: isInternalStaff,
          badge: "ACRIO",
        },
      ],
    },
    {
      heading: canViewPricing ? "Admin & Costs" : "Administration",
      items: [
        {
          href: "/dashboard/approvals",
          label: "Team Approvals",
          icon: UserCheck,
          visible: canSuperAdmin,
          badge:
            pendingApprovalsCount > 0
              ? String(pendingApprovalsCount)
              : undefined,
        },
        {
          href: "/dashboard/pricing",
          label: "Cost Breakdown",
          icon: IndianRupee,
          visible: canViewPricing,
        },
        {
          href: "/dashboard/dev",
          label: "Dev Profit & Ops",
          icon: HardDrive,
          visible: isDev,
        },
        {
          href: "/dashboard/claude-usage",
          label: "Claude Usage & Spend",
          icon: Cpu,
          visible: isDev,
          badge: "USD",
        },
        {
          href: "/dashboard/issues-identifier",
          label: "Issues Identifier",
          icon: ShieldAlert,
          visible: isDev,
          badge: "ACRIO",
        },
        {
          href: "/dashboard/ai-logs",
          label: "AI Logs (ai.logs)",
          icon: FileCode,
          visible: isDev,
        },
        {
          href: "/setup",
          label: "Facebook Setup",
          icon: Settings,
          visible: isDev,
        },
      ],
    },
  ];
}

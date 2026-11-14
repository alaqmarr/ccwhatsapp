import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["whatsapp.ccapl.cc"],
  transpilePackages: [
    "@cc/auth",
    "@cc/connections",
    "@cc/database",
    "@cc/queue",
    "@cc/rbac",
    "@cc/sockets",
    "@cc/storage",
    "@cc/ui",
    "@cc/workers",
  ],
  serverExternalPackages: ["@libsql/client", "nodemailer"],
};

export default nextConfig;

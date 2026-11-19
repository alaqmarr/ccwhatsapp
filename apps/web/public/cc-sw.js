self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const conversationId = data.conversationId ? String(data.conversationId) : "";
  const targetUrl =
    data.url && typeof data.url === "string"
      ? data.url
      : conversationId
      ? `/dashboard/inbox?chat=${encodeURIComponent(conversationId)}`
      : "/dashboard/inbox";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        const inboxClient = clientList.find(
          (c) => typeof c.url === "string" && c.url.includes("/dashboard/inbox")
        );
        const preferred =
          inboxClient ||
          clientList.find(
            (c) => typeof c.url === "string" && c.url.includes("/dashboard")
          ) ||
          clientList[0];

        if (preferred) {
          if (typeof preferred.focus === "function") {
            await preferred.focus().catch(() => {});
          }
          preferred.postMessage({
            type: "CC_OPEN_CHAT",
            conversationId,
            url: targetUrl,
          });
          return;
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      })
  );
});

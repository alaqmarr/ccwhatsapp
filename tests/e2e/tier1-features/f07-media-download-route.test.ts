import {
  describe,
  it,
  assertOk,
  createTestRequest,
  callRoute,
  createTestStaffSession,
  mockMeta,
} from "../harness";

describe("F07: Media Streaming & Download Route (Tier 1 Feature Coverage)", () => {
  it("T1-F07-01: verifies authenticated media download returns 200 binary response with staff session", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_img_101",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_img_101" } });
    res.assertStatus(200);
    assertOk(res.headers.get("content-type"));
  });

  it("T1-F07-02: verifies Content-Type header matches media mime type (image/jpeg or application/pdf)", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_doc_202",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_doc_202" } });
    res.assertStatus(200);
    const contentType = res.headers.get("content-type") || "";
    assertOk(contentType.includes("pdf") || contentType.includes("application"));
  });

  it("T1-F07-03: verifies Content-Disposition header formatting for document downloads", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_doc_202?filename=Purchase_Order_991.pdf",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_doc_202" } });
    res.assertStatus(200);
    const disposition = res.headers.get("content-disposition");
    assertOk(disposition, "Response must include Content-Disposition header");
    assertOk(disposition.includes("attachment"), "Content-Disposition must be attachment");
    assertOk(disposition.includes("filename="), "Content-Disposition must include filename parameter");
    assertOk(disposition.includes("Purchase_Order_991.pdf"), "Content-Disposition must contain document filename");
  });

  it("T1-F07-04: verifies Cache-Control headers on media responses for optimal caching", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_img_101",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_img_101" } });
    res.assertStatus(200);
    const cacheControl = res.headers.get("cache-control");
    assertOk(cacheControl, "Response must include Cache-Control header");
    assertOk(cacheControl.includes("max-age=86400"), "Cache-Control must specify 1 day caching");
    assertOk(cacheControl.includes("private"), "Cache-Control must be marked private for customer data");
  });

  it("T1-F07-05: verifies Meta Graph API media queries use configured bearer auth header", async () => {
    mockMeta.reset();
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_img_101",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_img_101" } });
    res.assertStatus(200);

    assertOk(mockMeta.mediaRequests.length >= 1, "Meta Graph API must be queried for media info");
    const outgoingRequest = mockMeta.mediaRequests[0];
    const authHeader = outgoingRequest.headers["authorization"];
    assertOk(authHeader, "Meta Graph API query must include Authorization header");
    assertOk(authHeader.startsWith("Bearer "), "Authorization header must use Bearer scheme");
  });
});

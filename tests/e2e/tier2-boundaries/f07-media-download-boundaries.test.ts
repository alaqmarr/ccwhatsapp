import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  createTestStaffSession,
  callRoute,
  mockMeta,
} from "../harness";

describe("F07: Media Download Streaming Route (Tier 2 Boundary Cases)", () => {
  it("rejects unauthenticated requests without session cookie", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const req = createTestRequest({
      url: "/api/media/media_img_101",
      method: "GET",
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_img_101" } });
    assertStrictEqual(res.status, 401, "Unauthenticated request without session cookie must return 401");
  });

  it("handles non-existent media id when upstream Meta Graph API returns 404", async () => {
    mockMeta.reset();
    mockMeta.setNextGraphError({
      message: "Unsupported get request. Object with ID 'media_unknown_999999' does not exist",
      type: "GraphMethodException",
      code: 100,
      error_subcode: 33,
    });

    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_unknown_999999",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_unknown_999999" } });
    assertOk(res.status === 404 || res.status === 502, "Non-existent upstream media must return 404 or 502");
  });

  it("sanitizes directory traversal characters in media ID parameter", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const maliciousIds = [
      "../../etc/passwd",
      "..\\..\\windows\\win.ini",
      "media_101%2F..%2F..",
      "../secret",
    ];

    for (const badId of maliciousIds) {
      const req = createTestRequest({
        url: `/api/media/${badId}`,
        method: "GET",
        sessionToken: staffSession.token,
      });
      const res = await callRoute(mediaRoute, req, { params: { id: badId } });
      assertStrictEqual(res.status, 400, `Traversal ID "${badId}" must be rejected with 400`);
    }
  });

  it("handles expired Meta media download URL gracefully without uncaught rejection", async () => {
    mockMeta.reset();
    mockMeta.setNextGraphError({
      message: "Error validating access token: Session has expired",
      type: "OAuthException",
      code: 190,
      error_subcode: 463,
    });

    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();
    const req = createTestRequest({
      url: "/api/media/media_expired_token_01",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const res = await callRoute(mediaRoute, req, { params: { id: "media_expired_token_01" } });
    assertOk(res.status === 404 || res.status === 502, "Expired upstream media must return 404 or 502 error status");
  });

  it("verifies Content-Type and Content-Disposition headers for document vs image media", async () => {
    const mediaRoute = await import("../../../apps/web/src/app/api/media/[id]/route");
    const staffSession = await createTestStaffSession();

    // PDF document media download
    const docReq = createTestRequest({
      url: "/api/media/media_doc_202?filename=Specs.pdf",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const docRes = await callRoute(mediaRoute, docReq, { params: { id: "media_doc_202" } });
    docRes.assertStatus(200);
    assertOk(
      docRes.headers.get("content-type")?.includes("pdf") ||
        docRes.headers.get("content-type")?.includes("application")
    );
    assertOk(docRes.headers.get("content-disposition")?.includes("attachment"));

    // JPEG image media download
    const imgReq = createTestRequest({
      url: "/api/media/media_img_101",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const imgRes = await callRoute(mediaRoute, imgReq, { params: { id: "media_img_101" } });
    imgRes.assertStatus(200);
    assertOk(imgRes.headers.get("content-type")?.includes("image"));
    assertStrictEqual(imgRes.headers.get("content-disposition"), "inline");
  });
});

// @vitest-environment node
// Shopee Affiliate Open API adapter — mocked responses only (UNVERIFIED live until credentials are provided).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";

const fetchMock = vi.fn();
vi.mock("@/lib/ssrf-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/ssrf-guard")>()),
  safeFetch: (...a: unknown[]) => fetchMock(...a),
  assertPublicUrl: async () => undefined,
}));

import {
  buildProductOfferPayload,
  buildShopeeAffiliateRequest,
  parseProductOfferResponse,
  shopeeAffiliateSignature,
} from "@/lib/import-adapters/shopee-affiliate";
import { importProduct } from "@/lib/import-adapters";
import { parseShopeeIds } from "@/lib/product-ingest";

const ENV = { SHOPEE_AFFILIATE_APP_ID: "17301234567", SHOPEE_AFFILIATE_SECRET: "s3cret" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const OFFER = {
  data: {
    productOfferV2: {
      nodes: [
        {
          itemId: 21891290157,
          shopId: 27395533,
          productName: "Quạt mini cầm tay sạc USB",
          imageUrl: "https://cf.shopee.vn/file/vn-11134207-abc",
          priceMin: "159000",
          priceMax: "199000",
          offerLink: "https://s.shopee.vn/AbCdEf",
          productLink: "https://shopee.vn/product/27395533/21891290157",
        },
      ],
    },
  },
};

describe("Shopee Affiliate Open API adapter (layer 1)", () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("parses shopId/itemId from -i.<shop>.<item> and /product/<shop>/<item>", () => {
    expect(parseShopeeIds("https://shopee.vn/Quat-mini-i.27395533.21891290157?sp_atk=x")).toMatchObject({ shopId: "27395533", itemId: "21891290157" });
    expect(parseShopeeIds("https://shopee.vn/product/27395533/21891290157")).toMatchObject({ shopId: "27395533", itemId: "21891290157" });
  });

  it("signs sha256(appId + ts + exact payload + secret) in the documented header format", () => {
    const req = buildShopeeAffiliateRequest("27395533", "21891290157", ENV, 1_700_000_000_000);
    const expected = createHash("sha256").update(`17301234567${1_700_000_000}${req.body}s3cret`).digest("hex");
    expect(req.headers.Authorization).toBe(`SHA256 Credential=17301234567, Timestamp=1700000000, Signature=${expected}`);
    expect(shopeeAffiliateSignature("a", 1, "p", "s")).toBe(createHash("sha256").update("a1ps").digest("hex"));
    expect(req.endpoint).toBe("https://open-api.affiliate.shopee.vn/graphql");
    expect(JSON.parse(req.body).query).toContain("productOfferV2(shopId: 27395533, itemId: 21891290157");
  });

  it("rejects non-numeric ids (no GraphQL injection)", () => {
    expect(() => buildProductOfferPayload("1) { x }", "2")).toThrow();
  });

  it("returns title, price range, 1 image, offerLink, flagged needsMorePhotos", () => {
    const { product } = parseProductOfferResponse(OFFER, "https://shopee.vn/x");
    expect(product).toMatchObject({
      title: "Quạt mini cầm tay sạc USB",
      images: ["https://cf.shopee.vn/file/vn-11134207-abc"],
      offerLink: "https://s.shopee.vn/AbCdEf",
      needsMorePhotos: true,
    });
    expect(product!.priceText).toMatch(/159.*199/);
  });

  it("surfaces API errors (e.g. invalid signature) as an error", () => {
    expect(parseProductOfferResponse({ errors: [{ message: "error [10020]: Invalid Signature" }] }, "u").error).toContain("Invalid Signature");
    expect(parseProductOfferResponse({ data: { productOfferV2: { nodes: [] } } }, "u").product).toBeUndefined();
  });

  it("chain: with affiliate env it is tried first and wins", async () => {
    fetchMock.mockResolvedValueOnce(json(OFFER));
    const r = await importProduct("https://shopee.vn/product/27395533/21891290157", ENV);
    expect(r.ok).toBe(true);
    expect(r.adapter).toBe("shopee-affiliate");
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://open-api.affiliate.shopee.vn/graphql");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("chain: affiliate failure falls to layer 2 (generic data API) when configured", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ errors: [{ message: "Invalid Signature" }] }))
      .mockResolvedValueOnce(json({ title: "Quạt mini", images: ["https://cf.shopee.vn/file/a"] }));
    const r = await importProduct("https://shopee.vn/product/1/2", { ...ENV, SHOPEE_DATA_API_KEY: "k", SHOPEE_DATA_API_BASE_URL: "https://d.example" });
    expect(r.ok && r.adapter).toBe("shopee-data-api");
    expect(r.tried).toEqual(["shopee-affiliate", "shopee-data-api"]);
  });

});

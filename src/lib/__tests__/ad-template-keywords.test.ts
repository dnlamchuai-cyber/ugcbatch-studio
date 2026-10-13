import { describe, it, expect } from "vitest";
import { recommendAdTemplates, foldForMatch } from "@/lib/ad-templates";

const ids = (input: Parameters<typeof recommendAdTemplates>[0]) => recommendAdTemplates(input, 12).map((t) => t.id);

describe("foldForMatch", () => {
  it("lowercases and strips Vietnamese diacritics (đ → d)", () => {
    expect(foldForMatch("Áo Chống Nắng ĐẸP")).toBe("ao chong nang dep");
    expect(foldForMatch("Đồ  dùng")).toBe("do dung");
  });
});

describe("EN/VI keyword signals match the Chinese ones", () => {
  const cases: Array<{ name: string; zh: string; en: string; vi: string; viPlain: string; expected: string[]; category?: string }> = [
    {
      name: "home gadget — cleaning",
      category: "home",
      zh: "强力去污清洁剂",
      en: "Heavy-duty stain remover spray",
      vi: "Bình xịt tẩy vết bẩn vệ sinh nhà bếp",
      viPlain: "binh xit tay vet ban ve sinh nha bep",
      expected: ["grime_satisfying"],
    },
    {
      name: "home gadget — storage organizer",
      category: "home",
      zh: "抽屉收纳盒",
      en: "Stackable drawer organizers",
      vi: "Hộp đựng đồ sắp xếp ngăn kéo",
      viPlain: "hop dung do sap xep ngan keo",
      expected: ["home_makeover"],
    },
    {
      name: "phone accessory — fast charger",
      category: "digital",
      zh: "65W氮化镓快充充电器",
      en: "65W GaN fast charging charger",
      vi: "Củ sạc nhanh 65W GaN",
      viPlain: "cu sac nhanh 65w gan",
      expected: ["charge_race"],
    },
    {
      name: "phone accessory — earbuds",
      category: "digital",
      zh: "主动降噪蓝牙耳机",
      en: "Noise cancelling wireless earbuds",
      vi: "Tai nghe bluetooth chống ồn",
      viPlain: "tai nghe bluetooth chong on",
      expected: ["anc_ab"],
    },
    {
      name: "pet supplies",
      zh: "猫咪冻干零食",
      en: "Freeze-dried cat treats for picky eaters",
      vi: "Thức ăn cho mèo sấy khô, mèo kén ăn",
      viPlain: "thuc an cho meo say kho",
      expected: ["pet_cameo", "picky_judge"],
    },
    {
      name: "beauty — makeup",
      category: "beauty",
      zh: "丝绒哑光口红",
      en: "Velvet matte lipstick",
      vi: "Son môi lì nhung trang điểm",
      viPlain: "son moi li nhung trang diem",
      expected: ["swatch_report"],
    },
    {
      name: "beauty — skin type",
      category: "beauty",
      zh: "油皮控油粉底",
      en: "Oil-control foundation for oily skin",
      vi: "Kem nền kiềm dầu cho da dầu",
      viPlain: "kem nen kiem dau cho da dau",
      expected: ["skin_type_test"],
    },
  ];

  for (const c of cases) {
    it(`${c.name}: zh / en / vi / vi-without-diacritics all hit ${c.expected.join(", ")}`, () => {
      for (const productName of [c.zh, c.en, c.vi, c.viPlain]) {
        const got = ids({ category: c.category, productName });
        for (const id of c.expected) expect(got, productName).toContain(id);
      }
    });
  }

  it("Chinese keywords still work unchanged", () => {
    expect(ids({ productName: "母亲节礼物" })).toContain("gift_story");
  });

  it("no false hits from ambiguous words or substrings", () => {
    // "của" (of) must not trigger seafood; "carpet" must not trigger pet; "earring" ≠ "ring"-only logic is fine either way
    expect(ids({ productName: "Áo của mẹ" })).not.toContain("fresh_catch");
    expect(ids({ productName: "Carpet cleaner" })).not.toContain("pet_cameo");
    expect(recommendAdTemplates({ productName: "plain widget" })).toEqual([]);
  });

  it("matches English plurals and hyphen/space variants", () => {
    expect(ids({ productName: "Dog toys for puppies" })).toContain("pet_cameo");
    expect(ids({ productName: "No drill adhesive hooks" })).toContain("no_drill_test");
  });
});

const allIds = (input: Parameters<typeof recommendAdTemplates>[0]) => recommendAdTemplates(input, 500).map((t) => t.id);
const HAIR = ["wash_day", "brush_through", "hairline_fix"];

describe("oily skin (da dầu) vs scalp/hair (da đầu, dầu gội)", () => {
  for (const productName of ["Kem chống nắng SPF50 cho da dầu", "Kem chong nang SPF50 cho da dau", "kem chong nang spf50 cho da dau"]) {
    it(`"${productName}" gives no hair templates and hits sunscreen/skincare`, () => {
      const got = allIds({ productName });
      for (const id of HAIR) expect(got).not.toContain(id);
      expect(got).toContain("skin_type_test");
      expect(got).not.toContain("uv_proof");
    });
  }

  for (const productName of ["Dầu gội thảo dược", "dau goi thao duoc", "Dầu xả mềm mượt", "dau xa mem muot", "Tinh dầu dưỡng tóc", "tinh dau duong toc", "Tẩy tế bào chết da đầu", "Argan hair oil", "Anti-dandruff shampoo"]) {
    it(`hair input "${productName}" still hits hair templates`, () => {
      expect(ids({ category: "beauty", productName })).toContain("wash_day");
    });
  }
});

describe("sunscreen keywords", () => {
  for (const productName of ["Kem chống nắng", "kem chong nang", "Daily sunscreen", "Mineral sunblock", "SPF 50 face fluid", "Moisturizer SPF30", "清爽防晒霜"]) {
    it(`"${productName}" hits skincare templates, not clothing`, () => {
      const got = allIds({ productName });
      expect(got).toContain("skin_type_test");
      expect(got).not.toContain("uv_proof");
    });
  }
  it("chống nắng for clothing still hits sun-protective clothing templates", () => {
    for (const productName of ["Áo chống nắng UPF50", "ao chong nang", "Mũ chống nắng", "防晒衣"]) {
      expect(ids({ productName }), productName).toContain("uv_proof");
    }
  });
});

describe("dress keywords", () => {
  for (const productName of ["Váy hoa nhí", "Đầm dự tiệc", "Floral summer dress", "Bohemian maxi", "vay maxi di bien", "连衣裙"]) {
    it(`"${productName}" hits fashion templates`, () => {
      expect(ids({ productName })).toContain("fashion_walk");
    });
  }
  for (const productName of ["vay dam di bien", "dam maxi", "Dam maxi hoa nhi"]) {
    it(`unaccented phrase "${productName}" hits all dress templates`, () => {
      const got = ids({ productName });
      for (const id of ["fashion_walk", "one_piece_five_ways", "multi_size_tryon"]) expect(got).toContain(id);
    });
  }
  it("lone unaccented 'dam' / 'da dau' stay unmatched", () => {
    for (const productName of ["mau dam", "son mau dam", "kem cho da dau"]) {
      const got = allIds({ productName });
      expect(got, productName).not.toContain("fashion_walk");
      expect(got, productName).not.toContain("wash_day");
    }
  });
  it("folded 'dam' alone (đậm etc.) does not trigger dress", () => {
    expect(allIds({ productName: "Cà phê đậm vị" })).not.toContain("fashion_walk");
  });
});

describe("headphones: 'noise' does not trigger decibel_test (EN == VI)", () => {
  for (const productName of ["Noise cancelling wireless headphones", "Active noise cancellation earbuds", "Tai nghe chống ồn", "tai nghe chong on"]) {
    it(`"${productName}" → anc_ab, not decibel_test`, () => {
      const got = allIds({ productName });
      expect(got).toContain("anc_ab");
      expect(got).not.toContain("decibel_test");
    });
  }
  it("quiet appliances still hit decibel_test", () => {
    expect(allIds({ productName: "Low noise air purifier" })).toContain("decibel_test");
    expect(allIds({ productName: "Quạt yên tĩnh" })).toContain("decibel_test");
  });
});

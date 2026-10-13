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

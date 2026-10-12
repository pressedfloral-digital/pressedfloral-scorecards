import { describe, expect, it } from "vitest";
import { buildCanonicalNameMap, namesLikelySamePerson } from "../../lib/employeeIdentity";

describe("namesLikelySamePerson", () => {
  it("matches a shortened first and last name", () => {
    expect(namesLikelySamePerson("Cydnei Gay", "Cyd G")).toBe(true);
  });

  it("ignores case, accents, punctuation and extra spaces", () => {
    expect(namesLikelySamePerson("  noemi  nuchurch", "Noémi NuChurch")).toBe(true);
    expect(namesLikelySamePerson("Mary-Kate Smith", "Marykate Smith")).toBe(true);
  });

  it("does not match different people who share a first or last name", () => {
    expect(namesLikelySamePerson("Emma Zaugg", "Emma Dunakey")).toBe(false);
    expect(namesLikelySamePerson("Grace Hill", "Hailey Hill")).toBe(false);
    expect(namesLikelySamePerson("Olivia Dunakey", "Emma Dunakey")).toBe(false);
  });

  it("needs at least 3 letters of first name to treat one as a short form", () => {
    expect(namesLikelySamePerson("Al Gray", "Alyssa Gray")).toBe(false);
  });
});

describe("buildCanonicalNameMap", () => {
  const current = new Set(["Cyd G", "Emma Dunakey", "Emma Solomon", "Ann Lee", "Anna Leeds"]);

  it("folds a former name into the one current team member it matches", () => {
    const map = buildCanonicalNameMap(["Cydnei Gay", "Cyd G", "Kate Loveridge"], current);
    expect(map.get("Cydnei Gay")).toBe("Cyd G");
    expect(map.has("Cyd G")).toBe(false);
    expect(map.has("Kate Loveridge")).toBe(false);
  });

  it("leaves a former name alone when it matches more than one current team member", () => {
    expect(buildCanonicalNameMap(["Ann Lee "], new Set(["Ann Lee", "Anne Lee"])).has("Ann Lee ")).toBe(false);
  });

  it("uses an app user's alternate names even when the names look nothing alike", () => {
    const map = buildCanonicalNameMap(["Jane Smith"], new Set(["Jane Doe"]), [{ linkedEmployeeName: "Jane Doe", linkedNameAliases: ["Jane Smith"] }]);
    expect(map.get("Jane Smith")).toBe("Jane Doe");
  });
});

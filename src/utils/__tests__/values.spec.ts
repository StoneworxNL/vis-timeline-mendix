import { Big } from "big.js";
import { deepMerge, dynamicBoolean, parseJsonObject, sameIds, splitIds, toDate, toVisId } from "../values";

describe("toVisId", () => {
    it("normalises every attribute type to the same string", () => {
        expect(toVisId("42")).toBe("42");
        expect(toVisId(new Big(42))).toBe("42");
        // A numeric group id and a string item group id have to end up equal, or items silently
        // land in the wrong row.
        expect(toVisId(new Big(1243))).toBe(toVisId("1243"));
    });

    it("treats an empty or missing value as no id", () => {
        expect(toVisId(undefined)).toBeUndefined();
        expect(toVisId("")).toBeUndefined();
    });

    it("keeps the full precision of a long", () => {
        expect(toVisId(new Big("9007199254740993"))).toBe("9007199254740993");
    });
});

describe("splitIds and sameIds", () => {
    it("reads a comma separated list, ignoring blanks and padding", () => {
        expect(splitIds(" 1, 2 ,,3 ")).toEqual(["1", "2", "3"]);
        expect(splitIds("")).toEqual([]);
        expect(splitIds(undefined)).toEqual([]);
    });

    it("compares by content and order", () => {
        expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
        expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
        expect(sameIds(["a"], ["a", "b"])).toBe(false);
    });
});

describe("parseJsonObject", () => {
    it("accepts a plain object", () => {
        expect(parseJsonObject('{"a":1}', "test")).toEqual({ a: 1 });
    });

    it("refuses anything that is not an object, without throwing", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        expect(parseJsonObject("[1,2]", "test")).toBeUndefined();
        expect(parseJsonObject("5", "test")).toBeUndefined();
        expect(parseJsonObject("{oops", "test")).toBeUndefined();
        expect(parseJsonObject(undefined, "test")).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });
});

describe("deepMerge", () => {
    it("overrides one nested value without dropping its siblings", () => {
        const target = { tooltip: { delay: 500, followMouse: false }, stack: true };
        deepMerge(target, { tooltip: { delay: 0 } });
        expect(target).toEqual({ tooltip: { delay: 0, followMouse: false }, stack: true });
    });

    it("never writes into Object.prototype", () => {
        const source = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"a":1}');
        const target: Record<string, any> = {};
        deepMerge(target, source);
        expect(({} as any).polluted).toBeUndefined();
        expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
        expect(target).toEqual({ a: 1 });
    });

    it("replaces arrays and dates rather than merging into them", () => {
        const date = new Date("2024-01-01");
        const target: Record<string, any> = { list: [1, 2], when: new Date("2020-01-01") };
        deepMerge(target, { list: [3], when: date });
        expect(target.list).toEqual([3]);
        expect(target.when).toBe(date);
    });
});

describe("toDate", () => {
    it("passes through dates and parses numbers and strings", () => {
        const date = new Date("2024-05-05T00:00:00.000Z");
        expect(toDate(date)).toBe(date);
        expect(toDate(date.getTime())?.toISOString()).toBe("2024-05-05T00:00:00.000Z");
        expect(toDate("2024-05-05T00:00:00.000Z")?.toISOString()).toBe("2024-05-05T00:00:00.000Z");
    });

    it("rejects values that are not a time", () => {
        expect(toDate(new Date("nonsense"))).toBeUndefined();
        expect(toDate("nonsense")).toBeUndefined();
        expect(toDate(undefined)).toBeUndefined();
        expect(toDate(null)).toBeUndefined();
    });
});

describe("dynamicBoolean", () => {
    it("falls back while the expression is still loading", () => {
        expect(dynamicBoolean({ status: "loading", value: undefined } as any, true)).toBe(true);
        expect(dynamicBoolean({ status: "available", value: false } as any, true)).toBe(false);
        expect(dynamicBoolean(undefined, true)).toBe(true);
    });
});

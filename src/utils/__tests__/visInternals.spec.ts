import { DataSet, Timeline } from "vis-timeline/standalone";
import { builtInLocale } from "../vis";

/**
 * The widget reaches into a few parts of vis-timeline that its type declarations leave out. Each
 * reach is optional-chained, so a vis-timeline update that renames one would fail silently in an
 * app: hidden subgroups flash again, commands fight rolling mode, labels lose their wording. These
 * specs build a real timeline so such an update fails here instead.
 */
describe("vis-timeline internals the widget relies on", () => {
    let container: HTMLElement;
    let timeline: Timeline | undefined;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        timeline?.destroy();
        timeline = undefined;
        container.remove();
    });

    function create(options: Record<string, unknown> = {}): any {
        const items = new DataSet([
            { id: "a", content: "A", start: new Date(2026, 0, 1), group: "g", subgroup: "s" },
            { id: "b", content: "B", start: new Date(2026, 0, 2), group: "g", subgroup: "t" }
        ]);
        const groups = new DataSet([{ id: "g", content: "G", subgroupVisibility: { s: true, t: false } }]);
        timeline = new Timeline(container, items as any, groups as any, options);
        return timeline;
    }

    it("keeps the groups on itemSet, with their subgroup visibility, and can restack them (applySubgroupVisibility)", () => {
        const internals = create();
        expect(internals.itemSet).toBeDefined();
        expect(internals.itemSet.groups.g).toBeDefined();
        expect(internals.itemSet.groups.g.subgroupVisibility).toEqual({ s: true, t: false });
        expect(typeof internals.itemSet.markDirty).toBe("function");
        expect(() => internals.itemSet.markDirty({ restackGroups: true })).not.toThrow();
    });

    it("keeps whether it is rolling on range.rolling (stopRolling)", () => {
        const internals = create({ rollingMode: { follow: true } });
        expect(internals.range.rolling).toBe(true);
        internals.toggleRollingMode();
        expect(internals.range.rolling).toBe(false);
    });

    it("exposes CurrentTime with the built-in locales (builtInLocale)", () => {
        expect(builtInLocale("en")).toEqual(expect.objectContaining({ current: expect.any(String) }));
        expect(builtInLocale("nl")).toEqual(expect.objectContaining({ current: expect.any(String) }));
        expect(builtInLocale("nl")).not.toEqual(builtInLocale("en"));
    });
});

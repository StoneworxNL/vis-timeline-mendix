import { DataSet, Timeline } from "vis-timeline/standalone";
import { VisItem } from "../data";
import { fitWithFallback, inScope, isSettled, syncWhenSettled } from "../guards";
import { VisId } from "../values";
import { listValue } from "../testUtils";

type MockedDataSet = DataSet<VisItem, "id"> & { update: jest.Mock; remove: jest.Mock };
type MockedTimeline = Timeline & { redraw: jest.Mock; fit: jest.Mock; setWindow: jest.Mock };

function fakeDataSet(): MockedDataSet {
    return { update: jest.fn(), remove: jest.fn(), getIds: jest.fn(() => []) } as unknown as MockedDataSet;
}

function fakeTimeline(fit: () => void = () => undefined): MockedTimeline {
    return { redraw: jest.fn(), fit: jest.fn(fit), setWindow: jest.fn() } as unknown as MockedTimeline;
}

function item(id: string, start: string, end?: string): VisItem {
    return { id, content: id, start: new Date(start), end: end ? new Date(end) : undefined } as VisItem;
}

describe("isSettled", () => {
    it("is false while Mendix is loading", () => {
        expect(isSettled(listValue(undefined, "loading"))).toBe(false);
    });

    it("is true once the data is available or unavailable", () => {
        expect(isSettled(listValue([]))).toBe(true);
        expect(isSettled(listValue(undefined, "unavailable"))).toBe(true);
    });

    it("treats a data source that is not configured as settled", () => {
        expect(isSettled(undefined)).toBe(true);
    });
});

describe("syncWhenSettled", () => {
    // Regression: Mendix hands out an empty list while it refreshes. Applying it cleared the
    // timeline and blocked the initial fit.
    it("leaves the timeline alone while the data source is loading", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        syncWhenSettled(listValue([]), dataSet, [item("1", "2024-05-01"), item("2", "2024-05-02")], signatures);
        dataSet.update.mockClear();

        const removed = syncWhenSettled(listValue(undefined, "loading"), dataSet, [], signatures);

        expect(removed).toBeUndefined();
        expect(dataSet.remove).not.toHaveBeenCalled();
        expect(dataSet.update).not.toHaveBeenCalled();
        expect([...signatures.keys()]).toEqual(["1", "2"]);
    });

    it("applies an empty list once the data source has settled", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        syncWhenSettled(listValue([]), dataSet, [item("1", "2024-05-01")], signatures);

        const removed = syncWhenSettled(listValue([]), dataSet, [], signatures);

        expect(removed).toEqual(["1"]);
        expect(dataSet.remove).toHaveBeenCalledWith(["1"]);
    });
});

describe("fitWithFallback", () => {
    const items = [item("1", "2024-05-01T00:00:00Z"), item("2", "2024-05-11T00:00:00Z")];

    it("uses vis-timeline's own fit when it works", () => {
        const timeline = fakeTimeline();
        expect(fitWithFallback(timeline, items, { animation: false })).toBe("fit");
        expect(timeline.redraw).toHaveBeenCalled();
        expect(timeline.fit).toHaveBeenCalledWith({ animation: false });
        expect(timeline.setWindow).not.toHaveBeenCalled();
    });

    // Regression: fit() throws for items in a collapsed nested group, so the Nested Groups demo
    // never moved its window.
    it("falls back to the data range when fit() throws", () => {
        const failure = new Error("Cannot redraw item: no parent attached");
        const timeline = fakeTimeline(() => {
            throw failure;
        });
        const onFallback = jest.fn();

        expect(fitWithFallback(timeline, items, { animation: false }, onFallback)).toBe("range");

        expect(onFallback).toHaveBeenCalledWith(failure);
        expect(timeline.setWindow).toHaveBeenCalledTimes(1);
        const [start, end, options] = timeline.setWindow.mock.calls[0];
        expect((start as Date).getTime()).toBeLessThan(items[0].start.getTime());
        expect((end as Date).getTime()).toBeGreaterThan(items[1].start.getTime());
        expect(options).toEqual({ animation: false });
    });

    it("does not throw and moves nothing when fit() fails and there are no items", () => {
        const timeline = fakeTimeline(() => {
            throw new Error("Cannot redraw item: no parent attached");
        });
        expect(fitWithFallback(timeline, [], { animation: false })).toBe("none");
        expect(timeline.setWindow).not.toHaveBeenCalled();
    });
});

describe("inScope", () => {
    // Regression: clicks on empty space fired item actions with an empty item id, which broke the
    // Events demo's nanoflow.
    it("rejects clicks on the background, the axis or a group label for item-scoped actions", () => {
        expect(inScope("item", { what: "background", item: null, group: "g1" })).toBe(false);
        expect(inScope("item", { what: "axis", item: null })).toBe(false);
        expect(inScope("item", { what: "group-label", group: "g1" })).toBe(false);
        expect(inScope("item", undefined)).toBe(false);
    });

    it("accepts clicks on an item, including an item with id 0", () => {
        expect(inScope("item", { what: "item", item: "a" })).toBe(true);
        expect(inScope("item", { what: "item", item: 0 })).toBe(true);
    });

    // Regression: a marker click never reached On click / On double click with the default scope,
    // so the add-on-double-click, remove-on-second-click marker example did nothing.
    it("accepts clicks on a marker for actions that receive the marker id", () => {
        expect(inScope("item", { what: "custom-time", item: null, customTime: "m1" }, true)).toBe(true);
        expect(inScope("item", { what: "custom-time", item: null, customTime: "m1" })).toBe(false);
    });

    it("accepts every click for actions scoped to anywhere", () => {
        expect(inScope("anywhere", { what: "background", item: null })).toBe(true);
    });
});

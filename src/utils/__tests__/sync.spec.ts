import { DataSet, Timeline } from "vis-timeline/standalone";
import { VisItem, VisMarker } from "../data";
import { forgetLocalEdits, syncDataSet, syncMarkers } from "../sync";
import { VisId } from "../values";

type MockedDataSet = DataSet<VisItem, "id"> & Record<string, jest.Mock>;
type MockedTimeline = Timeline & Record<string, jest.Mock>;

function fakeDataSet(): MockedDataSet {
    return { update: jest.fn(), remove: jest.fn(), getIds: jest.fn(() => []) } as unknown as MockedDataSet;
}

function item(id: string, content: string, end?: string): VisItem {
    return {
        id,
        content,
        start: new Date("2024-05-01T00:00:00Z"),
        end: end ? new Date(end) : undefined
    } as VisItem;
}

describe("syncDataSet", () => {
    it("adds everything on the first pass", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        syncDataSet(dataSet, [item("1", "a"), item("2", "b")], signatures);
        expect(dataSet.update).toHaveBeenCalledWith([
            expect.objectContaining({ id: "1" }),
            expect.objectContaining({ id: "2" })
        ]);
        expect(signatures.size).toBe(2);
    });

    it("says nothing when nothing changed", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        const rows = [item("1", "a")];
        syncDataSet(dataSet, rows, signatures);
        (dataSet.update as jest.Mock).mockClear();

        // A fresh render builds equal but not identical objects; they must not be pushed again,
        // because every update costs a redraw and interrupts a drag in progress.
        syncDataSet(dataSet, [item("1", "a")], signatures);
        expect(dataSet.update).not.toHaveBeenCalled();
    });

    it("pushes only the rows that really changed", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        syncDataSet(dataSet, [item("1", "a"), item("2", "b")], signatures);
        (dataSet.update as jest.Mock).mockClear();

        syncDataSet(dataSet, [item("1", "a"), item("2", "changed")], signatures);
        expect(dataSet.update).toHaveBeenCalledWith([expect.objectContaining({ id: "2", content: "changed" })]);
    });

    it("notices a field that was cleared", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        syncDataSet(dataSet, [item("1", "a", "2024-05-02T00:00:00Z")], signatures);
        (dataSet.update as jest.Mock).mockClear();

        syncDataSet(dataSet, [item("1", "a")], signatures);
        expect(dataSet.update).toHaveBeenCalledWith([expect.objectContaining({ id: "1", end: undefined })]);
    });

    it("removes the rows that disappeared and reports them", () => {
        const dataSet = fakeDataSet();
        const signatures = new Map<VisId, string>();
        syncDataSet(dataSet, [item("1", "a"), item("2", "b")], signatures);

        const removed = syncDataSet(dataSet, [item("1", "a")], signatures);
        expect(removed).toEqual(["2"]);
        expect(dataSet.remove).toHaveBeenCalledWith(["2"]);
        expect(signatures.has("2")).toBe(false);
    });
});

function fakeTimeline(): MockedTimeline {
    return {
        addCustomTime: jest.fn(),
        setCustomTime: jest.fn(),
        setCustomTimeTitle: jest.fn(),
        setCustomTimeMarker: jest.fn(),
        removeCustomTime: jest.fn()
    } as unknown as MockedTimeline;
}

const marker = (id: string, time: string, title?: string): VisMarker => ({ id, time: new Date(time), title });

describe("syncMarkers", () => {
    it("adds a marker with its title", () => {
        const timeline = fakeTimeline();
        const applied = new Map<VisId, VisMarker>();
        syncMarkers(timeline, [marker("a", "2024-05-01T00:00:00Z", "Kickoff")], applied);
        expect(timeline.addCustomTime).toHaveBeenCalledWith(new Date("2024-05-01T00:00:00Z"), "a");
        expect(timeline.setCustomTimeTitle).toHaveBeenCalledWith("Kickoff", "a");
        expect(applied.size).toBe(1);
    });

    it("moves a marker instead of adding it again", () => {
        const timeline = fakeTimeline();
        const applied = new Map<VisId, VisMarker>();
        syncMarkers(timeline, [marker("a", "2024-05-01T00:00:00Z")], applied);
        (timeline.addCustomTime as jest.Mock).mockClear();

        syncMarkers(timeline, [marker("a", "2024-06-01T00:00:00Z")], applied);
        expect(timeline.addCustomTime).not.toHaveBeenCalled();
        expect(timeline.setCustomTime).toHaveBeenCalledWith(new Date("2024-06-01T00:00:00Z"), "a");
    });

    it("leaves an unchanged marker alone", () => {
        const timeline = fakeTimeline();
        const applied = new Map<VisId, VisMarker>();
        syncMarkers(timeline, [marker("a", "2024-05-01T00:00:00Z", "Kickoff")], applied);
        (timeline.setCustomTimeTitle as jest.Mock).mockClear();

        syncMarkers(timeline, [marker("a", "2024-05-01T00:00:00Z", "Kickoff")], applied);
        expect(timeline.setCustomTime).not.toHaveBeenCalled();
        expect(timeline.setCustomTimeTitle).not.toHaveBeenCalled();
    });

    it("removes a marker that is gone from the data source", () => {
        const timeline = fakeTimeline();
        const applied = new Map<VisId, VisMarker>();
        syncMarkers(timeline, [marker("a", "2024-05-01T00:00:00Z")], applied);

        syncMarkers(timeline, [], applied);
        expect(timeline.removeCustomTime).toHaveBeenCalledWith("a");
        expect(applied.size).toBe(0);
    });

    it("keeps going when vis-timeline refuses a marker", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        const timeline = fakeTimeline();
        (timeline.addCustomTime as jest.Mock).mockImplementationOnce(() => {
            throw new Error("duplicate id");
        });
        const applied = new Map<VisId, VisMarker>();

        syncMarkers(timeline, [marker("a", "2024-05-01T00:00:00Z"), marker("b", "2024-05-02T00:00:00Z")], applied);
        expect(warn).toHaveBeenCalled();
        expect(applied.has("a")).toBe(false);
        expect(applied.has("b")).toBe(true);
        warn.mockRestore();
    });

    describe("labels", () => {
        const labelled = (label?: string, labelEditable = false): VisMarker => ({
            ...marker("a", "2024-05-01T00:00:00Z"),
            label,
            labelEditable
        });

        it("draws no label for a plain bar", () => {
            const timeline = fakeTimeline();
            syncMarkers(timeline, [labelled()], new Map());
            expect(timeline.setCustomTimeMarker).not.toHaveBeenCalled();
        });

        it("draws the label once and again only when it changes", () => {
            const timeline = fakeTimeline();
            const applied = new Map<VisId, VisMarker>();
            syncMarkers(timeline, [labelled("Go live", true)], applied);
            expect(timeline.setCustomTimeMarker).toHaveBeenCalledWith("Go live", "a", true);

            (timeline.setCustomTimeMarker as jest.Mock).mockClear();
            syncMarkers(timeline, [labelled("Go live", true)], applied);
            expect(timeline.setCustomTimeMarker).not.toHaveBeenCalled();

            syncMarkers(timeline, [labelled(undefined)], applied);
            expect(timeline.setCustomTimeMarker).toHaveBeenCalledWith("", "a", false);
        });

        it("leaves a label alone while the user is typing in it", () => {
            const timeline = fakeTimeline();
            const applied = new Map<VisId, VisMarker>();
            syncMarkers(timeline, [labelled("Go live", true)], applied);

            const bar = document.createElement("div") as HTMLDivElement & Record<string, unknown>;
            bar["custom-time"] = { options: { id: "a" } };
            const label = document.createElement("div");
            label.className = "vis-custom-time-marker";
            label.tabIndex = 0;
            bar.appendChild(label);
            document.body.appendChild(bar);
            label.focus();

            (timeline.setCustomTimeMarker as jest.Mock).mockClear();
            syncMarkers(timeline, [labelled("Go li", true)], applied);
            expect(timeline.setCustomTimeMarker).not.toHaveBeenCalled();

            label.blur();
            syncMarkers(timeline, [labelled("Go li", true)], applied);
            expect(timeline.setCustomTimeMarker).toHaveBeenCalledWith("Go li", "a", true);
            bar.remove();
        });
    });
});

describe("syncDataSet against what the timeline holds", () => {
    function timelineData(): DataSet<VisItem, "id"> {
        return new DataSet<VisItem, "id">();
    }

    it("removes items the timeline created itself that Mendix does not have", () => {
        const dataSet = timelineData();
        const signatures = new Map<VisId, string>();
        syncDataSet(dataSet, [item("1", "a")], signatures);
        // What vis-timeline does when the user adds an item with "add and call action".
        dataSet.add({ id: "6f1c-uuid", content: "new item", start: new Date() } as VisItem);

        const removed = syncDataSet(dataSet, [item("1", "a"), item("2", "created by the microflow")], signatures);

        expect(removed).toEqual(["6f1c-uuid"]);
        expect(dataSet.getIds().sort()).toEqual(["1", "2"]);
    });
});

describe("forgetLocalEdits", () => {
    const start = new Date("2024-05-01T00:00:00Z");
    const moved = new Date("2024-06-01T00:00:00Z");

    function setUp(): { dataSet: DataSet<VisItem, "id">; signatures: Map<VisId, string>; rows: VisItem[] } {
        const dataSet = new DataSet<VisItem, "id">();
        const signatures = new Map<VisId, string>();
        const rows = [item("1", "a"), item("2", "b")];
        syncDataSet(dataSet, rows, signatures);
        return { dataSet, signatures, rows };
    }

    it("puts a refused move back where Mendix has it", () => {
        const { dataSet, signatures, rows } = setUp();
        dataSet.update({ id: "1", start: moved } as VisItem);
        const edited = new Set<VisId>(["1"]);

        // Without forgetting, the unchanged Mendix data leaves the item where it was dropped.
        syncDataSet(dataSet, rows, signatures);
        expect(dataSet.get("1")!.start).toEqual(moved);

        expect(forgetLocalEdits(edited, signatures)).toBe(true);
        syncDataSet(dataSet, rows, signatures);
        expect(dataSet.get("1")!.start).toEqual(start);
        expect(edited.size).toBe(0);
    });

    it("brings back an item whose removal Mendix refused", () => {
        const { dataSet, signatures, rows } = setUp();
        dataSet.remove("2");

        forgetLocalEdits(new Set<VisId>(["2"]), signatures);
        syncDataSet(dataSet, rows, signatures);

        expect(dataSet.get("2")).toEqual(expect.objectContaining({ id: "2", content: "b" }));
    });

    it("keeps a removal Mendix accepted", () => {
        const { dataSet, signatures, rows } = setUp();
        dataSet.remove("2");

        forgetLocalEdits(new Set<VisId>(["2"]), signatures);
        syncDataSet(dataSet, [rows[0]], signatures);

        expect(dataSet.getIds()).toEqual(["1"]);
    });

    it("does nothing when there are no edits", () => {
        const signatures = new Map<VisId, string>([["1", "x"]]);
        expect(forgetLocalEdits(new Set(), signatures)).toBe(false);
        expect(signatures.size).toBe(1);
    });
});

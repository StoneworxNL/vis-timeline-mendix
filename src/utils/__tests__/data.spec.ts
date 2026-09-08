import { buildGroups, buildHiddenDates, buildItems, buildMarkers, itemsRange } from "../data";
import {
    attribute,
    containerProps,
    dateAttribute,
    listValue,
    numberAttribute,
    referenceSet,
    Row,
    textTemplate
} from "../testUtils";

const itemRows: Row[] = [
    { id: "1", start: "2024-05-01T00:00:00Z", end: "2024-05-02T00:00:00Z", content: "First", group: "a" },
    { id: "2", start: "2024-05-03T00:00:00Z", content: "Second", group: "b" }
];

function itemProps(overrides = {}): ReturnType<typeof containerProps> {
    return containerProps({
        VisItemsDataSource: listValue(itemRows),
        ItemID: attribute("id"),
        Start: dateAttribute("start"),
        End: dateAttribute("end"),
        ItemContent: attribute("content"),
        ItemGroupID: attribute("group"),
        ...overrides
    } as any);
}

describe("buildItems", () => {
    it("maps the data source onto vis items and keeps the objects reachable", () => {
        const { items, objects } = buildItems(itemProps());

        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            id: "1",
            content: "First",
            group: "a",
            start: new Date("2024-05-01T00:00:00Z"),
            end: new Date("2024-05-02T00:00:00Z")
        });
        expect(items[1].end).toBeUndefined();
        expect(objects.get("2")).toBe(itemRows[1]);
    });

    it("always spells out every field, so a cleared value is not kept by the merge in the data set", () => {
        const [item] = buildItems(itemProps()).items;
        // vis-timeline merges an update into the row it holds, so a key that is simply left out
        // would keep its previous value forever.
        expect(Object.keys(item).sort()).toEqual(
            [
                "align",
                "className",
                "content",
                "editable",
                "end",
                "group",
                "id",
                "limitSize",
                "orderValue",
                "selectable",
                "start",
                "style",
                "subgroup",
                "title",
                "type"
            ].sort()
        );
    });

    it("reads values, never the formatted display value", () => {
        const [item] = buildItems(itemProps()).items;
        expect(item.content).toBe("First");
        expect(item.id).toBe("1");
    });

    it("skips rows that cannot be placed instead of failing", () => {
        const rows: Row[] = [
            { id: "", start: "2024-05-01T00:00:00Z" },
            { id: "3", start: null },
            { id: "4", start: "2024-05-01T00:00:00Z" }
        ];
        const { items } = buildItems(itemProps({ VisItemsDataSource: listValue(rows) }));
        expect(items.map(item => item.id)).toEqual(["4"]);
    });

    it("hands back nothing while the data source is loading", () => {
        expect(buildItems(itemProps({ VisItemsDataSource: listValue(itemRows, "loading") })).items).toEqual([]);
    });

    it("only accepts item types vis-timeline understands", () => {
        const rows: Row[] = [
            { id: "1", start: "2024-05-01T00:00:00Z", type: "background" },
            { id: "2", start: "2024-05-01T00:00:00Z", type: "nonsense" }
        ];
        const { items } = buildItems(itemProps({ VisItemsDataSource: listValue(rows), Type: attribute("type") }));
        expect(items[0].type).toBe("background");
        expect(items[1].type).toBeUndefined();
    });

    it("leaves the content empty when a widget template renders it", () => {
        const { items } = buildItems(itemProps({ itemContentType: "custom" }));
        expect(items[0].content).toBe("");
    });

    it("only fills the tooltip for the text tooltip type", () => {
        const title = textTemplate(row => `tip ${row.id}`);
        expect(buildItems(itemProps({ itemTooltipType: "text", itemTitle: title })).items[0].title).toBe("tip 1");
        expect(buildItems(itemProps({ itemTooltipType: "custom", itemTitle: title })).items[0].title).toBeUndefined();
        expect(buildItems(itemProps({ itemTooltipType: "none", itemTitle: title })).items[0].title).toBeUndefined();
    });

    describe("editability", () => {
        const rows: Row[] = [{ id: "1", start: "2024-05-01T00:00:00Z", editable: false, drag: true }];

        it("uses the boolean when no fine grained attribute is mapped", () => {
            const { items } = buildItems(
                itemProps({ VisItemsDataSource: listValue(rows), itemEditable: attribute("editable") })
            );
            expect(items[0].editable).toBe(false);
        });

        it("builds an object as soon as one fine grained attribute is mapped", () => {
            const { items } = buildItems(
                itemProps({
                    VisItemsDataSource: listValue(rows),
                    itemEditable: attribute("editable"),
                    itemEditableUpdateTime: attribute("drag")
                })
            );
            expect(items[0].editable).toEqual({ updateTime: true, updateGroup: undefined, remove: undefined });
        });

        it("stays out of the way when the timeline settings override items", () => {
            const { items } = buildItems(
                itemProps({
                    VisItemsDataSource: listValue(rows),
                    itemEditable: attribute("editable"),
                    editableOverrideItems: true
                })
            );
            expect(items[0].editable).toBeUndefined();
        });
    });
});

describe("buildGroups", () => {
    const groupRows: Row[] = [
        { id: "root", content: "Root", children: ["child"], expanded: false, level: 1 },
        { id: "child", content: "Child", children: [], level: 2 }
    ];

    function groupProps(overrides = {}): ReturnType<typeof containerProps> {
        const index = new Map(groupRows.map(row => [row.id, row]));
        return containerProps({
            VisGroupsDataSource: listValue(groupRows),
            GroupIDAttr: attribute("id"),
            GroupContentAttr: attribute("content"),
            groupAssociation: referenceSet("children", index),
            groupShowNested: attribute("expanded"),
            treeLevel: numberAttribute("level"),
            ...overrides
        } as any);
    }

    it("resolves nested groups through the self association", () => {
        const { groups } = buildGroups(groupProps());
        expect(groups[0].nestedGroups).toEqual(["child"]);
        expect(groups[0].treeLevel).toBe(1);
    });

    it("only sets showNested on a group that has children", () => {
        const { groups } = buildGroups(groupProps());
        expect(groups[0].showNested).toBe(false);
        expect(groups[1].showNested).toBeUndefined();
        expect(groups[1].nestedGroups).toBeUndefined();
    });

    it("leaves the content undefined so vis-timeline falls back to the group id", () => {
        const { groups } = buildGroups(groupProps({ GroupContentAttr: attribute("missing") }));
        expect(groups[0].content).toBeUndefined();
    });

    it("collects subgroup visibility per group", () => {
        const subgroups: Row[] = [
            { id: "s1", group: "root", sub: "left", visible: true },
            { id: "s2", group: "root", sub: "right", visible: false },
            { id: "s3", group: "child", sub: "left", visible: false }
        ];
        const { groups } = buildGroups(
            groupProps({
                subgroupsDataSource: listValue(subgroups),
                subgroupGroupId: attribute("group"),
                subgroupId: attribute("sub"),
                subgroupVisible: attribute("visible")
            })
        );
        expect(groups[0].subgroupVisibility).toEqual({ left: true, right: false });
        expect(groups[1].subgroupVisibility).toEqual({ left: false });
    });

    it("hands back nothing when there is no groups data source", () => {
        expect(buildGroups(containerProps()).groups).toEqual([]);
    });
});

describe("buildMarkers", () => {
    it("needs both an id and a time", () => {
        const rows: Row[] = [
            { id: "a", time: "2024-05-01T00:00:00Z", label: "Kickoff" },
            { id: "b", time: null },
            { id: "", time: "2024-05-01T00:00:00Z" }
        ];
        const markers = buildMarkers(
            containerProps({
                markersDataSource: listValue(rows),
                markerId: attribute("id"),
                markerTime: dateAttribute("time"),
                markerTitle: textTemplate(row => row.label)
            } as any)
        );
        expect(markers).toEqual([{ id: "a", time: new Date("2024-05-01T00:00:00Z"), title: "Kickoff" }]);
    });
});

describe("buildHiddenDates", () => {
    it("keeps only periods with both ends and a repeat vis-timeline knows", () => {
        const rows: Row[] = [
            { id: "1", from: "2024-05-04T00:00:00Z", to: "2024-05-06T00:00:00Z", repeat: "weekly" },
            { id: "2", from: "2024-05-04T00:00:00Z", to: "2024-05-06T00:00:00Z", repeat: "fortnightly" },
            { id: "3", from: "2024-05-04T00:00:00Z" }
        ];
        const hidden = buildHiddenDates(
            containerProps({
                hiddenDatesDataSource: listValue(rows),
                hiddenDateStart: dateAttribute("from"),
                hiddenDateEnd: dateAttribute("to"),
                hiddenDateRepeat: attribute("repeat")
            } as any)
        );
        expect(hidden).toHaveLength(2);
        expect(hidden[0].repeat).toBe("weekly");
        expect(hidden[1].repeat).toBeUndefined();
    });
});

describe("itemsRange", () => {
    it("spans start to end with a margin, so the outer labels are not clipped", () => {
        const range = itemsRange([
            { id: "1", content: "", start: new Date("2024-05-01T00:00:00Z"), end: new Date("2024-05-11T00:00:00Z") },
            { id: "2", content: "", start: new Date("2024-05-05T00:00:00Z") }
        ]);
        const day = 24 * 60 * 60 * 1000;
        expect(range!.start.getTime()).toBe(new Date("2024-05-01T00:00:00Z").getTime() - 10 * day * 0.05);
        expect(range!.end.getTime()).toBe(new Date("2024-05-11T00:00:00Z").getTime() + 10 * day * 0.05);
    });

    it("gives a single point in time a window of its own", () => {
        const start = new Date("2024-05-01T00:00:00Z");
        const range = itemsRange([{ id: "1", content: "", start }])!;
        expect(range.end.getTime() - range.start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("has no answer without items", () => {
        expect(itemsRange([])).toBeUndefined();
    });
});

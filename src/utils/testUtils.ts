import { Big } from "big.js";
import { ListAttributeValue, ListExpressionValue, ListReferenceSetValue, ListValue, ObjectItem } from "mendix";
import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";

/**
 * Stand-ins for the Mendix client values, so the mapping layer can be exercised without a running
 * app. A row is a plain object and doubles as its own ObjectItem, which keeps the tests readable.
 */
export type Row = Record<string, any> & { id: string };

export function listValue(
    items: Row[] | undefined,
    status: "available" | "loading" | "unavailable" = "available"
): any {
    return {
        status,
        items: status === "loading" ? undefined : items,
        offset: 0,
        limit: Infinity,
        totalCount: items?.length,
        sortOrder: [],
        filter: undefined,
        setOffset: jest.fn(),
        setLimit: jest.fn(),
        requestTotalCount: jest.fn(),
        setSortOrder: jest.fn(),
        setFilter: jest.fn(),
        reload: jest.fn()
    } as unknown as ListValue;
}

/** An attribute of a data source row. `read` converts the raw value the way Mendix would. */
export function attribute<T>(key: string, read?: (value: any) => T): ListAttributeValue<any> {
    return {
        get: (item: ObjectItem) => {
            const raw = (item as unknown as Row)[key];
            const value = raw === undefined || raw === null ? undefined : read ? read(raw) : raw;
            return { status: "available", value, displayValue: `formatted:${String(value)}`, readOnly: true };
        }
    } as unknown as ListAttributeValue<any>;
}

export const dateAttribute = (key: string): ListAttributeValue<any> => attribute(key, value => new Date(value));
export const numberAttribute = (key: string): ListAttributeValue<any> => attribute(key, value => new Big(value));

export function referenceSet(key: string, index: Map<string, Row>): ListReferenceSetValue {
    return {
        type: "ReferenceSet",
        get: (item: ObjectItem) => ({
            value: ((item as unknown as Row)[key] ?? []).map((id: string) => index.get(id)).filter(Boolean)
        })
    } as unknown as ListReferenceSetValue;
}

export function textTemplate(render: (row: Row) => string | undefined): ListExpressionValue<string> {
    return {
        get: (item: ObjectItem) => ({ status: "available", value: render(item as unknown as Row) })
    } as unknown as ListExpressionValue<string>;
}

export function dynamic<T>(value: T | undefined, status: "available" | "loading" = "available"): any {
    return { status, value };
}

/** The container props with every non-optional property at its XML default, so a test only has to
 *  spell out what it is actually about. */
export function containerProps(overrides: Partial<VisTimelineContainerProps> = {}): VisTimelineContainerProps {
    const defaults: Record<string, unknown> = {
        name: "timeline",
        class: "",
        VisItemsDataSource: listValue([]),
        ItemID: attribute("id"),
        Start: dateAttribute("start"),
        itemContentType: "attribute",
        itemTooltipType: "none",
        groupContentType: "attribute",
        groupOrderMode: "none",
        showCurrentTime: true,
        height: undefined,
        autoResize: true,
        orientationAxis: "bottom",
        orientationItem: "bottom",
        align: "auto",
        defaultItemType: "auto",
        stack: true,
        stackSubgroups: true,
        groupHeightMode: "auto",
        marginAxis: 20,
        marginItemHorizontal: 10,
        marginItemVertical: 10,
        rtl: false,
        showMajorLabels: true,
        showMinorLabels: true,
        showWeekScale: false,
        maxMinorChars: 7,
        showTooltips: true,
        tooltipFollowMouse: false,
        tooltipOverflowMethod: "flip",
        tooltipDelay: 500,
        tooltipOnItemUpdateTime: false,
        fitOnDataChange: "firstLoad",
        timeAxisScale: "auto",
        timeAxisStep: 1,
        rollingMode: false,
        rollingModeOffset: new Big(0.5),
        selectable: true,
        multiselect: false,
        multiselectPerGroup: false,
        sequentialSelection: false,
        longSelectPressTime: 251,
        focusOnSelection: false,
        moveable: true,
        zoomable: true,
        zoomKey: "none",
        zoomFriction: 5,
        preferZoom: false,
        horizontalScroll: false,
        horizontalScrollInvert: false,
        verticalScroll: false,
        clickToUse: false,
        clusterItems: false,
        clusterMaxItems: 5,
        clusterFitOnDoubleClick: true,
        clusterShowStipes: false,
        editableAdd: dynamic(false),
        editableRemove: dynamic(false),
        editableUpdateTime: dynamic(false),
        editableUpdateGroup: dynamic(false),
        editableOverrideItems: false,
        itemsAlwaysDraggableItem: false,
        itemsAlwaysDraggableRange: false,
        groupEditableAdd: dynamic(false),
        groupEditableRemove: dynamic(false),
        groupEditableOrder: dynamic(false),
        IsSnap: dynamic(true),
        snapMinutes: 0,
        addMode: "callAction",
        moveMode: "moveAndCallAction",
        removeMode: "callAction",
        clickScope: "item",
        doubleClickScope: "item",
        contextMenuScope: "item",
        animateChanges: true,
        animationDuration: 500,
        animationEasing: "easeInOutQuad",
        xssDisabled: false,
        showLoadingOverlay: true
    };
    return { ...defaults, ...overrides } as unknown as VisTimelineContainerProps;
}

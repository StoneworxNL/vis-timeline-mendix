import { ObjectItem } from "mendix";
import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";
import { readAttribute, readId, readNumber, readTemplate, VisId } from "./values";

/**
 * Every field is always present on the objects below, even when it is undefined. vis-timeline
 * merges an update into the row it already holds, so a field that is simply left out would keep
 * its previous value forever - an item that loses its end date would stay a range item.
 */
export interface VisItem {
    id: VisId;
    content: string;
    start: Date;
    end?: Date;
    group?: VisId;
    subgroup?: VisId;
    type?: string;
    className?: string;
    style?: string;
    title?: string;
    align?: string;
    limitSize?: boolean;
    selectable?: boolean;
    editable?: boolean | { updateTime?: boolean; updateGroup?: boolean; remove?: boolean };
    orderValue?: number;
}

export interface VisGroup {
    id: VisId;
    content?: string;
    className?: string;
    style?: string;
    title?: string;
    visible?: boolean;
    showNested?: boolean;
    nestedGroups?: VisId[];
    treeLevel?: number;
    value?: number;
    subgroupOrder?: string;
    subgroupStack?: boolean;
    subgroupVisibility?: Record<string, boolean>;
}

export interface VisMarker {
    id: VisId;
    time: Date;
    title?: string;
}

export interface HiddenDate {
    start: Date;
    end: Date;
    repeat?: "daily" | "weekly" | "monthly" | "yearly";
}

const ITEM_TYPES = ["box", "point", "range", "background"];
const ALIGNMENTS = ["auto", "center", "left", "right"];
const REPEATS = ["daily", "weekly", "monthly", "yearly"];
const HALF_DAY = 12 * 60 * 60 * 1000;

/** Maps the items data source onto vis-timeline items, and keeps a lookup from vis id back to the
 *  Mendix object so templates and events can resolve the row they belong to. */
export function buildItems(props: VisTimelineContainerProps): { items: VisItem[]; objects: Map<VisId, ObjectItem> } {
    const objects = new Map<VisId, ObjectItem>();
    const items: VisItem[] = [];

    if (props.VisItemsDataSource.status !== "available" || !props.VisItemsDataSource.items) {
        return { items, objects };
    }

    for (const object of props.VisItemsDataSource.items) {
        const id = readId(props.ItemID, object);
        const start = readAttribute(props.Start, object);
        // An item without an id cannot be addressed, and one without a start cannot be placed.
        if (id === undefined || start === undefined) {
            continue;
        }

        objects.set(id, object);
        items.push({
            id,
            content: props.itemContentType === "attribute" ? readAttribute(props.ItemContent, object) ?? "" : "",
            start,
            end: readAttribute(props.End, object),
            group: readId(props.ItemGroupID, object),
            subgroup: readId(props.itemSubgroupId, object),
            type: oneOf(readAttribute(props.Type, object), ITEM_TYPES),
            className: blankToUndefined(readAttribute(props.ItemClassName, object)),
            style: blankToUndefined(readAttribute(props.itemStyle, object)),
            title: props.itemTooltipType === "text" ? readTemplate(props.itemTitle, object) : undefined,
            align: oneOf(readAttribute(props.itemAlign, object), ALIGNMENTS),
            limitSize: readAttribute(props.itemLimitSize, object),
            selectable: readAttribute(props.itemSelectable, object),
            editable: buildItemEditable(props, object),
            orderValue: readNumber(props.itemOrderValue, object)
        });
    }

    return { items, objects };
}

function buildItemEditable(props: VisTimelineContainerProps, object: ObjectItem): VisItem["editable"] {
    if (props.editableOverrideItems) {
        return undefined;
    }
    const updateTime = readAttribute(props.itemEditableUpdateTime, object);
    const updateGroup = readAttribute(props.itemEditableUpdateGroup, object);
    const remove = readAttribute(props.itemEditableRemove, object);

    if (updateTime === undefined && updateGroup === undefined && remove === undefined) {
        return readAttribute(props.itemEditable, object);
    }
    return { updateTime, updateGroup, remove };
}

/** Maps the groups data source onto vis-timeline groups, resolving nested groups through the
 *  self-association and folding in the subgroup visibility from its own data source. */
export function buildGroups(props: VisTimelineContainerProps): { groups: VisGroup[]; objects: Map<VisId, ObjectItem> } {
    const objects = new Map<VisId, ObjectItem>();
    const groups: VisGroup[] = [];

    if (!props.VisGroupsDataSource || props.VisGroupsDataSource.status !== "available") {
        return { groups, objects };
    }

    const subgroupVisibility = buildSubgroupVisibility(props);

    for (const object of props.VisGroupsDataSource.items ?? []) {
        const id = readId(props.GroupIDAttr, object);
        if (id === undefined) {
            continue;
        }
        const nestedGroups = readNestedGroups(props, object);

        objects.set(id, object);
        groups.push({
            id,
            // Leaving the content undefined makes vis-timeline fall back to the group id, which is
            // a far more useful label than an empty row while a project is being set up.
            content: props.groupContentType === "attribute" ? readAttribute(props.GroupContentAttr, object) : "",
            className: blankToUndefined(readAttribute(props.GroupClassName, object)),
            style: blankToUndefined(readAttribute(props.groupStyle, object)),
            title: readTemplate(props.groupTitle, object),
            visible: readAttribute(props.groupVisible, object),
            // showNested only means something on a group that actually has children.
            showNested: nestedGroups.length > 0 ? readAttribute(props.groupShowNested, object) : undefined,
            nestedGroups: nestedGroups.length > 0 ? nestedGroups : undefined,
            treeLevel: readNumber(props.treeLevel, object),
            value: readNumber(props.GroupValue, object),
            subgroupOrder: blankToUndefined(readAttribute(props.groupSubgroupOrder, object)),
            subgroupStack: readAttribute(props.groupSubgroupStack, object),
            subgroupVisibility: subgroupVisibility.get(id)
        });
    }

    return { groups, objects };
}

function readNestedGroups(props: VisTimelineContainerProps, object: ObjectItem): VisId[] {
    const nested = props.groupAssociation?.get(object).value;
    if (!nested || nested.length === 0) {
        return [];
    }
    const ids: VisId[] = [];
    for (const child of nested) {
        const childId = readId(props.GroupIDAttr, child);
        if (childId !== undefined) {
            ids.push(childId);
        }
    }
    return ids;
}

function buildSubgroupVisibility(props: VisTimelineContainerProps): Map<VisId, Record<string, boolean>> {
    const byGroup = new Map<VisId, Record<string, boolean>>();
    if (!props.subgroupsDataSource || props.subgroupsDataSource.status !== "available") {
        return byGroup;
    }
    for (const object of props.subgroupsDataSource.items ?? []) {
        const groupId = readId(props.subgroupGroupId, object);
        const subgroup = readId(props.subgroupId, object);
        const visible = readAttribute(props.subgroupVisible, object);
        if (groupId === undefined || subgroup === undefined || visible === undefined) {
            continue;
        }
        const visibility = byGroup.get(groupId) ?? {};
        visibility[subgroup] = visible;
        byGroup.set(groupId, visibility);
    }
    return byGroup;
}

export function buildMarkers(props: VisTimelineContainerProps): VisMarker[] {
    if (!props.markersDataSource || props.markersDataSource.status !== "available") {
        return [];
    }
    const markers: VisMarker[] = [];
    for (const object of props.markersDataSource.items ?? []) {
        const id = readId(props.markerId, object);
        const time = readAttribute(props.markerTime, object);
        if (id === undefined || time === undefined) {
            continue;
        }
        markers.push({ id, time, title: readTemplate(props.markerTitle, object) });
    }
    return markers;
}

export function buildHiddenDates(props: VisTimelineContainerProps): HiddenDate[] {
    if (!props.hiddenDatesDataSource || props.hiddenDatesDataSource.status !== "available") {
        return [];
    }
    const hidden: HiddenDate[] = [];
    for (const object of props.hiddenDatesDataSource.items ?? []) {
        const start = readAttribute(props.hiddenDateStart, object);
        const end = readAttribute(props.hiddenDateEnd, object);
        if (start === undefined || end === undefined) {
            continue;
        }
        const repeat = oneOf(readAttribute(props.hiddenDateRepeat, object), REPEATS) as HiddenDate["repeat"];
        hidden.push({ start, end, repeat });
    }
    return hidden;
}

/**
 * The span covered by the items, padded a little so the outermost labels are not clipped.
 *
 * vis-timeline has `fit()` for this, but it insists on measuring the rendered width of every item
 * and throws "Cannot redraw item: no parent attached" for items that sit in a collapsed nested
 * group. This is the fallback for that case.
 */
export function itemsRange(items: VisItem[]): { start: Date; end: Date } | undefined {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const item of items) {
        const start = item.start.getTime();
        const end = item.end ? item.end.getTime() : start;
        min = Math.min(min, start);
        max = Math.max(max, end);
    }
    if (min === Number.POSITIVE_INFINITY) {
        return undefined;
    }

    const span = max - min;
    const padding = span > 0 ? span * 0.05 : HALF_DAY;
    return { start: new Date(min - padding), end: new Date(max + padding) };
}

/** Stable string used to detect which rows really changed, so untouched rows are never handed back
 *  to vis-timeline (every update triggers a redraw and interrupts an in-flight interaction). */
export function signature(value: object): string {
    return JSON.stringify(value);
}

function oneOf(value: string | undefined, allowed: string[]): string | undefined {
    return value !== undefined && allowed.includes(value) ? value : undefined;
}

function blankToUndefined(value: string | undefined): string | undefined {
    return value !== undefined && value !== "" ? value : undefined;
}

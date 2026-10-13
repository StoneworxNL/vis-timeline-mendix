import { Big } from "big.js";
import { ActionValue, ListActionValue, ObjectItem } from "mendix";
import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";
import { toDate } from "./values";

/** Runs a Mendix action, unless the platform says it cannot run or is already running. */
export function fireAction(action: ActionValue<any> | undefined, args?: Record<string, unknown>): void {
    if (!action || !action.canExecute || action.isExecuting) {
        return;
    }
    (action.execute as (a?: Record<string, unknown>) => void)(args);
}

/**
 * Runs an action bound to the items data source, for the row the item came from. This is what lets
 * a microflow work with the object itself instead of retrieving it from an id.
 */
export function fireItemAction(
    action: ListActionValue<any> | undefined,
    object: ObjectItem | undefined,
    args?: Record<string, unknown>
): void {
    if (action && object) {
        fireAction(action.get(object), args);
    }
}

/** The variables On add receives for an item the user created, by double click or by a drop. */
export function addActionArgs(item: any): Record<string, unknown> {
    return {
        data: JSON.stringify(item),
        addedStart: toDate(item?.start),
        addedEnd: toDate(item?.end),
        addedGroupID: idToString(item?.group),
        addedContent: typeof item?.content === "string" ? item.content : undefined
    };
}

/**
 * Whether an edit the timeline keeps on screen (the ...AndCallAction modes) waits for Mendix to
 * confirm it. That is only the case when an action is bound to hear about it: with none, nothing
 * would ever confirm the edit, and it would be undone as soon as any other edit action finished.
 */
export function awaitsConfirmation(
    props: Pick<
        VisTimelineContainerProps,
        | "addMode"
        | "moveMode"
        | "removeMode"
        | "onAddAction"
        | "moveAction"
        | "itemMoveAction"
        | "onRemoveAction"
        | "itemRemoveAction"
    >,
    edit: "add" | "move" | "remove"
): boolean {
    switch (edit) {
        case "add":
            return props.addMode === "addAndCallAction" && props.onAddAction !== undefined;
        case "move":
            return (
                props.moveMode === "moveAndCallAction" &&
                (props.moveAction !== undefined || props.itemMoveAction !== undefined)
            );
        case "remove":
            return (
                props.removeMode === "removeAndCallAction" &&
                (props.onRemoveAction !== undefined || props.itemRemoveAction !== undefined)
            );
    }
}

/** Whether any of the actions is still running, the bound ones for any of the given rows. */
export function isAnyRunning(
    actions: Array<ActionValue<any> | undefined>,
    listActions: Array<ListActionValue<any> | undefined>,
    objects: ObjectItem[]
): boolean {
    return (
        actions.some(action => action?.isExecuting) ||
        listActions.some(action => action && objects.some(object => action.get(object).isExecuting))
    );
}

/** Mirrors a selection made on the timeline into the Mendix selection property. */
export function writeSelection(selection: VisTimelineContainerProps["itemSelection"], objects: ObjectItem[]): void {
    if (!selection) {
        return;
    }
    try {
        if (selection.type === "Multi") {
            selection.setSelection(objects);
        } else {
            selection.setSelection(objects[0]);
        }
    } catch (error) {
        // Mendix refuses an object that no longer belongs to the data source, which happens when a
        // selection is made while that data source is being refreshed.
        console.warn("VisTimeline: could not hand the selection to Mendix.", error);
    }
}

/** Reads the Mendix selection as a flat list of objects, whichever of the two shapes it has. */
export function readSelection(selection: VisTimelineContainerProps["itemSelection"]): ObjectItem[] {
    const chosen = selection?.selection;
    if (chosen === undefined) {
        return [];
    }
    return Array.isArray(chosen) ? chosen : [chosen];
}

export function idToString(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
}

/** Action variables of type Integer are handed over as Big. */
export function toBig(value: unknown): Big | undefined {
    if (typeof value !== "number" && typeof value !== "string") {
        return undefined;
    }
    try {
        return new Big(value);
    } catch {
        return undefined;
    }
}

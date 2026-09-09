import { Big } from "big.js";
import { ActionValue, ListActionValue, ObjectItem } from "mendix";
import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";

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

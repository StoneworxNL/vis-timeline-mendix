import { Big } from "big.js";
import { ActionValue, ListActionValue, ObjectItem } from "mendix";
import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";
import { splitIds, toDate, VisId } from "./values";

/**
 * Runs a Mendix action, unless the platform says it cannot run or is already running. Only for the
 * events that fire many times a second (hover, moving, marker dragging, typing), where skipping a
 * run is what the property descriptions promise; edits go through an ActionQueue.
 */
export function fireAction(action: ActionValue<any> | undefined, args?: Record<string, unknown>): void {
    if (!action || !action.canExecute || action.isExecuting) {
        return;
    }
    execute(action, args);
}

function execute(action: ActionValue<any>, args?: Record<string, unknown>): void {
    (action.execute as (a?: Record<string, unknown>) => void)(args);
}

/** Reads the action as it is now: Mendix hands out a new ActionValue whenever its state changes. */
export type ActionSource = () => ActionValue<any> | undefined;

interface PendingAction {
    key: string;
    source: ActionSource;
    args?: Record<string, unknown>;
}

/**
 * How long an action that was started is taken to be running when Mendix never reports it as
 * running, which it does not have to for an action that finishes at once.
 */
const START_GRACE_MS = 1000;

/**
 * Runs edit actions one after the other instead of dropping the ones that arrive while the previous
 * run is still busy. Dragging a group past three rows swaps the order three times, and two quick
 * drops each need their On move; skipping any of those leaves Mendix with data that no longer
 * matches the screen.
 *
 * Mendix only says an action is running on the ActionValue of a later render, so the action object
 * a run was started from counts as busy too: without that, three calls in the same event would all
 * start at once. Call `flush` after every render, so a queued run starts as soon as Mendix reports
 * the previous one finished.
 */
export class ActionQueue {
    private pending: PendingAction[] = [];
    private readonly started = new Map<string, { action: ActionValue<any>; at: number }>();
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly now: () => number = Date.now) {}

    /**
     * Queues a run of the action `key` names. With `latestOnly`, a run still waiting for the same
     * key is replaced, for events where only the newest value matters (the selection, the range).
     */
    run(key: string, source: ActionSource, args?: Record<string, unknown>, latestOnly = false): void {
        if (!source()) {
            return;
        }
        if (latestOnly) {
            this.pending = this.pending.filter(entry => entry.key !== key);
        }
        this.pending.push({ key, source, args });
        this.flush();
    }

    flush(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        const busy = new Set<string>();
        this.pending = this.pending.filter(entry => {
            if (busy.has(entry.key)) {
                return true;
            }
            const action = entry.source();
            if (!action) {
                // The action was unbound in the meantime, so there is nothing left to run.
                return false;
            }
            const started = this.started.get(entry.key);
            const sameRun = started?.action === action && this.now() - started.at < START_GRACE_MS;
            if (action.isExecuting || sameRun) {
                busy.add(entry.key);
                return true;
            }
            if (!action.canExecute) {
                return false;
            }
            this.started.set(entry.key, { action, at: this.now() });
            execute(action, entry.args);
            busy.add(entry.key);
            return false;
        });
        if (this.pending.length > 0) {
            // The render in which Mendix reports the previous run finished calls flush; this covers
            // an action that finished without Mendix ever reporting it as running.
            this.timer = setTimeout(() => this.flush(), START_GRACE_MS);
        }
    }

    /** Whether a run is still waiting to start, which counts as the edit still being made. */
    hasPending(): boolean {
        return this.pending.length > 0;
    }

    dispose(): void {
        clearTimeout(this.timer);
        this.pending = [];
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

/**
 * The selection Mendix asks for, as vis ids, limited to the items the timeline has. vis-timeline
 * drops an id it does not know, so an id asked for before its item has loaded would otherwise never
 * be selected. The Selection property wins over the ids attribute; `undefined` means neither drives
 * the selection.
 */
export function wantedSelection(
    selection: VisTimelineContainerProps["itemSelection"],
    idsAttribute: VisTimelineContainerProps["selectedItemIds"],
    items: Map<VisId, ObjectItem>
): VisId[] | undefined {
    if (selection) {
        const byObjectId = new Map<string, VisId>();
        items.forEach((object, visId) => byObjectId.set(object.id, visId));
        return readSelection(selection)
            .map(object => byObjectId.get(object.id))
            .filter((id): id is VisId => id !== undefined);
    }
    if (idsAttribute?.status === "available") {
        return splitIds(idsAttribute.value).filter(id => items.has(id));
    }
    return undefined;
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

/**
 * The source for an action bound to the items data source, for one row. The row is looked up when
 * the run starts, so a queued run uses the object as Mendix has it then.
 */
export function itemActionSource(
    list: () => ListActionValue<any> | undefined,
    object: () => ObjectItem | undefined
): ActionSource {
    return () => {
        const action = list();
        const row = object();
        return action && row ? action.get(row) : undefined;
    };
}

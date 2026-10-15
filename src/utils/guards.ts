import { DataSet, Timeline, TimelineAnimationOptions } from "vis-timeline/standalone";
import { itemsRange, VisItem } from "./data";
import { syncDataSet } from "./sync";
import { VisId } from "./values";

/**
 * Mendix reports `loading` while it refreshes a data source, handing out an empty list in the
 * meantime. Applying that would clear the timeline and flash it back a moment later, so whatever is
 * on screen is kept until real data arrives. A data source that is not configured counts as settled.
 */
export function isSettled(source: { status: string } | undefined): boolean {
    return source?.status !== "loading";
}

/**
 * Syncs a data set from a Mendix data source, unless that source is still loading. Returns the
 * removed ids, or `undefined` when nothing was applied.
 */
export function syncWhenSettled<T extends { id: VisId }>(
    source: { status: string } | undefined,
    dataSet: DataSet<T, "id">,
    next: T[],
    signatures: Map<VisId, string>
): VisId[] | undefined {
    if (!isSettled(source)) {
        return undefined;
    }
    return syncDataSet(dataSet, next, signatures);
}

/**
 * vis-timeline's own fit() measures the rendered width of every item and throws for items that sit
 * in a collapsed nested group, which would leave the window stranded wherever it started. Its result
 * is the nicer one, so it is tried first and the data range is the safety net. `onFallback` is told
 * why fit() was given up on. Returns which of the two landed the window, if either did.
 */
export function fitWithFallback(
    timeline: Timeline,
    items: VisItem[],
    animationOptions: TimelineAnimationOptions,
    onFallback?: (error: unknown) => void
): "fit" | "range" | "none" {
    try {
        timeline.redraw();
        timeline.fit(animationOptions);
        return "fit";
    } catch (error) {
        onFallback?.(error);
    }
    const range = itemsRange(items);
    if (!range) {
        return "none";
    }
    timeline.setWindow(range.start, range.end, animationOptions);
    return "range";
}

/**
 * Clicking the background, the time axis or a group label is still a click as far as vis-timeline
 * is concerned. Reporting those to an action that expects an item id is what the scope settings
 * guard against. For actions that receive a marker id (`markers`), a click on a marker counts as a
 * hit too; that is what lets a page add a marker on double click and remove it on a second one.
 */
export function inScope(scope: "item" | "anywhere", properties: any, markers = false): boolean {
    return scope === "anywhere" || properties?.item != null || (markers && properties?.customTime != null);
}

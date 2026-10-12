import { DataSet, Timeline } from "vis-timeline/standalone";
import { signature, VisMarker } from "./data";
import { VisId } from "./values";

/**
 * Pushes only the rows that actually changed into a vis-timeline data set, and removes the ones that
 * disappeared from the Mendix data source. Every update triggers a redraw and interrupts whatever
 * the user is doing, so handing back untouched rows is not harmless. Returns the removed ids.
 */
export function syncDataSet<T extends { id: VisId }>(
    dataSet: DataSet<T, "id">,
    next: T[],
    signatures: Map<VisId, string>
): VisId[] {
    const changed: T[] = [];
    const seen = new Set<VisId>();

    for (const row of next) {
        seen.add(row.id);
        const rowSignature = signature(row);
        if (signatures.get(row.id) !== rowSignature) {
            signatures.set(row.id, rowSignature);
            changed.push(row);
        }
    }

    const removed: VisId[] = [];
    signatures.forEach((_, id) => {
        if (!seen.has(id)) {
            removed.push(id);
        }
    });
    for (const id of removed) {
        signatures.delete(id);
    }

    if (removed.length > 0) {
        dataSet.remove(removed);
    }
    if (changed.length > 0) {
        // The generic row type is wider than the DeepPartial shape the declarations ask for.
        (dataSet as DataSet<any, "id">).update(changed);
    }
    return removed;
}

/** Timeline has setCustomTimeMarker, but the bundled declarations only list it on Graph2d. */
interface TimelineWithMarkers {
    setCustomTimeMarker(title: string, id: VisId, editable: boolean): void;
}

/** Whether the label of this marker is the element the user is typing in right now. */
function isEditingLabel(id: VisId): boolean {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || !active.classList.contains("vis-custom-time-marker")) {
        return false;
    }
    const bar = active.parentElement as (HTMLElement & { "custom-time"?: { options?: { id?: unknown } } }) | null;
    return String(bar?.["custom-time"]?.options?.id) === id;
}

/**
 * Custom time bars live on the timeline instance rather than in a data set, so they are added,
 * moved and removed one by one. `applied` tracks what the timeline currently holds.
 */
export function syncMarkers(timeline: Timeline, next: VisMarker[], applied: Map<VisId, VisMarker>): void {
    const seen = new Set<VisId>();

    for (const marker of next) {
        seen.add(marker.id);
        const current = applied.get(marker.id);
        if (!current) {
            try {
                timeline.addCustomTime(marker.time, marker.id);
            } catch (error) {
                console.warn(`VisTimeline: could not add marker '${marker.id}'.`, error);
                continue;
            }
        } else if (current.time.getTime() !== marker.time.getTime()) {
            timeline.setCustomTime(marker.time, marker.id);
        }
        if (!current || current.title !== marker.title) {
            timeline.setCustomTimeTitle(marker.title ?? "", marker.id);
        }
        const labelChanged = current
            ? current.label !== marker.label || !!current.labelEditable !== !!marker.labelEditable
            : marker.label !== undefined || marker.labelEditable === true;
        if (labelChanged) {
            // Rebuilding the label while the user types in it would throw away the caret and the
            // keystrokes that have not reached Mendix yet, so it is left alone until they are done.
            if (current && isEditingLabel(marker.id)) {
                applied.set(marker.id, { ...marker, label: current.label, labelEditable: current.labelEditable });
                continue;
            }
            (timeline as unknown as TimelineWithMarkers).setCustomTimeMarker(
                marker.label ?? "",
                marker.id,
                marker.labelEditable === true
            );
        }
        applied.set(marker.id, marker);
    }

    for (const id of Array.from(applied.keys())) {
        if (!seen.has(id)) {
            applied.delete(id);
            try {
                timeline.removeCustomTime(id);
            } catch (error) {
                console.warn(`VisTimeline: could not remove marker '${id}'.`, error);
            }
        }
    }
}

import { Timeline } from "vis-timeline/standalone";

export interface InViewReporter {
    /** Works out what is in view a moment from now, once the timeline has settled. */
    report(): void;
    /** Cancels a pending report. Called before the timeline is destroyed. */
    dispose(): void;
}

/**
 * vis-timeline has no event for "what is in view changed", so it is worked out after every window
 * change, scroll and redraw. Only an actual change is reported, which also keeps a microflow that
 * changes the page from triggering itself again. While `isWanted` is false the timeline is not
 * even asked.
 */
export function createInViewReporter(
    timeline: Timeline,
    onChange: (itemIds: string, groupIds: string) => void,
    isWanted: () => boolean,
    delay = 250
): InViewReporter {
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    return {
        report() {
            if (disposed) {
                return;
            }
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = undefined;
                if (disposed || !isWanted()) {
                    return;
                }
                const itemIds = timeline.getVisibleItems().map(String).join(",");
                const groupIds = (
                    (timeline as unknown as { getVisibleGroups?: () => unknown[] }).getVisibleGroups?.() ?? []
                )
                    .map(String)
                    .join(",");
                const current = itemIds + "|" + groupIds;
                if (current === last) {
                    return;
                }
                last = current;
                onChange(itemIds, groupIds);
            }, delay);
        },
        dispose() {
            disposed = true;
            clearTimeout(timer);
            timer = undefined;
        }
    };
}

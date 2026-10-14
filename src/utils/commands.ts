import { Timeline, TimelineAnimationOptions } from "vis-timeline/standalone";
import { splitIds, toDate } from "./values";

/**
 * Mendix has no way of calling a method on a widget, so the imperative half of the vis-timeline API
 * (fit, focus, zoom, move, setWindow) is reachable by writing a command into a string attribute.
 * The widget clears the attribute again once the command has run.
 */
export function runCommand(
    timeline: Timeline,
    raw: string,
    animation: TimelineAnimationOptions,
    fit: (animation: TimelineAnimationOptions) => void,
    focus: (ids: string[], animation: TimelineAnimationOptions) => void = (ids, a) => timeline.focus(ids, a)
): boolean {
    const separator = raw.indexOf(":");
    const name = (separator === -1 ? raw : raw.slice(0, separator)).trim().toLowerCase();
    const argument = separator === -1 ? "" : raw.slice(separator + 1).trim();

    // Rolling mode re-centres the window on now many times a second, so a command that puts the
    // window somewhere else would be undone straight away and the two would fight over it. Dragging
    // the window by hand stops rolling mode in vis-timeline too.
    if (NAVIGATING.has(name)) {
        stopRolling(timeline);
    }
    // Zooming keeps rolling mode on, as the mouse wheel does, but an animated zoom would be cut
    // short by every rolling step, so it is applied at once.
    const zoomAnimation: TimelineAnimationOptions = isRolling(timeline) ? { animation: false } : animation;

    switch (name) {
        case "fit":
            fit(animation);
            return true;
        case "redraw":
            timeline.redraw();
            return true;
        case "zoomin":
            timeline.zoomIn(parseFloat(argument) || 0.5, zoomAnimation);
            return true;
        case "zoomout":
            timeline.zoomOut(parseFloat(argument) || 0.5, zoomAnimation);
            return true;
        case "moveleft":
            moveWindow(timeline, -(parseFloat(argument) || 0.2), animation);
            return true;
        case "moveright":
            moveWindow(timeline, parseFloat(argument) || 0.2, animation);
            return true;
        case "togglerollingmode":
            timeline.toggleRollingMode();
            return true;
        case "focus": {
            const ids = splitIds(argument);
            if (ids.length > 0) {
                focus(ids, animation);
            }
            return true;
        }
        case "focusselection": {
            const selection = timeline.getSelection();
            if (selection.length > 0) {
                focus(selection.map(String), animation);
            }
            return true;
        }
        case "moveto": {
            const time = toDate(argument);
            if (time) {
                timeline.moveTo(time, animation);
            }
            return true;
        }
        case "setwindow": {
            const [rawStart, rawEnd] = argument.split("|");
            const start = toDate(rawStart?.trim());
            const end = toDate(rawEnd?.trim());
            if (start && end) {
                timeline.setWindow(start, end, animation);
            }
            return true;
        }
        default:
            console.warn(`VisTimeline: unknown command '${raw}'.`);
            return false;
    }
}

/** The commands that put the window somewhere other than around the current time. */
const NAVIGATING = new Set(["fit", "moveleft", "moveright", "focus", "focusselection", "moveto", "setwindow"]);

/** vis-timeline keeps whether it is rolling on its range, which the type declarations leave out. */
function isRolling(timeline: Timeline): boolean {
    return (timeline as unknown as { range?: { rolling?: boolean } }).range?.rolling === true;
}

function stopRolling(timeline: Timeline): void {
    if (isRolling(timeline)) {
        timeline.toggleRollingMode();
    }
}

/** Shifts the visible window by a fraction of its own width, the way the navigation menu example
 *  of vis-timeline does it. */
function moveWindow(timeline: Timeline, percentage: number, animation: TimelineAnimationOptions): void {
    const { start, end } = timeline.getWindow();
    const interval = end.valueOf() - start.valueOf();
    timeline.setWindow(start.valueOf() - interval * percentage, end.valueOf() - interval * percentage, animation);
}

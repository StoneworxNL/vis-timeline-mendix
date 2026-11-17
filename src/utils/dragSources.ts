/**
 * vis-timeline only accepts a drop that carries the item as JSON in the drag data, which a Mendix
 * page cannot set. Any element with a data-vis-timeline-item attribute (and draggable="true") is
 * therefore made a drag source here: its attribute value, for example {"content":"New item"}, is
 * handed over as the drag data. One listener serves every timeline on the page.
 */
export const DRAG_SOURCE_ATTRIBUTE = "data-vis-timeline-item";
let dragSourceUsers = 0;

export function onDragStart(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const json = target?.closest(`[${DRAG_SOURCE_ATTRIBUTE}]`)?.getAttribute(DRAG_SOURCE_ATTRIBUTE);
    if (json && event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text", json);
    }
}

/** Starts listening for drags from drag sources; the returned function stops it again. */
export function registerDragSources(): () => void {
    if (dragSourceUsers++ === 0) {
        document.addEventListener("dragstart", onDragStart);
    }
    return () => {
        if (--dragSourceUsers === 0) {
            document.removeEventListener("dragstart", onDragStart);
        }
    };
}

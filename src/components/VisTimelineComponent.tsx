import { ReactElement, ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";
import { ObjectItem } from "mendix";
import {
    DataGroupCollectionType,
    DataItemCollectionType,
    DataSet,
    Timeline,
    TimelineAnimationOptions,
    TimelineOptions
} from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";
import { buildGroups, buildItems, buildMarkers, focusWindow, VisGroup, VisItem, VisMarker } from "../utils/data";
import { syncMarkers } from "../utils/sync";
import { fitWithFallback, inScope, isSettled, syncWhenSettled } from "../utils/guards";
import { fireAction, fireItemAction, idToString, readSelection, toBig, writeSelection } from "../utils/actions";
import { buildStaticOptions } from "../utils/options";
import { runCommand } from "../utils/commands";
import { defaultSnap, resolveLocale, visMoment } from "../utils/vis";
import { dynamicBoolean, dynamicText, sameIds, splitIds, toDate, VisId } from "../utils/values";

type TemplateKind = "item" | "frame" | "tooltip" | "group";

interface TemplateContainer {
    kind: TemplateKind;
    objectId: VisId;
    element: HTMLElement;
}

interface ObjectLookup {
    items: Map<VisId, ObjectItem>;
    groups: Map<VisId, ObjectItem>;
}

type PropsRef = { current: VisTimelineContainerProps };

/** Looks up the Mendix object behind a vis item id, so an action can be handed the object itself. */
type ItemResolver = (id: VisId | undefined) => ObjectItem | undefined;

const MS_PER_MINUTE = 60000;

export function VisTimelineComponent(props: VisTimelineContainerProps): ReactElement {
    const containerRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<Timeline | null>(null);
    const itemsDataSetRef = useRef(new DataSet<VisItem, "id">());
    const groupsDataSetRef = useRef(new DataSet<VisGroup, "id">());

    // Every callback handed to vis-timeline is registered once and reads the current props from
    // here. Re-registering them on each render would either leak listeners or, as in the previous
    // version of this widget, freeze the first render's actions into the timeline forever.
    const propsRef = useRef(props);
    propsRef.current = props;

    const itemSignaturesRef = useRef(new Map<VisId, string>());
    const groupSignaturesRef = useRef(new Map<VisId, string>());
    const appliedMarkersRef = useRef(new Map<VisId, VisMarker>());
    const groupsAttachedRef = useRef(false);
    const appliedSubgroupVisibilityRef = useRef<string | undefined>(undefined);
    const hasFittedRef = useRef(false);
    const appliedSelectionRef = useRef<VisId[]>([]);
    const lastCommandRef = useRef<string | undefined>(undefined);
    const pendingFitRef = useRef(0);
    const warnedAboutFitRef = useRef(false);
    const appliedOptionsRef = useRef<string | undefined>(undefined);

    const containersRef = useRef(new Map<string, TemplateContainer>());
    const objectsRef = useRef<ObjectLookup>({ items: new Map(), groups: new Map() });
    const [portalVersion, refreshPortals] = useReducer((count: number) => count + 1, 0);
    const portalFlushScheduledRef = useRef(false);

    // Rebuilt on every render: a value edited on the page (a check box bound to Group.Visible, say)
    // can reach the widget without the data source object changing, so memoising on the data source
    // missed it. The result keeps its identity while nothing in it changed, which is what the effects
    // below depend on.
    const { items, objects: itemObjects } = useStable(buildItems(props), built => built.items);
    const { groups, objects: groupObjects } = useStable(buildGroups(props), built => built.groups);
    const markers = useStable(buildMarkers(props), built => built);

    // Mendix reports `loading` while it refreshes a data source, handing out an empty list in the
    // meantime. Applying that would clear the timeline and flash it back a moment later, so
    // whatever is on screen is kept until real data arrives.
    const itemsSettled = isSettled(props.VisItemsDataSource);
    const groupsSettled = isSettled(props.VisGroupsDataSource);
    const markersSettled = isSettled(props.markersDataSource);

    if (itemsSettled) {
        objectsRef.current.items = itemObjects;
    }
    if (groupsSettled) {
        objectsRef.current.groups = groupObjects;
    }

    const itemsRef = useRef(items);
    itemsRef.current = items;

    const staticOptions = buildStaticOptions(props);
    const staticOptionsRef = useRef(staticOptions);
    staticOptionsRef.current = staticOptions;
    const optionsSignature = JSON.stringify(staticOptions);

    const schedulePortalFlush = useCallback(() => {
        if (portalFlushScheduledRef.current) {
            return;
        }
        portalFlushScheduledRef.current = true;
        queueMicrotask(() => {
            portalFlushScheduledRef.current = false;
            refreshPortals();
        });
    }, []);

    // vis-timeline owns the DOM of an item, so Mendix widgets are rendered into a container element
    // that is handed to vis as the template result and filled through a React portal.
    const templateContainer = useCallback(
        (kind: TemplateKind, objectId: VisId): HTMLElement => {
            const key = `${kind}:${objectId}`;
            const existing = containersRef.current.get(key);
            if (existing) {
                return existing.element;
            }
            const element = document.createElement("div");
            element.className = `vis-timeline-widget-template vis-timeline-widget-template--${kind}`;
            containersRef.current.set(key, { kind, objectId, element });
            schedulePortalFlush();
            return element;
        },
        [schedulePortalFlush]
    );

    const dropContainers = useCallback(
        (kinds: TemplateKind[], objectIds: readonly VisId[]) => {
            let dropped = false;
            for (const objectId of objectIds) {
                for (const kind of kinds) {
                    dropped = containersRef.current.delete(`${kind}:${objectId}`) || dropped;
                }
            }
            if (dropped) {
                schedulePortalFlush();
            }
        },
        [schedulePortalFlush]
    );

    const resolveItem = useCallback((id: VisId | undefined): ObjectItem | undefined => {
        return id === undefined ? undefined : objectsRef.current.items.get(id);
    }, []);

    const animation = useCallback(
        (): TimelineAnimationOptions =>
            propsRef.current.animateChanges
                ? {
                      animation: {
                          duration: propsRef.current.animationDuration,
                          easingFunction: propsRef.current.animationEasing
                      }
                  }
                : { animation: false },
        []
    );

    const fitToItems = useCallback((animationOptions: TimelineAnimationOptions) => {
        const timeline = timelineRef.current;
        if (!timeline) {
            return;
        }
        fitWithFallback(timeline, itemsRef.current, animationOptions, error => {
            // Expected whenever items live in a collapsed nested group, so it is only worth saying
            // once - the fallback still lands the window on the data.
            if (!warnedAboutFitRef.current) {
                warnedAboutFitRef.current = true;
                console.warn("VisTimeline: vis-timeline could not measure the items, using the data range.", error);
            }
        });
    }, []);

    // Used instead of vis-timeline's focus(), which throws for box and point items (see focusWindow).
    const focusItems = useCallback((ids: VisId[], animationOptions: TimelineAnimationOptions) => {
        const timeline = timelineRef.current;
        const target = timeline && focusWindow(itemsRef.current, ids, timeline.getWindow());
        if (timeline && target) {
            timeline.setWindow(target.start, target.end, animationOptions);
        }
    }, []);

    const functionOptions = useMemo(
        () => buildFunctionOptions(propsRef, templateContainer, resolveItem),
        [templateContainer, resolveItem]
    );

    // The timeline is created once. Options, data, markers, window and selection are pushed in by
    // the effects below, so nothing forces a rebuild of the whole widget.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        let timeline: Timeline;
        try {
            timeline = new Timeline(
                container,
                itemsDataSetRef.current as unknown as DataItemCollectionType,
                mergeOptions(staticOptionsRef.current, functionOptions)
            );
        } catch (error) {
            // Almost always a bad value in "Extra options (JSON)"; without this the whole page dies.
            console.error("VisTimeline: the timeline could not be created, check its options.", error);
            return;
        }
        timelineRef.current = timeline;
        registerEvents(timeline, propsRef, appliedSelectionRef, resolveItem);
        container.addEventListener("pointerup", placeCaretInMarkerLabel, true);

        // Custom time bars live on the timeline instance rather than in a data set, so they have to
        // be re-applied against a clean slate when the timeline is recreated.
        const appliedMarkers = appliedMarkersRef.current;

        return () => {
            timelineRef.current = null;
            groupsAttachedRef.current = false;
            hasFittedRef.current = false;
            appliedMarkers.clear();
            container.removeEventListener("pointerup", placeCaretInMarkerLabel, true);
            timeline.destroy();
        };
    }, [functionOptions, resolveItem]);

    useEffect(() => {
        const isFirstRun = appliedOptionsRef.current === undefined;
        appliedOptionsRef.current = optionsSignature;
        // The timeline was constructed with these options already; pushing them again would only
        // cost an extra redraw before the widget has even been laid out.
        if (!isFirstRun) {
            applyOptions(timelineRef.current, mergeOptions(staticOptionsRef.current, functionOptions));
        }
        // staticOptionsRef always holds the newest options; optionsSignature says when they changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [optionsSignature, functionOptions]);

    // Groups are synced before items so an item never refers to a group that does not exist yet.
    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline) {
            return;
        }
        const removed = syncWhenSettled(
            propsRef.current.VisGroupsDataSource,
            groupsDataSetRef.current,
            groups,
            groupSignaturesRef.current
        );
        if (!removed) {
            return;
        }
        dropContainers(["group"], removed);

        const hasGroups = groups.length > 0;
        // vis-timeline only applies subgroup visibility when it lays the groups out from scratch, so a
        // change to it re-attaches the groups, the way the vis-timeline example does.
        const subgroupVisibility = JSON.stringify(groups.map(group => [group.id, group.subgroupVisibility]));
        const visibilityChanged =
            groupsAttachedRef.current && subgroupVisibility !== appliedSubgroupVisibilityRef.current;
        appliedSubgroupVisibilityRef.current = subgroupVisibility;
        if (hasGroups !== groupsAttachedRef.current || (hasGroups && visibilityChanged)) {
            groupsAttachedRef.current = hasGroups;
            timeline.setGroups(
                hasGroups ? (groupsDataSetRef.current as unknown as DataGroupCollectionType) : undefined
            );
        }
    }, [groups, groupsSettled, dropContainers]);

    const windowStart = props.windowStart?.value;
    const windowEnd = props.windowEnd?.value;
    const fitOnDataChange = props.fitOnDataChange;

    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline) {
            return;
        }
        const removed = syncWhenSettled(
            propsRef.current.VisItemsDataSource,
            itemsDataSetRef.current,
            items,
            itemSignaturesRef.current
        );
        if (!removed) {
            return;
        }
        dropContainers(["item", "frame", "tooltip"], removed);

        const hasExplicitWindow = windowStart !== undefined && windowEnd !== undefined;
        const shouldFit =
            items.length > 0 &&
            !hasExplicitWindow &&
            (fitOnDataChange === "always" || (fitOnDataChange === "firstLoad" && !hasFittedRef.current));
        if (!shouldFit) {
            return;
        }
        // The very first fit lands the window on the data; animating that from wherever the
        // timeline happened to open just makes the page look like it is still loading.
        const fitAnimation: TimelineAnimationOptions = hasFittedRef.current ? animation() : { animation: false };
        hasFittedRef.current = true;
        // fit() derives the window from the rendered width of the items, so it has to wait until
        // the timeline has been laid out. Fitting straight after a data change - which is what the
        // previous version did - produces a window that is orders of magnitude too wide.
        cancelAnimationFrame(pendingFitRef.current);
        pendingFitRef.current = requestAnimationFrame(() => fitToItems(fitAnimation));
    }, [items, itemsSettled, dropContainers, animation, fitToItems, fitOnDataChange, windowStart, windowEnd]);

    useEffect(() => () => cancelAnimationFrame(pendingFitRef.current), []);

    useEffect(registerDragSources, []);

    useEffect(() => {
        const timeline = timelineRef.current;
        if (timeline && markersSettled) {
            syncMarkers(timeline, markers, appliedMarkersRef.current);
        }
    }, [markers, markersSettled]);

    const currentTime = props.currentTime?.value;
    useEffect(() => {
        if (currentTime) {
            timelineRef.current?.setCurrentTime(currentTime);
        }
    }, [currentTime]);

    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline || (windowStart === undefined && windowEnd === undefined)) {
            return;
        }
        // vis-timeline leaves a bound untouched when null is passed, which is what makes it possible
        // to drive only one side of the window from Mendix.
        timeline.setWindow(
            (windowStart ?? null) as unknown as Date,
            (windowEnd ?? null) as unknown as Date,
            animation()
        );
    }, [windowStart, windowEnd, animation]);

    // The selection can be driven either by the Mendix selection property, which deals in objects,
    // or by the comma separated attribute that came first. The selection property wins when both
    // are configured, because it is the one the rest of the page can see.
    const selectionFromMendix = useMemo<VisId[] | undefined>(() => {
        const selection = props.itemSelection;
        if (selection) {
            const byObjectId = new Map<string, VisId>();
            itemObjects.forEach((object, visId) => byObjectId.set(object.id, visId));
            return readSelection(selection)
                .map(object => byObjectId.get(object.id))
                .filter(isVisId);
        }
        if (props.selectedItemIds?.status === "available") {
            return splitIds(props.selectedItemIds.value);
        }
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.itemSelection, props.selectedItemIds, itemObjects]);

    const selectionRef = useRef(selectionFromMendix);
    selectionRef.current = selectionFromMendix;
    // Only a real change of the wanted selection should reach the timeline; the props objects
    // around it are rebuilt on every render.
    const selectionKey = selectionFromMendix === undefined ? undefined : selectionFromMendix.join("\u0000");
    const focusOnSelection = props.focusOnSelection;

    useEffect(() => {
        const timeline = timelineRef.current;
        const wanted = selectionRef.current;
        if (!timeline || wanted === undefined || sameIds(sorted(wanted), sorted(appliedSelectionRef.current))) {
            return;
        }
        appliedSelectionRef.current = wanted;
        timeline.setSelection(wanted);
        if (focusOnSelection && wanted.length > 0) {
            focusItems(wanted, animation());
        }
    }, [selectionKey, focusOnSelection, animation, focusItems]);

    const command = props.commandAttribute?.value;
    useEffect(() => {
        if (!command) {
            // Clearing the attribute is what makes the same command usable twice in a row.
            lastCommandRef.current = undefined;
            return;
        }
        const timeline = timelineRef.current;
        const attribute = propsRef.current.commandAttribute;
        if (!timeline || attribute?.status !== "available" || command === lastCommandRef.current) {
            return;
        }
        lastCommandRef.current = command;
        try {
            runCommand(timeline, command, animation(), fitToItems, focusItems);
        } catch (error) {
            console.warn(`VisTimeline: command '${command}' failed.`, error);
        }
        if (!attribute.readOnly) {
            attribute.setValue("");
        }
    }, [command, animation, fitToItems, focusItems]);

    // A template is filled by React one microtask after vis-timeline asked for it, so the timeline
    // has to measure the items again once the widgets inside them have actually rendered.
    useEffect(() => {
        if (portalVersion > 0) {
            timelineRef.current?.redraw();
        }
    }, [portalVersion]);

    const loading =
        props.VisItemsDataSource.status === "loading" ||
        props.VisGroupsDataSource?.status === "loading" ||
        props.markersDataSource?.status === "loading";

    return (
        <div
            className={classNames("vis-timeline-widget", props.class, { "vis-timeline-widget--loading": loading })}
            style={props.style}
            tabIndex={props.tabIndex}
        >
            <div className="vis-timeline-widget__canvas" ref={containerRef} />
            {loading && props.showLoadingOverlay && (
                <div className="vis-timeline-widget__overlay">
                    <div className="vis-timeline-widget__spinner" />
                </div>
            )}
            {renderPortals(containersRef.current, objectsRef.current, props)}
        </div>
    );
}

/**
 * vis-timeline only accepts a drop that carries the item as JSON in the drag data, which a Mendix
 * page cannot set. Any element with a data-vis-timeline-item attribute (and draggable="true") is
 * therefore made a drag source here: its attribute value, for example {"content":"New item"}, is
 * handed over as the drag data. One listener serves every timeline on the page.
 */
const DRAG_SOURCE_ATTRIBUTE = "data-vis-timeline-item";
let dragSourceUsers = 0;

function onDragStart(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const json = target?.closest(`[${DRAG_SOURCE_ATTRIBUTE}]`)?.getAttribute(DRAG_SOURCE_ATTRIBUTE);
    if (json && event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text", json);
    }
}

function registerDragSources(): () => void {
    if (dragSourceUsers++ === 0) {
        document.addEventListener("dragstart", onDragStart);
    }
    return () => {
        if (--dragSourceUsers === 0) {
            document.removeEventListener("dragstart", onDragStart);
        }
    };
}

/**
 * vis-timeline focuses an editable marker label on pointerdown, but the drag handling on the time
 * bar keeps the browser from placing the caret, so typing always started at the beginning of the
 * label. The caret is put where the user clicked instead, unless they selected a piece of text.
 */
function placeCaretInMarkerLabel(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const label = target?.closest('.vis-custom-time-marker[contenteditable="true"]');
    const selection = window.getSelection();
    if (!label || !selection || (!selection.isCollapsed && label.contains(selection.anchorNode))) {
        return;
    }
    const caret = caretRangeAt(event.clientX, event.clientY);
    if (caret && label.contains(caret.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(caret);
    }
}

type CaretDocument = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretRangeAt(x: number, y: number): Range | null {
    const doc = document as CaretDocument;
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
    }
    return doc.caretRangeFromPoint?.(x, y) ?? null;
}

/** Returns the previous value for as long as its content, as JSON, is the same. */
function useStable<T>(value: T, content: (value: T) => unknown): T {
    const key = JSON.stringify(content(value));
    const ref = useRef<{ key: string; value: T } | undefined>(undefined);
    if (!ref.current || ref.current.key !== key) {
        ref.current = { key, value };
    }
    return ref.current.value;
}

function sorted(ids: readonly VisId[]): VisId[] {
    return [...ids].sort();
}

/** Portal content is derived from the live props on every render, while the container elements are
 *  owned by vis-timeline. That split is what keeps a Mendix widget inside an item up to date
 *  without forcing the timeline to redraw. */
function renderPortals(
    containers: Map<string, TemplateContainer>,
    objects: ObjectLookup,
    props: VisTimelineContainerProps
): ReactNode[] {
    const portals: ReactNode[] = [];
    containers.forEach((container, key) => {
        const object =
            container.kind === "group" ? objects.groups.get(container.objectId) : objects.items.get(container.objectId);
        if (object) {
            portals.push(createPortal(renderTemplate(container.kind, object, props), container.element, key));
        }
    });
    return portals;
}

function renderTemplate(kind: TemplateKind, object: ObjectItem, props: VisTimelineContainerProps): ReactNode {
    switch (kind) {
        case "group":
            return props.groupContentWidgets?.get(object);
        case "item":
            return props.itemContentWidgets?.get(object);
        case "frame":
            return props.itemVisibleFrameWidgets?.get(object);
        case "tooltip":
            return props.itemTooltipWidgets?.get(object);
    }
}

/** vis-timeline rejects an option it does not understand by throwing, and these options can come
 *  from a JSON expression a modeller typed, so a mistake there must not take the page down. */
function applyOptions(timeline: Timeline | null, options: TimelineOptions): void {
    try {
        timeline?.setOptions(options);
    } catch (error) {
        console.error("VisTimeline: the timeline rejected these options, check 'Extra options (JSON)'.", error);
    }
}

function mergeOptions(staticOptions: TimelineOptions, functionOptions: TimelineOptions): TimelineOptions {
    return {
        ...staticOptions,
        ...functionOptions,
        tooltip: { ...staticOptions.tooltip, ...functionOptions.tooltip }
    };
}

/**
 * The options that cannot be expressed as plain data: templates, snapping, the time zone and the
 * manipulation callbacks. They are built once and read the live props through `propsRef`.
 */
function buildFunctionOptions(
    propsRef: PropsRef,
    templateContainer: (kind: TemplateKind, objectId: VisId) => HTMLElement,
    resolveItem: ItemResolver
): TimelineOptions {
    const options: TimelineOptions = {
        template: (item?: any) =>
            propsRef.current.itemContentType === "custom" && item?.id != null
                ? templateContainer("item", String(item.id))
                : item?.content ?? "",
        groupTemplate: (group?: any) =>
            propsRef.current.groupContentType === "custom" && group?.id != null
                ? templateContainer("group", String(group.id))
                : group?.content,
        visibleFrameTemplate: (item?: any) =>
            propsRef.current.itemVisibleFrameWidgets && item?.id != null
                ? templateContainer("frame", String(item.id))
                : "",
        tooltip: {
            template: (item: any) =>
                propsRef.current.itemTooltipType === "custom" && item?.id != null
                    ? (templateContainer("tooltip", String(item.id)) as unknown as string)
                    : item?.title ?? ""
        },
        snap: (date: Date, scale: string, step: number) => {
            const { IsSnap, snapMinutes } = propsRef.current;
            if (!dynamicBoolean(IsSnap, true)) {
                return date;
            }
            if (snapMinutes > 0) {
                const interval = snapMinutes * MS_PER_MINUTE;
                return new Date(Math.round(date.valueOf() / interval) * interval);
            }
            return defaultSnap ? defaultSnap(date, scale, step) : date;
        },
        onInitialDrawComplete: () => fireAction(propsRef.current.onInitialDrawCompleteAction),
        onAdd: (item: any, callback: (item: any) => void) => {
            const props = propsRef.current;
            fireAction(props.onAddAction, {
                data: JSON.stringify(item),
                addedStart: toDate(item?.start),
                addedEnd: toDate(item?.end),
                addedGroupID: idToString(item?.group),
                addedContent: typeof item?.content === "string" ? item.content : undefined
            });
            callback(props.addMode === "addAndCallAction" ? item : null);
        },
        // vis-timeline expects the edited item back from onUpdate. A Mendix action cannot answer
        // synchronously, so the inline edit is always cancelled and the data source brings the new
        // values back in once the action has run.
        onUpdate: (item: any, callback: (item: any) => void) => {
            fireAction(propsRef.current.onUpdateAction, {
                data: JSON.stringify(item),
                updatedItemID: idToString(item?.id)
            });
            fireItemAction(propsRef.current.itemUpdateAction, resolveItem(idToString(item?.id)));
            callback(null);
        },
        onMove: (item: any, callback: (item: any) => void) => {
            const props = propsRef.current;
            fireAction(props.moveAction, {
                movedItemID: idToString(item?.id),
                movedStart: toDate(item?.start),
                movedEnd: toDate(item?.end),
                movedGroupID: idToString(item?.group)
            });
            fireItemAction(props.itemMoveAction, resolveItem(idToString(item?.id)), {
                newStart: toDate(item?.start),
                newEnd: toDate(item?.end),
                newGroupID: idToString(item?.group)
            });
            callback(props.moveMode === "moveAndCallAction" ? item : null);
        },
        onMoving: (item: any, callback: (item: any) => void) => {
            fireAction(propsRef.current.movingAction, {
                movingItemID: idToString(item?.id),
                movingStart: toDate(item?.start),
                movingEnd: toDate(item?.end),
                movingGroupID: idToString(item?.group)
            });
            callback(item);
        },
        onRemove: (item: any, callback: (item: any) => void) => {
            const props = propsRef.current;
            fireAction(props.onRemoveAction, {
                data: JSON.stringify(item),
                removedItemID: idToString(item?.id)
            });
            fireItemAction(props.itemRemoveAction, resolveItem(idToString(item?.id)));
            callback(props.removeMode === "removeAndCallAction" ? item : null);
        },
        onAddGroup: (group: any, callback: (group: any) => void) => {
            fireAction(propsRef.current.addGroupAction, { addedGroupJSON: JSON.stringify(group) });
            callback(group);
        },
        onMoveGroup: (group: any, callback: (group: any) => void) => {
            fireAction(propsRef.current.moveGroupAction, { movedGroupID: idToString(group?.id) });
            callback(group);
        },
        onRemoveGroup: (group: any, callback: (group: any) => void) => {
            const props = propsRef.current;
            fireAction(props.removeGroupAction, { removedGroupID: idToString(group?.id) });
            callback(props.removeMode === "removeAndCallAction" ? group : null);
        },
        // Dragging a group to another position only sticks when the values the groups are ordered
        // by are swapped as well. vis-timeline writes the two group objects it passes in back to
        // its data set right after this call, so the swap has to be made on those objects; updating
        // the data set here instead would be overwritten with the old values straight away.
        groupOrderSwap: (fromGroup: any, toGroup: any) => {
            const fromValue = fromGroup?.value;
            const toValue = toGroup?.value;
            fromGroup.value = toValue;
            toGroup.value = fromValue;
            fireAction(propsRef.current.groupOrderSwapAction, {
                swapGroupID: idToString(fromGroup?.id),
                swapGroupOrderValue: toBig(toValue),
                swapOtherGroupID: idToString(toGroup?.id),
                swapOtherGroupOrderValue: toBig(fromValue)
            });
        }
    };

    const momentFactory = visMoment;
    if (momentFactory) {
        // The bundled moment loads every vis-timeline locale, which leaves its global locale on the
        // last one registered (Ukrainian). Axis labels are formatted through this factory, so pin
        // each instance to the configured locale. vis-timeline calls the factory for every label
        // and position, so the locale is only resolved again when the property changes.
        let localeSource: string | undefined;
        let locale = resolveLocale(undefined);
        options.moment = ((date?: unknown) => {
            const offset = propsRef.current.timeZoneOffset?.value;
            const source = dynamicText(propsRef.current.locale);
            if (source !== localeSource) {
                localeSource = source;
                locale = resolveLocale(source);
            }
            const moment = momentFactory(date).locale(locale);
            return offset ? moment.utcOffset(offset) : moment;
        }) as unknown as TimelineOptions["moment"];
    }

    return options;
}

function registerEvents(
    timeline: Timeline,
    propsRef: PropsRef,
    appliedSelectionRef: { current: VisId[] },
    resolveItem: ItemResolver
): void {
    // Editable items emit a second, reduced `click` and `doubleClick` payload that has no `what`
    // key. Ignoring those is what keeps a microflow from running twice on a single click.
    const isPrimary = (properties: any): boolean => properties != null && "what" in properties;

    timeline.on("click", properties => {
        const props = propsRef.current;
        if (!isPrimary(properties)) {
            return;
        }
        if (inScope(props.clickScope, properties)) {
            fireAction(props.clickAction, {
                clickedItemID: idToString(properties.item),
                clickedGroupID: idToString(properties.group),
                clickedTime: toDate(properties.time),
                clickedWhat: properties.what ?? undefined,
                clickedMarkerID: idToString(properties.customTime)
            });
        }
        fireItemAction(props.itemClickAction, resolveItem(idToString(properties.item)));
    });

    timeline.on("doubleClick", properties => {
        const props = propsRef.current;
        if (!isPrimary(properties)) {
            return;
        }
        if (inScope(props.doubleClickScope, properties)) {
            fireAction(props.doubleClickAction, {
                doubleClickedItemID: idToString(properties.item),
                doubleClickedGroupID: idToString(properties.group),
                doubleClickedTime: toDate(properties.time),
                doubleClickedWhat: properties.what ?? undefined,
                doubleClickedMarkerID: idToString(properties.customTime)
            });
        }
        fireItemAction(props.itemDoubleClickAction, resolveItem(idToString(properties.item)));
    });

    timeline.on("contextmenu", properties => {
        const props = propsRef.current;
        const object = resolveItem(idToString(properties?.item));
        const widgetLevel = !!props.contextMenuAction && inScope(props.contextMenuScope, properties);
        const itemLevel = !!props.itemContextMenuAction && !!object;
        if (!widgetLevel && !itemLevel) {
            return;
        }
        // Only take the browser menu away where the widget actually answers the right click.
        properties?.event?.preventDefault?.();
        if (widgetLevel) {
            fireAction(props.contextMenuAction, {
                contextItemID: idToString(properties.item),
                contextGroupID: idToString(properties.group),
                contextTime: toDate(properties.time),
                contextWhat: properties.what ?? undefined
            });
        }
        fireItemAction(props.itemContextMenuAction, object);
    });

    timeline.on("itemover", properties =>
        fireAction(propsRef.current.itemOverAction, { hoveredItemID: idToString(properties?.item) })
    );
    timeline.on("itemout", properties =>
        fireAction(propsRef.current.itemOutAction, { unhoveredItemID: idToString(properties?.item) })
    );
    timeline.on("groupDragged", properties =>
        fireAction(propsRef.current.groupDraggedAction, { draggedGroupID: idToString(properties?.groupId) })
    );

    timeline.on("drop", properties => {
        let data: string | undefined;
        try {
            data = properties?.event?.dataTransfer?.getData("text") || undefined;
        } catch {
            data = undefined;
        }
        fireAction(propsRef.current.dropAction, {
            droppedData: data,
            droppedTime: toDate(properties?.time),
            droppedGroupID: idToString(properties?.group)
        });
    });

    timeline.on("select", properties => {
        const props = propsRef.current;
        const ids: VisId[] = (properties?.items ?? []).map((id: unknown) => String(id));
        appliedSelectionRef.current = ids;
        const joined = ids.join(",");

        const attribute = props.selectedItemIds;
        if (attribute && attribute.status === "available" && !attribute.readOnly && attribute.value !== joined) {
            attribute.setValue(joined);
        }
        writeSelection(props.itemSelection, ids.map(resolveItem).filter(isObjectItem));
        fireAction(props.selectAction, { selectedItemIDs: joined });
    });

    timeline.on("rangechanged", properties =>
        fireAction(propsRef.current.rangeChangedAction, {
            rangeStart: toDate(properties?.start),
            rangeEnd: toDate(properties?.end),
            rangeByUser: properties?.byUser === true
        })
    );

    // vis-timeline has no event for "what is in view changed", so it is worked out after every window
    // change, scroll and redraw. Only an actual change reaches Mendix, which also keeps a microflow that
    // changes the page from triggering itself again.
    let lastInView = "";
    let inViewTimer: number | undefined;
    const reportInView = (): void => {
        window.clearTimeout(inViewTimer);
        inViewTimer = window.setTimeout(() => {
            const action = propsRef.current.visibleChangedAction;
            if (!action) {
                return;
            }
            const itemIds = timeline.getVisibleItems().map(String).join(",");
            const groupIds = (
                (timeline as unknown as { getVisibleGroups?: () => unknown[] }).getVisibleGroups?.() ?? []
            )
                .map(String)
                .join(",");
            if (itemIds + "|" + groupIds === lastInView) {
                return;
            }
            lastInView = itemIds + "|" + groupIds;
            fireAction(action, { visibleItemIDs: itemIds, visibleGroupIDs: groupIds });
        }, 250);
    };
    timeline.on("rangechanged", reportInView);
    timeline.on("scrollSide", reportInView);
    timeline.on("changed", reportInView);

    timeline.on("timechange", properties =>
        fireAction(propsRef.current.markerChangeAction, {
            movingMarkerID: idToString(properties?.id),
            movingMarkerTime: toDate(properties?.time)
        })
    );
    // vis-timeline hands the label over as HTML; Mendix gets the text the user actually typed.
    timeline.on("markerchange", properties =>
        fireAction(propsRef.current.markerLabelChangingAction, {
            changingMarkerID: idToString(properties?.id),
            changingMarkerLabel: htmlToText(properties?.title)
        })
    );
    timeline.on("markerchanged", properties =>
        fireAction(propsRef.current.markerLabelChangedAction, {
            changedMarkerID: idToString(properties?.id),
            changedMarkerLabel: htmlToText(properties?.title)
        })
    );

    timeline.on("timechanged", properties =>
        fireAction(propsRef.current.markerChangedAction, {
            movedMarkerID: idToString(properties?.id),
            movedMarkerTime: toDate(properties?.time)
        })
    );
}

function htmlToText(html: unknown): string {
    if (typeof html !== "string") {
        return "";
    }
    // DOMParser builds an inert document, so markup typed into the label never runs.
    const parsed = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n"), "text/html");
    return (parsed.body.textContent ?? "").trim();
}

function isObjectItem(object: ObjectItem | undefined): object is ObjectItem {
    return object !== undefined;
}

function isVisId(id: VisId | undefined): id is VisId {
    return id !== undefined;
}

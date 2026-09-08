import { ReactElement, ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";
import { Big } from "big.js";
import { ActionValue, ObjectItem } from "mendix";
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
import { buildGroups, buildItems, buildMarkers, itemsRange, VisGroup, VisItem, VisMarker } from "../utils/data";
import { syncDataSet, syncMarkers } from "../utils/sync";
import { buildStaticOptions } from "../utils/options";
import { runCommand } from "../utils/commands";
import { defaultSnap, visMoment } from "../utils/vis";
import { dynamicBoolean, sameIds, splitIds, toDate, VisId } from "../utils/values";

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

    const { items, objects: itemObjects } = useMemo(
        () => buildItems(props),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [props.VisItemsDataSource, props.itemContentType, props.itemTooltipType, props.editableOverrideItems]
    );
    const { groups, objects: groupObjects } = useMemo(
        () => buildGroups(props),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [props.VisGroupsDataSource, props.subgroupsDataSource, props.groupContentType]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const markers = useMemo(() => buildMarkers(props), [props.markersDataSource]);

    // Mendix reports `loading` while it refreshes a data source, handing out an empty list in the
    // meantime. Applying that would clear the timeline and flash it back a moment later, so
    // whatever is on screen is kept until real data arrives.
    const itemsSettled = props.VisItemsDataSource.status !== "loading";
    const groupsSettled = props.VisGroupsDataSource?.status !== "loading";
    const markersSettled = props.markersDataSource?.status !== "loading";

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

    // vis-timeline's own fit() measures the rendered width of every item and throws for items that
    // sit in a collapsed nested group, which would leave the window stranded wherever it started.
    // Its result is the nicer one, so it is tried first and the data range is the safety net.
    const fitToItems = useCallback((animationOptions: TimelineAnimationOptions) => {
        const timeline = timelineRef.current;
        if (!timeline) {
            return;
        }
        try {
            timeline.redraw();
            timeline.fit(animationOptions);
            return;
        } catch (error) {
            // Expected whenever items live in a collapsed nested group, so it is only worth saying
            // once - the fallback below still lands the window on the data.
            if (!warnedAboutFitRef.current) {
                warnedAboutFitRef.current = true;
                console.warn("VisTimeline: vis-timeline could not measure the items, using the data range.", error);
            }
        }
        const range = itemsRange(itemsRef.current);
        if (range) {
            timeline.setWindow(range.start, range.end, animationOptions);
        }
    }, []);

    const functionOptions = useMemo(() => buildFunctionOptions(propsRef, templateContainer), [templateContainer]);

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
        registerEvents(timeline, propsRef, appliedSelectionRef);

        // Custom time bars live on the timeline instance rather than in a data set, so they have to
        // be re-applied against a clean slate when the timeline is recreated.
        const appliedMarkers = appliedMarkersRef.current;

        return () => {
            timelineRef.current = null;
            groupsAttachedRef.current = false;
            hasFittedRef.current = false;
            appliedMarkers.clear();
            timeline.destroy();
        };
    }, [functionOptions]);

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
        if (!groupsSettled) {
            return;
        }
        const removed = syncDataSet(groupsDataSetRef.current, groups, groupSignaturesRef.current);
        dropContainers(["group"], removed);

        const hasGroups = groups.length > 0;
        if (hasGroups !== groupsAttachedRef.current) {
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
        if (!itemsSettled) {
            return;
        }
        const removed = syncDataSet(itemsDataSetRef.current, items, itemSignaturesRef.current);
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

    const selectedItemIds = props.selectedItemIds?.value;
    const selectionStatus = props.selectedItemIds?.status;
    const focusOnSelection = props.focusOnSelection;
    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline || selectionStatus !== "available") {
            return;
        }
        const wanted = splitIds(selectedItemIds);
        if (sameIds(sorted(wanted), sorted(appliedSelectionRef.current))) {
            return;
        }
        appliedSelectionRef.current = wanted;
        timeline.setSelection(wanted);
        if (focusOnSelection && wanted.length > 0) {
            timeline.focus(wanted, animation());
        }
    }, [selectedItemIds, selectionStatus, focusOnSelection, animation]);

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
            runCommand(timeline, command, animation(), fitToItems);
        } catch (error) {
            console.warn(`VisTimeline: command '${command}' failed.`, error);
        }
        if (!attribute.readOnly) {
            attribute.setValue("");
        }
    }, [command, animation, fitToItems]);

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
    templateContainer: (kind: TemplateKind, objectId: VisId) => HTMLElement
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
                addedGroupID: idToString(item?.group)
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
        // by are swapped as well.
        groupOrderSwap: (fromGroup: any, toGroup: any, groups: any) => {
            const fromValue = fromGroup?.value;
            const toValue = toGroup?.value;
            groups.update([
                { id: fromGroup.id, value: toValue },
                { id: toGroup.id, value: fromValue }
            ]);
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
        options.moment = ((date?: unknown) => {
            const offset = propsRef.current.timeZoneOffset?.value;
            const moment = momentFactory(date);
            return offset ? moment.utcOffset(offset) : moment;
        }) as unknown as TimelineOptions["moment"];
    }

    return options;
}

function registerEvents(timeline: Timeline, propsRef: PropsRef, appliedSelectionRef: { current: VisId[] }): void {
    // Editable items emit a second, reduced `click` and `doubleClick` payload that has no `what`
    // key. Ignoring those is what keeps a microflow from running twice on a single click.
    const isPrimary = (properties: any): boolean => properties != null && "what" in properties;

    // Clicking the background, the time axis or a group label is still a click as far as
    // vis-timeline is concerned. Reporting those to an action that expects an item id is what the
    // scope settings guard against.
    const inScope = (scope: "item" | "anywhere", properties: any): boolean =>
        scope === "anywhere" || properties?.item != null;

    timeline.on("click", properties => {
        const props = propsRef.current;
        if (isPrimary(properties) && inScope(props.clickScope, properties)) {
            fireAction(props.clickAction, {
                clickedItemID: idToString(properties.item),
                clickedGroupID: idToString(properties.group),
                clickedTime: toDate(properties.time),
                clickedWhat: properties.what ?? undefined
            });
        }
    });

    timeline.on("doubleClick", properties => {
        const props = propsRef.current;
        if (isPrimary(properties) && inScope(props.doubleClickScope, properties)) {
            fireAction(props.doubleClickAction, {
                doubleClickedItemID: idToString(properties.item),
                doubleClickedGroupID: idToString(properties.group),
                doubleClickedTime: toDate(properties.time),
                doubleClickedWhat: properties.what ?? undefined
            });
        }
    });

    timeline.on("contextmenu", properties => {
        const props = propsRef.current;
        if (!props.contextMenuAction || !inScope(props.contextMenuScope, properties)) {
            return;
        }
        // Only take the browser menu away where the widget actually answers the right click.
        properties?.event?.preventDefault?.();
        fireAction(props.contextMenuAction, {
            contextItemID: idToString(properties.item),
            contextGroupID: idToString(properties.group),
            contextTime: toDate(properties.time),
            contextWhat: properties.what ?? undefined
        });
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
        fireAction(props.selectAction, { selectedItemIDs: joined });
    });

    timeline.on("rangechanged", properties =>
        fireAction(propsRef.current.rangeChangedAction, {
            rangeStart: toDate(properties?.start),
            rangeEnd: toDate(properties?.end),
            rangeByUser: properties?.byUser === true
        })
    );

    timeline.on("timechange", properties =>
        fireAction(propsRef.current.markerChangeAction, {
            movingMarkerID: idToString(properties?.id),
            movingMarkerTime: toDate(properties?.time)
        })
    );
    timeline.on("timechanged", properties =>
        fireAction(propsRef.current.markerChangedAction, {
            movedMarkerID: idToString(properties?.id),
            movedMarkerTime: toDate(properties?.time)
        })
    );
}

function fireAction(action: ActionValue<any> | undefined, args?: Record<string, unknown>): void {
    if (!action || !action.canExecute || action.isExecuting) {
        return;
    }
    (action.execute as (a?: Record<string, unknown>) => void)(args);
}

function idToString(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
}

function toBig(value: unknown): Big | undefined {
    if (typeof value !== "number" && typeof value !== "string") {
        return undefined;
    }
    try {
        return new Big(value);
    } catch {
        return undefined;
    }
}

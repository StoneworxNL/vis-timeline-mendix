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
import { forgetLocalEdits, syncMarkers } from "../utils/sync";
import { fitWithFallback, inScope, isSettled, syncWhenSettled } from "../utils/guards";
import { createInViewReporter } from "../utils/inView";
import { createLocalEditSettler } from "../utils/localEdits";
import { registerDragSources } from "../utils/dragSources";
import {
    addActionArgs,
    awaitsConfirmation,
    createWidgetActions,
    fireAction,
    idToString,
    isAnyRunning,
    toBig,
    wantedSelection,
    WidgetActions,
    writeSelection
} from "../utils/actions";
import { buildStaticOptions, optionsSignature, withClearedOptions } from "../utils/options";
import { runCommand, stopRolling } from "../utils/commands";
import { defaultSnap, resolveLocale, snapToMinutes, visMoment } from "../utils/vis";
import { dynamicBoolean, dynamicText, sameIds, toDate, VisId } from "../utils/values";

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

/** How long to wait after an edit action finished for Mendix to send the changed data. */
const LOCAL_EDIT_SETTLE_MS = 1000;

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
    // Items the user moved, removed or added on the timeline that Mendix has not confirmed yet.
    const localEditsRef = useRef(new Set<VisId>());
    const editActionRunningRef = useRef(false);
    const settleLocalEditsRef = useRef<() => void>(() => undefined);
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
    const appliedStaticOptionsRef = useRef<TimelineOptions | undefined>(undefined);

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
    // Subgroup visibility is folded into the groups, so while its data source refreshes the groups
    // are not settled either; applying them would show every hidden subgroup for a moment.
    const groupsSettled = isSettled(props.VisGroupsDataSource) && isSettled(props.subgroupsDataSource);
    const markersSettled = isSettled(props.markersDataSource);

    if (itemsSettled) {
        objectsRef.current.items = itemObjects;
    }
    if (groupsSettled) {
        objectsRef.current.groups = groupObjects;
    }

    // The items on screen: while the data source refreshes, that is still the last list Mendix sent,
    // so a fit or a focus command arriving in the meantime has something to work with.
    const itemsRef = useRef(items);
    if (itemsSettled) {
        itemsRef.current = items;
    }

    const staticOptions = buildStaticOptions(props);
    const staticOptionsRef = useRef(staticOptions);
    staticOptionsRef.current = staticOptions;
    const signature = optionsSignature(props, staticOptions);

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

    const actions = useMemo(() => createWidgetActions(() => propsRef.current, resolveItem), [resolveItem]);
    // Mendix reports that a run finished by rendering the widget again, which is when the next
    // queued run can start.
    useEffect(() => actions.flush());
    useEffect(() => () => actions.dispose(), [actions]);

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
    // Like focus(), it leaves rolling mode first, or the next rolling step would scroll away again.
    const focusItems = useCallback((ids: VisId[], animationOptions: TimelineAnimationOptions) => {
        const timeline = timelineRef.current;
        const target = timeline && focusWindow(itemsRef.current, ids, timeline.getWindow());
        if (timeline && target) {
            stopRolling(timeline);
            timeline.setWindow(target.start, target.end, animationOptions);
        }
    }, []);

    // A refused edit leaves the Mendix data as it was, so no new data arrives to put the item back.
    // Each edit starts a wait; once no edit action is busy, Mendix gets a moment to send what it
    // changed, and whatever is still unconfirmed after that goes back to what Mendix has.
    const localEdits = useMemo(
        () =>
            createLocalEditSettler(
                localEditsRef.current,
                () => editActionRunningRef.current || actions.editsPending(),
                () => settleLocalEditsRef.current(),
                LOCAL_EDIT_SETTLE_MS
            ),
        [actions]
    );
    const markLocalEdit = useCallback((id: unknown) => localEdits.mark(id), [localEdits]);

    const functionOptions = useMemo(
        () => buildFunctionOptions(propsRef, templateContainer, actions, markLocalEdit),
        [templateContainer, actions, markLocalEdit]
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
        const disposeEvents = registerEvents(timeline, propsRef, appliedSelectionRef, resolveItem, actions);
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
            // A pending "in view" report would otherwise ask the destroyed timeline and run the
            // action after the user has left the page.
            disposeEvents();
            timeline.destroy();
        };
    }, [functionOptions, resolveItem, actions]);

    useEffect(() => {
        const isFirstRun = appliedOptionsRef.current === undefined;
        appliedOptionsRef.current = signature;
        const { options, applied } = withClearedOptions(
            propsRef.current,
            appliedStaticOptionsRef.current,
            staticOptionsRef.current
        );
        appliedStaticOptionsRef.current = applied;
        // The timeline was constructed with these options already; pushing them again would only
        // cost an extra redraw before the widget has even been laid out.
        if (!isFirstRun) {
            applyOptions(timelineRef.current, mergeOptions(options, functionOptions));
        }
        // staticOptionsRef always holds the newest options; the signature says when they changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature, functionOptions]);

    // Groups are synced before items so an item never refers to a group that does not exist yet.
    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline) {
            return;
        }
        const removed = syncWhenSettled(
            { status: groupsSettled ? "available" : "loading" },
            groupsDataSetRef.current,
            groups,
            groupSignaturesRef.current
        );
        if (!removed) {
            return;
        }
        dropContainers(["group"], removed);

        const hasGroups = groups.length > 0;
        const subgroupVisibility = JSON.stringify(groups.map(group => [group.id, group.subgroupVisibility]));
        const visibilityChanged =
            groupsAttachedRef.current && subgroupVisibility !== appliedSubgroupVisibilityRef.current;
        appliedSubgroupVisibilityRef.current = subgroupVisibility;
        if (hasGroups !== groupsAttachedRef.current) {
            groupsAttachedRef.current = hasGroups;
            timeline.setGroups(
                hasGroups ? (groupsDataSetRef.current as unknown as DataGroupCollectionType) : undefined
            );
        } else if (hasGroups && visibilityChanged) {
            applySubgroupVisibility(timeline, groups);
        }
    }, [groups, groupsSettled, dropContainers]);

    const windowStart = props.windowStart?.value;
    const windowEnd = props.windowEnd?.value;
    const fitOnDataChange = props.fitOnDataChange;

    const editActionRunning =
        actions.editsPending() ||
        isAnyRunning(
            [props.moveAction, props.onRemoveAction, props.onAddAction],
            [props.itemMoveAction, props.itemRemoveAction],
            Array.from(localEditsRef.current, id => resolveItem(id)).filter(isObjectItem)
        );
    editActionRunningRef.current = editActionRunning;

    const syncItems = useCallback((): VisId[] | undefined => {
        // Once the edit actions are done, whatever Mendix has wins over what the user dropped.
        const running = editActionRunningRef.current || actions.editsPending();
        if (!running && forgetLocalEdits(localEditsRef.current, itemSignaturesRef.current)) {
            localEdits.cancel();
        }
        return syncWhenSettled(
            propsRef.current.VisItemsDataSource,
            itemsDataSetRef.current,
            itemsRef.current,
            itemSignaturesRef.current
        );
    }, [actions, localEdits]);

    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline) {
            return;
        }
        const removed = syncItems();
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
        const isFirstFit = !hasFittedRef.current;
        const fitAnimation: TimelineAnimationOptions = isFirstFit ? { animation: false } : animation();
        hasFittedRef.current = true;
        // fit() derives the window from the rendered width of the items, so it has to wait until
        // the timeline has been laid out. Fitting straight after a data change - which is what the
        // previous version did - produces a window that is orders of magnitude too wide.
        cancelAnimationFrame(pendingFitRef.current);
        pendingFitRef.current = requestAnimationFrame(() => {
            fitToItems(fitAnimation);
            // The window and selection effects already ran in this commit, so the fit would
            // otherwise throw away a Window start or end set on its own, or the focus on a selection
            // the page opened with.
            const current = timelineRef.current;
            const { windowStart: start, windowEnd: end, focusOnSelection } = propsRef.current;
            if (!current) {
                return;
            }
            if (start?.value !== undefined || end?.value !== undefined) {
                current.setWindow(
                    (start?.value ?? null) as unknown as Date,
                    (end?.value ?? null) as unknown as Date,
                    fitAnimation
                );
            } else if (isFirstFit && focusOnSelection && appliedSelectionRef.current.length > 0) {
                focusItems(appliedSelectionRef.current, fitAnimation);
            }
        });
    }, [
        items,
        itemsSettled,
        syncItems,
        dropContainers,
        animation,
        fitToItems,
        focusItems,
        fitOnDataChange,
        windowStart,
        windowEnd
    ]);

    settleLocalEditsRef.current = () => {
        if (timelineRef.current) {
            const removed = syncItems();
            if (removed) {
                dropContainers(["item", "frame", "tooltip"], removed);
            }
        }
    };
    useEffect(() => localEdits.actionsChanged(editActionRunning), [localEdits, editActionRunning]);

    useEffect(
        () => () => {
            cancelAnimationFrame(pendingFitRef.current);
            localEdits.cancel();
        },
        [localEdits]
    );

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
    // are configured, because it is the one the rest of the page can see. The items kept on screen
    // while a data source refreshes are the ones matched against, so a refresh does not clear the
    // selection, and an id that arrives before its item is applied once the item is there.
    const selectionFromMendix = useMemo<VisId[] | undefined>(
        () => wantedSelection(props.itemSelection, props.selectedItemIds, objectsRef.current.items),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [props.itemSelection, props.selectedItemIds, itemObjects]
    );

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
            className={classNames("vis-timeline-widget", props.class, {
                "vis-timeline-widget--loading": loading && props.showLoadingOverlay
            })}
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

interface TimelineInternals {
    itemSet?: {
        groups?: Record<string, { subgroupVisibility?: Record<string, boolean> } | undefined>;
        markDirty?: (options: { restackGroups: boolean }) => void;
    };
}

/**
 * vis-timeline only hides the items of an invisible subgroup when it restacks a group, and an update
 * of a group's data merges the visibility into what it had without asking for one. Re-attaching all
 * groups does restack, but draws every item visible for a frame first. So the visibility of each
 * group is replaced as a whole (a subgroup that left the data source becomes visible again) and the
 * groups are restacked in place.
 */
function applySubgroupVisibility(timeline: Timeline, groups: VisGroup[]): void {
    const itemSet = (timeline as unknown as TimelineInternals).itemSet;
    for (const group of groups) {
        const target = itemSet?.groups?.[group.id];
        if (target) {
            target.subgroupVisibility = { ...group.subgroupVisibility };
        }
    }
    itemSet?.markDirty?.({ restackGroups: true });
    timeline.redraw();
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
    actions: WidgetActions,
    markLocalEdit: (id: unknown) => void
): TimelineOptions {
    const options: TimelineOptions = {
        template: (item?: any) =>
            propsRef.current.itemContentType === "custom" && item?.id != null
                ? templateContainer("item", String(item.id))
                : rawOrText(propsRef, item?.content ?? ""),
        groupTemplate: (group?: any) =>
            propsRef.current.groupContentType === "custom" && group?.id != null
                ? templateContainer("group", String(group.id))
                : typeof group?.content === "string"
                ? rawOrText(propsRef, group.content)
                : group?.content,
        visibleFrameTemplate: (item?: any) =>
            propsRef.current.itemVisibleFrameWidgets && item?.id != null
                ? templateContainer("frame", String(item.id))
                : "",
        tooltip: {
            template: (item: any) =>
                propsRef.current.itemTooltipType === "custom" && item?.id != null
                    ? (templateContainer("tooltip", String(item.id)) as unknown as string)
                    : (rawOrText(propsRef, item?.title ?? "") as string)
        },
        snap: (date: Date, scale: string, step: number) => {
            const { IsSnap, snapMinutes, timeZoneOffset } = propsRef.current;
            if (!dynamicBoolean(IsSnap, true)) {
                return date;
            }
            if (snapMinutes > 0) {
                return snapToMinutes(date, snapMinutes, timeZoneOffset?.value || undefined);
            }
            return defaultSnap ? defaultSnap(date, scale, step) : date;
        },
        onInitialDrawComplete: () => actions.fire("onInitialDrawCompleteAction"),
        onAdd: (item: any, callback: (item: any) => void) => {
            const props = propsRef.current;
            actions.run("onAddAction", addActionArgs(item));
            if (awaitsConfirmation(props, "add")) {
                markLocalEdit(item?.id);
            }
            callback(props.addMode === "addAndCallAction" ? item : null);
        },
        // vis-timeline expects the edited item back from onUpdate. A Mendix action cannot answer
        // synchronously, so the inline edit is always cancelled and the data source brings the new
        // values back in once the action has run.
        onUpdate: (item: any, callback: (item: any) => void) => {
            actions.run("onUpdateAction", {
                data: JSON.stringify(item),
                updatedItemID: idToString(item?.id)
            });
            actions.runForItem("itemUpdateAction", idToString(item?.id));
            callback(null);
        },
        onMove: (item: any, callback: (item: any) => void) => {
            const props = propsRef.current;
            actions.run("moveAction", {
                movedItemID: idToString(item?.id),
                movedStart: toDate(item?.start),
                movedEnd: toDate(item?.end),
                movedGroupID: idToString(item?.group)
            });
            actions.runForItem("itemMoveAction", idToString(item?.id), {
                newStart: toDate(item?.start),
                newEnd: toDate(item?.end),
                newGroupID: idToString(item?.group)
            });
            if (awaitsConfirmation(props, "move")) {
                markLocalEdit(item?.id);
            }
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
            actions.run("onRemoveAction", {
                data: JSON.stringify(item),
                removedItemID: idToString(item?.id)
            });
            actions.runForItem("itemRemoveAction", idToString(item?.id));
            if (awaitsConfirmation(props, "remove")) {
                markLocalEdit(item?.id);
            }
            callback(props.removeMode === "removeAndCallAction" ? item : null);
        },
        onMoveGroup: (group: any, callback: (group: any) => void) => {
            actions.run("moveGroupAction", { movedGroupID: idToString(group?.id) });
            callback(group);
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
            actions.run("groupOrderSwapAction", {
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
    resolveItem: ItemResolver,
    actions: WidgetActions
): () => void {
    // Editable items emit a second, reduced `click` and `doubleClick` payload that has no `what`
    // key. Ignoring those is what keeps a microflow from running twice on a single click.
    const isPrimary = (properties: any): boolean => properties != null && "what" in properties;

    timeline.on("click", properties => {
        const props = propsRef.current;
        if (!isPrimary(properties)) {
            return;
        }
        if (inScope(props.clickScope, properties, true)) {
            actions.fire("clickAction", {
                clickedItemID: idToString(properties.item),
                clickedGroupID: idToString(properties.group),
                clickedTime: toDate(properties.time),
                clickedWhat: properties.what ?? undefined,
                clickedMarkerID: idToString(properties.customTime)
            });
        }
        actions.fireForItem("itemClickAction", idToString(properties.item));
    });

    timeline.on("doubleClick", properties => {
        const props = propsRef.current;
        if (!isPrimary(properties)) {
            return;
        }
        if (inScope(props.doubleClickScope, properties, true)) {
            actions.fire("doubleClickAction", {
                doubleClickedItemID: idToString(properties.item),
                doubleClickedGroupID: idToString(properties.group),
                doubleClickedTime: toDate(properties.time),
                doubleClickedWhat: properties.what ?? undefined,
                doubleClickedMarkerID: idToString(properties.customTime)
            });
        }
        actions.fireForItem("itemDoubleClickAction", idToString(properties.item));
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
            actions.fire("contextMenuAction", {
                contextItemID: idToString(properties.item),
                contextGroupID: idToString(properties.group),
                contextTime: toDate(properties.time),
                contextWhat: properties.what ?? undefined
            });
        }
        actions.fireForItem("itemContextMenuAction", idToString(properties.item));
    });

    timeline.on("itemover", properties =>
        fireAction(propsRef.current.itemOverAction, { hoveredItemID: idToString(properties?.item) })
    );
    timeline.on("itemout", properties =>
        fireAction(propsRef.current.itemOutAction, { unhoveredItemID: idToString(properties?.item) })
    );
    timeline.on("groupDragged", properties =>
        actions.run("groupDraggedAction", { draggedGroupID: idToString(properties?.groupId) })
    );

    timeline.on("drop", properties => {
        let data: string | undefined;
        try {
            data = properties?.event?.dataTransfer?.getData("text") || undefined;
        } catch {
            data = undefined;
        }
        actions.run("dropAction", {
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
        actions.runLatest("selectAction", { selectedItemIDs: joined });
    });

    timeline.on("rangechanged", properties =>
        actions.runLatest("rangeChangedAction", {
            rangeStart: toDate(properties?.start),
            rangeEnd: toDate(properties?.end),
            rangeByUser: properties?.byUser === true
        })
    );

    const inView = createInViewReporter(
        timeline,
        (itemIds, groupIds) =>
            fireAction(propsRef.current.visibleChangedAction, { visibleItemIDs: itemIds, visibleGroupIDs: groupIds }),
        () => !!propsRef.current.visibleChangedAction
    );
    const reportInView = (): void => inView.report();
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
        actions.run("markerLabelChangedAction", {
            changedMarkerID: idToString(properties?.id),
            changedMarkerLabel: htmlToText(properties?.title)
        })
    );

    timeline.on("timechanged", properties =>
        actions.run("markerChangedAction", {
            movedMarkerID: idToString(properties?.id),
            movedMarkerTime: toDate(properties?.time)
        })
    );

    return () => inView.dispose();
}

/**
 * With Disable XSS protection on, content is handed to vis-timeline as an element, which it shows
 * as it is. Turning off vis-timeline's own sanitizer instead would turn it off for every timeline
 * on the page, because vis-timeline keeps one for all of them.
 */
function rawOrText(propsRef: PropsRef, content: string): string | HTMLElement {
    if (!propsRef.current.xssDisabled || typeof content !== "string" || content === "") {
        return content;
    }
    const element = document.createElement("span");
    element.className = "vis-timeline-widget-html";
    element.innerHTML = content;
    return element;
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

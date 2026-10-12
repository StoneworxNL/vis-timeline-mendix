import { TimelineOptions } from "vis-timeline/standalone";
import { VisTimelineContainerProps } from "../../typings/VisTimelineProps";
import { buildHiddenDates } from "./data";
import { deepMerge, dynamicBoolean, dynamicNumber, dynamicText, parseJsonObject } from "./values";
import { defaultLabelFormats, LabelFormats, resolveLocale, VisMoment } from "./vis";

/**
 * Everything vis-timeline can be told through plain data. Function valued options (templates,
 * snapping, manipulation callbacks) are registered once when the timeline is created, because they
 * read the current props through a ref and therefore never go stale.
 */
export function buildStaticOptions(props: VisTimelineContainerProps): TimelineOptions {
    const options: TimelineOptions = {
        align: props.align,
        autoResize: props.autoResize,
        clickToUse: props.clickToUse,
        editable: {
            add: dynamicBoolean(props.editableAdd),
            remove: dynamicBoolean(props.editableRemove),
            updateTime: dynamicBoolean(props.editableUpdateTime),
            updateGroup: dynamicBoolean(props.editableUpdateGroup),
            overrideItems: props.editableOverrideItems
        },
        groupEditable: {
            add: dynamicBoolean(props.groupEditableAdd),
            remove: dynamicBoolean(props.groupEditableRemove),
            order: dynamicBoolean(props.groupEditableOrder)
        },
        groupHeightMode: props.groupHeightMode,
        horizontalScroll: props.horizontalScroll,
        horizontalScrollInvert: props.horizontalScrollInvert,
        itemsAlwaysDraggable: {
            item: props.itemsAlwaysDraggableItem,
            range: props.itemsAlwaysDraggableRange
        },
        longSelectPressTime: props.longSelectPressTime,
        margin: {
            axis: props.marginAxis,
            item: { horizontal: props.marginItemHorizontal, vertical: props.marginItemVertical }
        },
        maxMinorChars: props.maxMinorChars,
        moveable: props.moveable,
        // Picking Multi on the selection property is a clear enough statement of intent that the
        // timeline should let the user make one.
        multiselect: props.multiselect || props.itemSelection?.type === "Multi",
        multiselectPerGroup: props.multiselectPerGroup,
        orientation: { axis: props.orientationAxis, item: props.orientationItem },
        preferZoom: props.preferZoom,
        rollingMode: { follow: props.rollingMode, offset: Number(props.rollingModeOffset.toString()) },
        rtl: props.rtl,
        selectable: props.selectable,
        sequentialSelection: props.sequentialSelection,
        showCurrentTime: props.showCurrentTime,
        showMajorLabels: props.showMajorLabels,
        showMinorLabels: props.showMinorLabels,
        showTooltips: props.showTooltips,
        showWeekScale: props.showWeekScale,
        stack: props.stack,
        stackSubgroups: props.stackSubgroups,
        tooltip: {
            followMouse: props.tooltipFollowMouse,
            overflowMethod: props.tooltipOverflowMethod,
            delay: props.tooltipDelay
        },
        tooltipOnItemUpdateTime: props.tooltipOnItemUpdateTime,
        verticalScroll: props.verticalScroll,
        zoomable: props.zoomable,
        zoomFriction: props.zoomFriction,
        zoomKey: props.zoomKey === "none" ? "" : props.zoomKey,
        xss: { disabled: props.xssDisabled }
    };

    if (props.defaultItemType !== "auto") {
        options.type = props.defaultItemType;
    }
    if (props.groupOrderMode !== "none") {
        options.groupOrder = props.groupOrderMode;
    }
    // vis-timeline only stacks by a field when it is given an order function; without it the
    // Order value attribute was read but never used.
    if (props.itemOrderValue) {
        options.order = (a: any, b: any) => (a?.orderValue ?? 0) - (b?.orderValue ?? 0);
    }
    if (props.timeAxisScale !== "auto") {
        options.timeAxis = { scale: props.timeAxisScale, step: props.timeAxisStep };
    }
    if (props.clusterItems) {
        options.cluster = {
            maxItems: props.clusterMaxItems,
            fitOnDoubleClick: props.clusterFitOnDoubleClick,
            showStipes: props.clusterShowStipes,
            ...(dynamicText(props.clusterTitleTemplate) !== undefined && {
                titleTemplate: dynamicText(props.clusterTitleTemplate)
            })
        };
    }

    assignIfDefined(options, "height", dynamicText(props.height));
    assignIfDefined(options, "minHeight", dynamicText(props.minHeight));
    assignIfDefined(options, "maxHeight", dynamicText(props.maxHeight));
    assignIfDefined(options, "width", dynamicText(props.width));
    assignIfDefined(options, "min", props.minDate?.value);
    assignIfDefined(options, "max", props.maxDate?.value);
    assignIfDefined(options, "zoomMin", dynamicNumber(props.zoomMin));
    assignIfDefined(options, "zoomMax", dynamicNumber(props.zoomMax));

    // The same resolved locale drives the axis labels (see the moment factory) and vis-timeline's
    // own wording, so the two can never end up in different languages.
    const locale = resolveLocale(dynamicText(props.locale));
    const currentLabel = dynamicText(props.localeCurrentLabel);
    const timeLabel = dynamicText(props.localeTimeLabel);
    options.locale = locale;
    if (currentLabel !== undefined || timeLabel !== undefined) {
        options.locales = {
            [locale]: {
                ...(currentLabel !== undefined && { current: currentLabel }),
                ...(timeLabel !== undefined && { time: timeLabel })
            }
        };
    }

    const minorLabels = parseJsonObject(dynamicText(props.formatMinorLabels), "Minor label formats");
    const majorLabels = parseJsonObject(dynamicText(props.formatMajorLabels), "Major label formats");
    if (defaultLabelFormats) {
        // Hand over functions rather than objects. The time axis shallow copies vis-timeline's
        // default formats and deep merges objects into them, which rewrites the defaults shared by
        // every timeline on the page; a function is assigned instead, so each timeline keeps its own.
        options.format = {
            minorLabels: labelFormatter({ ...defaultLabelFormats.minorLabels, ...(minorLabels as LabelFormats) }),
            majorLabels: labelFormatter({ ...defaultLabelFormats.majorLabels, ...(majorLabels as LabelFormats) })
        } as unknown as TimelineOptions["format"];
    } else if (minorLabels || majorLabels) {
        options.format = { ...(minorLabels && { minorLabels }), ...(majorLabels && { majorLabels }) };
    }

    const dataAttributes = dynamicText(props.dataAttributes);
    if (dataAttributes !== undefined) {
        options.dataAttributes =
            dataAttributes.trim().toLowerCase() === "all"
                ? "all"
                : dataAttributes
                      .split(",")
                      .map(name => name.trim())
                      .filter(name => name.length > 0);
    }

    const hiddenDates = buildHiddenDates(props);
    if (hiddenDates.length > 0) {
        options.hiddenDates = hiddenDates;
    }

    const extra = parseJsonObject(dynamicText(props.optionsJson), "Extra options (JSON)");
    if (extra) {
        deepMerge(options as Record<string, unknown>, extra);
    }

    return options;
}

function assignIfDefined<K extends keyof TimelineOptions>(
    options: TimelineOptions,
    key: K,
    value: TimelineOptions[K] | undefined
): void {
    if (value !== undefined) {
        options[key] = value;
    }
}

/** Formats a label with the moment format configured for the scale the time axis is showing. */
function labelFormatter(formats: LabelFormats): (date: VisMoment, scale: string) => string {
    return (date, scale) => {
        const format = formats[scale];
        return format ? date.format(format) : "";
    };
}

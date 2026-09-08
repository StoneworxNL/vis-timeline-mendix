import { VisTimelinePreviewProps } from "../typings/VisTimelineProps";

export type Platform = "web" | "desktop";

export type Properties = PropertyGroup[];

type PropertyGroup = {
    caption: string;
    propertyGroups?: PropertyGroup[];
    properties?: Property[];
};

type Property = {
    key: string;
    caption: string;
    description?: string;
    objectHeaders?: string[]; // used for customizing object grids
    objects?: ObjectProperties[];
    properties?: Properties[];
};

type ObjectProperties = {
    properties: PropertyGroup[];
    captions?: string[]; // used for customizing object grids
};

export type Problem = {
    property?: string; // key of the property, at which the problem exists
    severity?: "error" | "warning" | "deprecation"; // default = "error"
    message: string; // description of the problem
    studioMessage?: string; // studio-specific message, defaults to message
    url?: string; // link with more information about the problem
    studioUrl?: string; // studio-specific link
};

const DOCS_URL = "https://visjs.github.io/vis-timeline/docs/timeline/";

export function getProperties(values: VisTimelinePreviewProps, defaultProperties: Properties): Properties {
    const hidden: string[] = [];

    if (values.itemContentType === "attribute") {
        hidden.push("itemContentWidgets");
    } else {
        hidden.push("ItemContent");
    }
    if (values.groupContentType === "attribute") {
        hidden.push("groupContentWidgets");
    } else {
        hidden.push("GroupContentAttr");
    }
    if (values.itemTooltipType !== "text") {
        hidden.push("itemTitle");
    }
    if (values.itemTooltipType !== "custom") {
        hidden.push("itemTooltipWidgets");
    }
    if (values.itemTooltipType === "none") {
        hidden.push("tooltipFollowMouse", "tooltipOverflowMethod", "tooltipDelay");
    }

    if (!values.VisGroupsDataSource) {
        hidden.push(
            "GroupIDAttr",
            "groupAssociation",
            "treeLevel",
            "groupContentType",
            "GroupContentAttr",
            "groupContentWidgets",
            "groupTitle",
            "GroupClassName",
            "groupStyle",
            "groupVisible",
            "groupShowNested",
            "GroupValue",
            "groupOrderMode",
            "groupSubgroupOrder",
            "groupSubgroupStack",
            "groupHeightMode"
        );
    }
    if (!values.subgroupsDataSource) {
        hidden.push("subgroupGroupId", "subgroupId", "subgroupVisible");
    }
    if (!values.markersDataSource) {
        hidden.push("markerId", "markerTime", "markerTitle");
    }
    if (!values.hiddenDatesDataSource) {
        hidden.push("hiddenDateStart", "hiddenDateEnd", "hiddenDateRepeat");
    }

    if (!values.clusterItems) {
        hidden.push("clusterMaxItems", "clusterFitOnDoubleClick", "clusterShowStipes", "clusterTitleTemplate");
    }
    if (values.timeAxisScale === "auto") {
        hidden.push("timeAxisStep");
    }
    if (!values.rollingMode) {
        hidden.push("rollingModeOffset");
    }
    if (!values.selectable) {
        hidden.push("multiselect", "multiselectPerGroup", "sequentialSelection", "focusOnSelection");
    }
    if (!values.animateChanges) {
        hidden.push("animationDuration", "animationEasing");
    }
    if (!values.zoomable) {
        hidden.push("zoomKey", "zoomFriction", "preferZoom");
    }

    hideProperties(defaultProperties, hidden);
    return defaultProperties;
}

export function check(values: VisTimelinePreviewProps): Problem[] {
    const problems: Problem[] = [];

    const requireWith = (
        dataSource: unknown,
        dataSourceName: string,
        required: Array<[key: string, label: string]>
    ): void => {
        if (!dataSource) {
            return;
        }
        for (const [key, label] of required) {
            if (!values[key as keyof VisTimelinePreviewProps]) {
                problems.push({
                    property: key,
                    message: `${label} is required when a ${dataSourceName} data source is configured.`
                });
            }
        }
    };

    requireWith(values.VisGroupsDataSource, "groups", [["GroupIDAttr", "Group ID"]]);
    requireWith(values.subgroupsDataSource, "subgroups", [
        ["subgroupGroupId", "Subgroup: group ID"],
        ["subgroupId", "Subgroup ID"],
        ["subgroupVisible", "Subgroup visible"]
    ]);
    requireWith(values.markersDataSource, "markers", [
        ["markerId", "Marker ID"],
        ["markerTime", "Marker time"]
    ]);
    requireWith(values.hiddenDatesDataSource, "hidden periods", [
        ["hiddenDateStart", "Hidden period start"],
        ["hiddenDateEnd", "Hidden period end"]
    ]);

    if (values.VisGroupsDataSource && !values.ItemGroupID) {
        problems.push({
            property: "ItemGroupID",
            severity: "warning",
            message: "Without an Item Group ID every item ends up in the same, unnamed row."
        });
    }
    if (values.itemContentType === "custom" && values.itemContentWidgets?.widgetCount === 0) {
        problems.push({
            property: "itemContentWidgets",
            severity: "warning",
            message: "Content type is Custom but no widgets have been placed, so the items will render empty."
        });
    }
    if (values.groupContentType === "custom" && values.groupContentWidgets?.widgetCount === 0) {
        problems.push({
            property: "groupContentWidgets",
            severity: "warning",
            message:
                "Group content type is Custom but no widgets have been placed, so the group labels will render empty."
        });
    }
    if (values.itemTooltipType === "custom" && values.itemTooltipWidgets?.widgetCount === 0) {
        problems.push({
            property: "itemTooltipWidgets",
            severity: "warning",
            message: "Tooltip type is Custom but no widgets have been placed, so no tooltip will be shown."
        });
    }
    if (values.groupOrderMode === "value" && !values.GroupValue) {
        problems.push({
            property: "GroupValue",
            message: "Group order is set to Order value, so an Order value attribute has to be selected."
        });
    }
    if (values.groupEditableOrder && values.groupEditableOrder !== "false" && values.groupOrderMode !== "value") {
        problems.push({
            property: "groupOrderMode",
            severity: "warning",
            message: "Reordering groups by dragging only persists when Group order is set to Order value.",
            url: DOCS_URL
        });
    }
    if (values.verticalScroll && !values.maxHeight) {
        problems.push({
            property: "maxHeight",
            severity: "warning",
            message: "Vertical scrolling only has an effect when a maximum height is set."
        });
    }
    if (values.xssDisabled) {
        problems.push({
            property: "xssDisabled",
            severity: "warning",
            message:
                "XSS protection is disabled, so item and group content is rendered as raw HTML. Only do this for content you fully control."
        });
    }
    if (values.selectedItemIds && !values.selectable) {
        problems.push({
            property: "selectable",
            severity: "warning",
            message: "Selected item IDs is bound but Selectable is off, so the user cannot change the selection."
        });
    }

    return problems;
}

function hideProperties(groups: Properties, keys: string[]): void {
    if (keys.length === 0) {
        return;
    }
    for (const group of groups) {
        if (group.properties) {
            group.properties = group.properties.filter(property => !keys.includes(property.key));
        }
        if (group.propertyGroups) {
            hideProperties(group.propertyGroups, keys);
        }
    }
}

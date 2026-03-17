/**
 * This file was generated from VisTimeline.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { CSSProperties } from "react";
import { DynamicValue, ListValue, ListAttributeValue } from "mendix";
import { Big } from "big.js";

export interface VisTimelineContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    VisGroupsDataSource: ListValue;
    GroupIDAttr: ListAttributeValue<string | Big>;
    GroupContentAttr: ListAttributeValue<string>;
    GroupValue: ListAttributeValue<Big>;
    GroupClassName: ListAttributeValue<string>;
    VisItemsDataSource: ListValue;
    ItemID: ListAttributeValue<Big | string>;
    ItemGroupID: ListAttributeValue<string | Big>;
    ItemContent: ListAttributeValue<string>;
    Start: ListAttributeValue<Date>;
    End: ListAttributeValue<Date>;
    Type: ListAttributeValue<string>;
    ItemClassName: ListAttributeValue<string>;
    IsSnap: DynamicValue<boolean>;
}

export interface VisTimelinePreviewProps {
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    VisGroupsDataSource: {} | { caption: string } | { type: string } | null;
    GroupIDAttr: string;
    GroupContentAttr: string;
    GroupValue: string;
    GroupClassName: string;
    VisItemsDataSource: {} | { caption: string } | { type: string } | null;
    ItemID: string;
    ItemGroupID: string;
    ItemContent: string;
    Start: string;
    End: string;
    Type: string;
    ItemClassName: string;
    IsSnap: string;
}

/**
 * This file was generated from VisTimeline.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { CSSProperties } from "react";
import { ListValue, ListAttributeValue } from "mendix";
import { Big } from "big.js";

export interface VisTimelineContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    VisItemsDataSource: ListValue;
    ItemID: ListAttributeValue<Big | string>;
    ItemContent: ListAttributeValue<string>;
    Start: ListAttributeValue<Date>;
    End: ListAttributeValue<Date>;
    Type: ListAttributeValue<string>;
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
    VisItemsDataSource: {} | { caption: string } | { type: string } | null;
    ItemID: string;
    ItemContent: string;
    Start: string;
    End: string;
    Type: string;
}

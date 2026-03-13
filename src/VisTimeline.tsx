import { ReactElement } from "react";
import { HelloWorldSample } from "./components/HelloWorldSample";

import { VisTimelineContainerProps } from "../typings/VisTimelineProps";

import "./ui/VisTimeline.css";

export function VisTimeline({ VisItemsDataSource, ItemID, ItemContent, Start, End, Type }: VisTimelineContainerProps): ReactElement {
    return <HelloWorldSample 
                VisItemsDataSource = {VisItemsDataSource}
                ItemID = {ItemID}
                ItemContent = {ItemContent}
                Start = {Start} 
                End = {End} 
                Type = {Type} />;
}

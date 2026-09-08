import { ReactElement } from "react";

import { VisTimelineComponent } from "./components/VisTimelineComponent";
import { VisTimelineContainerProps } from "../typings/VisTimelineProps";

import "./ui/VisTimeline.css";

export function VisTimeline(props: VisTimelineContainerProps): ReactElement {
    return <VisTimelineComponent {...props} />;
}

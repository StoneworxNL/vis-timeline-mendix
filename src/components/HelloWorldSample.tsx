import { ReactElement, useRef, useEffect } from "react";
import { Timeline, DataSet } from "vis-timeline/standalone";
import { ListValue, ListAttributeValue, DynamicValue } from "mendix";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

export interface ItemProps {
    VisItemsDataSource: ListValue;
    ItemID: ListAttributeValue<any>;
    ItemContent: ListAttributeValue<string>;
    Start: ListAttributeValue<Date>;
    End: ListAttributeValue<Date>;
    Type: ListAttributeValue<string>;

    // Options
    IsSnap: DynamicValue<boolean>;

    // Group Props
    VisGroupsDataSource: ListValue; // The entity representing groups
    GroupIDAttr: ListAttributeValue<any>;
    GroupContentAttr: ListAttributeValue<string>;
    
    // Link between Item and Group
    ItemGroupID: ListAttributeValue<any>; // Attribute on the Item entity that matches GroupID
}


// export interface ItemProps {
//     // ... other props
//     IsSnap: DynamicValue<boolean>;
//     SnapValue: DynamicValue<Big>;     // e.g., 1, 5, 10
//     SnapUnit: DynamicValue<string>;    // e.g., "minutes", "hours", "days", "months", "years"
// }
// function snapOption(date: Date, scale: string, step: number)    {
//     const newDate = new Date(date);

//     switch (unit) {
//         case "years":
//             const year = Math.round(newDate.getFullYear() / val) * val;
//             return new Date(year, 0, 1).getTime();

//         case "months":
//             const month = Math.round(newDate.getMonth() / val) * val;
//             return new Date(newDate.getFullYear(), month, 1).getTime();

//         case "days":
//             const day = Math.round(newDate.getDate() / val) * val;
//             return new Date(newDate.getFullYear(), newDate.getMonth(), day).getTime();

//         case "hours":
//             const hourMs = val * 60 * 60 * 1000;
//             return Math.round(newDate.getTime() / hourMs) * hourMs;

//         case "minutes":
//         default:
//             const minMs = val * 60 * 1000;
//             return Math.round(newDate.getTime() / minMs) * minMs;
//     }
// }

export function HelloWorldSample(props: ItemProps): ReactElement {
    const { 
        VisItemsDataSource, ItemID, ItemContent, Start, End, Type, IsSnap,
        VisGroupsDataSource, GroupIDAttr, GroupContentAttr, ItemGroupID 
    } = props;

    const visRef = useRef<HTMLDivElement | null>(null);
    const timelineRef = useRef<Timeline | null>(null);
    
    // Stable references for both Items and Groups
    const itemsRef = useRef<DataSet<any>>(new DataSet());
    const groupsRef = useRef<DataSet<any>>(new DataSet());

    // Initialize Timeline with Groups
    useEffect(() => {
        if (visRef.current && !timelineRef.current && VisGroupsDataSource.status === 'available') {
            const options = { editable: true };
            
            // Check if we actually have groups to show
            const hasGroups = VisGroupsDataSource.items && VisGroupsDataSource.items.length > 0;
            
            // If no groups, pass null as the 3rd argument (groups)
            hasGroups ? timelineRef.current = new Timeline(
                visRef.current, 
                itemsRef.current, 
                groupsRef.current, 
                options
            ) : timelineRef.current = new Timeline(
                visRef.current, 
                itemsRef.current, 
                options
            );
        }
        // ... cleanup
    }, [VisGroupsDataSource.items?.length]); // Re-init if data source existence changes

    // Effect to Update Groups
    useEffect(() => {
        if (VisGroupsDataSource.status === "available" && VisGroupsDataSource.items) {
            const formattedGroups = VisGroupsDataSource.items.map(group => ({
                id: GroupIDAttr.get(group).displayValue,
                content: GroupContentAttr.get(group).value
            }));
            groupsRef.current.update(formattedGroups);
        }
    }, [VisGroupsDataSource.items, GroupIDAttr, GroupContentAttr]);

    useEffect(() => {
        if (timelineRef.current && IsSnap.status === "available") {
            timelineRef.current.setOptions({
                snap: IsSnap.value 
                    ? (date: any) => {
                        const hour = 60 * 60 * 1000;
                        return Math.round(date.getTime() / hour) * hour;
                      }
                    : null
            });
        }
    }, [IsSnap.value, IsSnap.status]); // Added status for safety

    // Effect to Update Items (Modified to include group ID)
    useEffect(() => {
        if (VisGroupsDataSource.status === "available" && VisItemsDataSource.status === "available" && VisItemsDataSource.items) {
            const formattedItems = VisItemsDataSource.items.map(item => ({
                id: ItemID.get(item).displayValue,
                group: ItemGroupID.get(item).displayValue, // Link item to group
                start: Start.get(item).value,
                end: End.get(item).value,
                type: Type.get(item).value,
                content: ItemContent.get(item).value
            }));
            itemsRef.current.update(formattedItems);
            timelineRef.current?.fit();
        }
    }, [VisItemsDataSource.items, ItemID, ItemContent, Start, End, Type, ItemGroupID]);

    return <div ref={visRef} />;
}
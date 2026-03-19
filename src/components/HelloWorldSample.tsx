import { ReactElement, useRef, useEffect } from "react";
import { Timeline, DataSet } from "vis-timeline/standalone";
import { ListValue, ListAttributeValue, DynamicValue, ActionValue } from "mendix";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

export interface ItemProps {
    VisItemsDataSource: ListValue;
    ItemID: ListAttributeValue<any>;
    ItemContent: ListAttributeValue<string>;
    Start: ListAttributeValue<Date>;
    End: ListAttributeValue<Date>;
    Type: ListAttributeValue<string>;
    ItemClassName: ListAttributeValue<string>;

    // Options
    IsSnap: DynamicValue<boolean>;

    // Group Props
    VisGroupsDataSource: ListValue; // The entity representing groups
    GroupIDAttr: ListAttributeValue<any>;
    GroupContentAttr: ListAttributeValue<string>;
    GroupClassName: ListAttributeValue<string>;
    GroupValue: ListAttributeValue<Big>;
    
    // Link between Item and Group
    ItemGroupID: ListAttributeValue<any>; // Attribute on the Item entity that matches GroupID

    clickAction: ActionValue<{ clickedItemID: string }> | undefined;
}

export function HelloWorldSample(props: ItemProps): ReactElement {
    const { 
        VisItemsDataSource, ItemID, ItemContent, Start, End, Type, ItemClassName, /*IsSnap,*/
        VisGroupsDataSource, GroupIDAttr, GroupContentAttr, ItemGroupID, GroupClassName, GroupValue,
        clickAction
    } = props;

    const visRef = useRef<HTMLDivElement | null>(null);
    const timelineRef = useRef<Timeline | null>(null);
    
    // Stable references for both Items and Groups
    const itemsRef = useRef<DataSet<any>>(new DataSet());
    const groupsRef = useRef<DataSet<any>>(new DataSet());

    // Initialize Timeline 
    useEffect(() => {
        if (visRef.current && !timelineRef.current && VisGroupsDataSource.status === 'available') {
            const options = { editable: true };
            
            // Check if we actually have groups to show
            const hasGroups = VisGroupsDataSource.items && VisGroupsDataSource.items.length > 0;
            
            hasGroups ? timelineRef.current = new Timeline(visRef.current, itemsRef.current, groupsRef.current, options
            ) : timelineRef.current = new Timeline(visRef.current, itemsRef.current, options);

            // On Click Event
            timelineRef.current.on("click", function (properties) {
                if (properties.item != null) {
                    const id = String(properties.item);

                    if (clickAction && clickAction.canExecute) {
                        clickAction.execute({clickedItemID: id});
                    }
                }
            });

        }
 
    }, [VisGroupsDataSource.status]); // Re-init if data source existence changes

    // Effect to Update Groups
    useEffect(() => {
        if (VisGroupsDataSource.status === "available" && VisGroupsDataSource.items) {
            const formattedGroups = VisGroupsDataSource.items.map(group => ({
                id: GroupIDAttr.get(group).value,
                content: GroupContentAttr.get(group).value,
                value: GroupValue.get(group).value,
                className: GroupClassName.get(group).value
            }));
            groupsRef.current.update(formattedGroups);
        }
    }, [VisGroupsDataSource.items]);

    // Effect to Update Items
    useEffect(() => {
        if (VisGroupsDataSource.status === "available" && VisItemsDataSource.status === "available" && VisItemsDataSource.items) {
            const formattedItems = VisItemsDataSource.items.map(item => ({
                id: ItemID.get(item).displayValue,
                group: ItemGroupID.get(item).value, 
                start: Start.get(item).value,
                end: End.get(item).value,
                type: Type.get(item).value,
                content: ItemContent.get(item).value,
                className: ItemClassName.get(item).value
            }));
            itemsRef.current.update(formattedItems);
            timelineRef.current?.fit();
        }
    }, [VisItemsDataSource.status, VisItemsDataSource.items?.length]);

    return <div ref={visRef} />;
}
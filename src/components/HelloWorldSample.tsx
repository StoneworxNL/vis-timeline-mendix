import { ReactElement, useRef, useEffect } from "react";
import { Timeline, DataSet } from "vis-timeline/standalone";
import { ListValue, ListAttributeValue, DynamicValue, ActionValue, ListReferenceSetValue } from "mendix";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

export interface ItemProps {
    VisItemsDataSource: ListValue;
    ItemID: ListAttributeValue<any>;
    ItemContent: ListAttributeValue<string>;
    Start: ListAttributeValue<Date>;
    End: ListAttributeValue<Date>;
    Type: ListAttributeValue<string> | undefined;
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
    ItemGroupID: ListAttributeValue<string>; // Attribute on the Item entity that matches GroupID
    groupAssociation: ListReferenceSetValue | undefined;
    groupVisible: ListAttributeValue<boolean> | undefined;
    groupShowNested: ListAttributeValue<boolean> | undefined;
    treeLevel: ListAttributeValue<Big> | undefined;

    // Event actions
    clickAction: ActionValue<{ clickedItemID: string }> | undefined;
    doubleClickAction: ActionValue<{ doubleClickedItemID: string }> | undefined;
    onAddAction: ActionValue<{ data: string }> | undefined;
    onUpdateAction: ActionValue<{ data: string }> | undefined;
    onRemoveAction: ActionValue<{ data: string }> | undefined;
    onInitialDrawCompleteAction: ActionValue | undefined;   
}

export function HelloWorldSample(props: ItemProps): ReactElement {
    const { 
        VisItemsDataSource, ItemID, ItemContent, Start, End, Type, ItemClassName, /*IsSnap,*/
        VisGroupsDataSource, GroupIDAttr, GroupContentAttr, ItemGroupID, GroupClassName, GroupValue,
        clickAction, doubleClickAction, onUpdateAction, onAddAction, onRemoveAction, onInitialDrawCompleteAction,
        groupAssociation, groupVisible, groupShowNested, treeLevel
    } = props;

    const visRef = useRef<HTMLDivElement | null>(null);
    const timelineRef = useRef<Timeline | null>(null);
    
    // Stable references for both Items and Groups
    const itemsRef = useRef<DataSet<any>>(new DataSet());
    const groupsRef = useRef<DataSet<any>>(new DataSet());

    // Events
    const preventFirstEventRef = useRef(false);

    // Initialize Timeline 
    useEffect(() => {
        if (visRef.current && !timelineRef.current && VisGroupsDataSource.status === 'available') {
            var options = { 
                editable: true,
                // On Initial Draw Complete
                onInitialDrawComplete: function () {
                    if (onInitialDrawCompleteAction && onInitialDrawCompleteAction.canExecute) {
                        onInitialDrawCompleteAction.execute();
                    }
                }
            };
            
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

            // On Double Click Event
            timelineRef.current.on("doubleClick", function (properties) {
                
                if (properties.what !== "item") return; // To prevent event from being triggered twice. Might need further improvement.

                if (properties.item != null) {
                    const id = String(properties.item);

                    if (doubleClickAction && doubleClickAction.canExecute) {
                        doubleClickAction.execute({doubleClickedItemID: id});
                    }
                }
            });
        }
 
    }, [VisGroupsDataSource.status]); // Re-init if data source existence changes

    // Effect to Update Groups
    useEffect(() => {
        if (VisGroupsDataSource.status === "available" && VisGroupsDataSource.items) {
            const formattedGroups = VisGroupsDataSource.items.map(group => {
                const nestedValues = groupAssociation
                    ? groupAssociation.get(group).value?.map(nestedg => GroupIDAttr.get(nestedg).value) ?? []
                    : [];

                return {
                    id: GroupIDAttr.get(group).value,
                    content: GroupContentAttr.get(group).value,
                    value: GroupValue.get(group).value,
                    className: GroupClassName.get(group).value,
                    visible: groupVisible ? groupVisible.get(group).value : true,
                    treeLevel: treeLevel ? treeLevel.get(group).value : 1,
                    showNested: groupShowNested ? groupShowNested.get(group).value : false,
                    
                    ...(nestedValues.length > 0 && { nestedGroups: nestedValues })
                }
            });
            groupsRef.current.update(formattedGroups);
        }
    }, [VisGroupsDataSource.items]);

    useEffect(() => {
        itemsRef?.current?.on("*", function(event, properties) {     
            const eventItemIds = properties.items;
            const eventDataSet = itemsRef.current.getDataSet().get(eventItemIds);

            if (event === "update") {
                if (eventDataSet && eventDataSet.length > 0)    {
                    if (onUpdateAction && onUpdateAction.canExecute) {
                        const jsonData = JSON.stringify(eventDataSet);
                        onUpdateAction.execute({data: jsonData});
                    }
                }
            }
            else if (event === "add") {
                if (preventFirstEventRef && preventFirstEventRef.current)   {
                    if (eventDataSet && eventDataSet.length > 0)    {
                        if (onAddAction && onAddAction.canExecute) {
                            const jsonData = JSON.stringify(eventDataSet);
                            onAddAction.execute({data: jsonData});
                        }
                    }
                }
            }
            else if (event === "remove") {
                if (onRemoveAction && onRemoveAction.canExecute) {
                    onRemoveAction.execute({data: eventItemIds[0] as string});
                }
            }
        })
    }, [itemsRef])

    // Effect to Update Items
    useEffect(() => {
        if (VisGroupsDataSource.status === "available" && VisItemsDataSource.status === "available" && VisItemsDataSource.items) {
            const formattedItems = VisItemsDataSource.items.map(item => ({
                id: ItemID.get(item).displayValue,
                group: ItemGroupID.get(item).value, 
                start: Start.get(item).value,
                end: End.get(item).value,
                content: ItemContent.get(item).value,
                className: ItemClassName.get(item).value,

                ...(Type && { type: Type.get(item).value })
            }));

            itemsRef.current.update(formattedItems);
            timelineRef.current?.fit();
            preventFirstEventRef.current = true;
        }
    }, [VisItemsDataSource.status, VisItemsDataSource.items?.length]);

    return <div ref={visRef} />;
}
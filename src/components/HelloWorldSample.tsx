import { ReactElement, useRef, useEffect } from "react";
import { Timeline, DataSet } from "vis-timeline/standalone";
import { ListValue, ListAttributeValue } from "mendix";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

export interface ItemProps {
    VisItemsDataSource: ListValue;
    ItemID: ListAttributeValue<any>;
    ItemContent: ListAttributeValue<string>;
    Start: ListAttributeValue<Date>;
    End: ListAttributeValue<Date>;
    Type: ListAttributeValue<string>;
}

export function HelloWorldSample({
    VisItemsDataSource,
    ItemID,
    ItemContent,
    Start, 
    End,
    Type
}: ItemProps): ReactElement {
    const visRef = useRef<HTMLDivElement | null>(null);
    
    // 1. Keep stable references to the Timeline and the DataSet
    const timelineRef = useRef<Timeline | null>(null);
    const itemsRef = useRef<DataSet<any>>(new DataSet());

    // 2. Initialize the Timeline instance ONLY ONCE
    useEffect(() => {
        if (visRef.current && !timelineRef.current) {
            const options = { editable: true };
            timelineRef.current = new Timeline(visRef.current, itemsRef.current, options);
        }

        // Cleanup on unmount
        return () => {
            if (timelineRef.current) {
                timelineRef.current.destroy();
                timelineRef.current = null;
            }
        };
    }, []);

    // 3. Update data whenever Mendix source changes
    useEffect(() => {
        if (!VisItemsDataSource.items || VisItemsDataSource.items.length === 0) {
            itemsRef.current.clear();
            return;
        }

        const formattedItems = VisItemsDataSource.items.map(item => ({
            id: ItemID.get(item).displayValue,
            start: Start.get(item).value,
            end: End.get(item).value,
            type: Type.get(item).value,
            content: ItemContent.get(item).value
        }));

        // .set() replaces existing data with the new array efficiently
        itemsRef.current.update(formattedItems);
        
        // Optional: Auto-fit view when data changes
        timelineRef.current?.fit();

    }, [VisItemsDataSource.items, ItemID, ItemContent, Start, End, Type]);

    return <div ref={visRef} style={{ height: "400px" }} />;
}
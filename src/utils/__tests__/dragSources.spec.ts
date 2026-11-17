import { addActionArgs } from "../actions";
import { DRAG_SOURCE_ATTRIBUTE, registerDragSources } from "../dragSources";

/** jsdom has no DataTransfer, so a drag event gets a stand-in that records what was set. */
function dragFrom(element: Element): { setData: jest.Mock; effectAllowed: string } {
    const dataTransfer = { setData: jest.fn(), effectAllowed: "none" };
    const event = new Event("dragstart", { bubbles: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    element.dispatchEvent(event);
    return dataTransfer;
}

function dragSource(value: string): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("draggable", "true");
    element.setAttribute(DRAG_SOURCE_ATTRIBUTE, value);
    element.appendChild(document.createElement("span"));
    document.body.appendChild(element);
    return element;
}

describe("drag sources", () => {
    let stop: () => void;
    beforeEach(() => {
        stop = registerDragSources();
    });
    afterEach(() => {
        stop();
        document.body.innerHTML = "";
    });

    it("hands the attribute over as the drag data, also when a child is dragged", () => {
        const source = dragSource('{"type":"range","content":"New task"}');
        const dataTransfer = dragFrom(source.firstElementChild!);
        expect(dataTransfer.setData).toHaveBeenCalledWith("text", '{"type":"range","content":"New task"}');
        expect(dataTransfer.effectAllowed).toBe("move");
    });

    it("passes junk on untouched without throwing; vis-timeline ignores a drop it cannot parse", () => {
        const source = dragSource("not json {");
        expect(() => dragFrom(source)).not.toThrow();
    });

    it("leaves drags from other elements alone", () => {
        const other = document.createElement("div");
        document.body.appendChild(other);
        expect(dragFrom(other).setData).not.toHaveBeenCalled();
    });

    it("stops listening once every timeline is gone", () => {
        stop();
        stop = registerDragSources();
        stop();
        stop = () => undefined;
        expect(dragFrom(dragSource('{"content":"x"}')).setData).not.toHaveBeenCalled();
    });
});

describe("addActionArgs", () => {
    // What vis-timeline makes of a drop from a drag source before it calls onAdd.
    it("gives On add the content of a dropped item", () => {
        const item = { ...JSON.parse('{"type":"range","content":"New task"}'), id: "uuid", start: new Date(0) };
        expect(addActionArgs(item)).toEqual(
            expect.objectContaining({ addedContent: "New task", addedStart: new Date(0), data: JSON.stringify(item) })
        );
    });

    it("leaves Content empty when it is not text", () => {
        expect(addActionArgs({ content: { html: "x" } }).addedContent).toBeUndefined();
        expect(addActionArgs(undefined).addedContent).toBeUndefined();
    });
});

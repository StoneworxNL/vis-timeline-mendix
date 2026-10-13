import { Big } from "big.js";
import { ActionValue, ListActionValue, ObjectItem } from "mendix";
import {
    awaitsConfirmation,
    fireAction,
    fireItemAction,
    idToString,
    readSelection,
    toBig,
    wantedSelection,
    writeSelection
} from "../actions";

const object = (id: string): ObjectItem => ({ id } as unknown as ObjectItem);

function action(overrides: Partial<ActionValue> = {}): ActionValue & { execute: jest.Mock } {
    return { canExecute: true, isExecuting: false, execute: jest.fn(), ...overrides } as unknown as ActionValue & {
        execute: jest.Mock;
    };
}

describe("fireAction", () => {
    it("passes the variables on", () => {
        const a = action();
        fireAction(a, { itemId: "1" });
        expect(a.execute).toHaveBeenCalledWith({ itemId: "1" });
    });

    it("respects what the platform says about the action", () => {
        const cannot = action({ canExecute: false });
        const busy = action({ isExecuting: true });
        fireAction(cannot);
        fireAction(busy);
        fireAction(undefined);
        expect(cannot.execute).not.toHaveBeenCalled();
        expect(busy.execute).not.toHaveBeenCalled();
    });
});

describe("fireItemAction", () => {
    it("resolves the action for the row it belongs to", () => {
        const row = object("guid-1");
        const inner = action();
        const listAction = { get: jest.fn(() => inner) } as unknown as ListActionValue<any> & { get: jest.Mock };

        fireItemAction(listAction, row, { newStart: undefined });
        expect(listAction.get).toHaveBeenCalledWith(row);
        expect(inner.execute).toHaveBeenCalledWith({ newStart: undefined });
    });

    it("does nothing without an object to run it for", () => {
        const listAction = { get: jest.fn() } as unknown as ListActionValue<any> & { get: jest.Mock };
        fireItemAction(listAction, undefined);
        fireItemAction(undefined, object("guid-1"));
        expect(listAction.get).not.toHaveBeenCalled();
    });
});

describe("readSelection", () => {
    it("flattens both shapes of the Mendix selection", () => {
        const one = object("a");
        expect(readSelection({ type: "Single", selection: one } as any)).toEqual([one]);
        expect(readSelection({ type: "Single", selection: undefined } as any)).toEqual([]);
        expect(readSelection({ type: "Multi", selection: [one] } as any)).toEqual([one]);
        expect(readSelection(undefined)).toEqual([]);
    });
});

describe("wantedSelection", () => {
    const items = new Map([
        ["1", object("obj-1")],
        ["2", object("obj-2")]
    ]);

    it("only asks for ids whose item the timeline has", () => {
        const ids = { status: "available", value: "2, 7" } as any;
        expect(wantedSelection(undefined, ids, items)).toEqual(["2"]);
        expect(wantedSelection(undefined, ids, new Map())).toEqual([]);
    });

    it("maps the Selection property onto vis ids, and prefers it over the ids attribute", () => {
        const selection = { type: "Multi", selection: [object("obj-2"), object("obj-9")] } as any;
        expect(wantedSelection(selection, { status: "available", value: "1" } as any, items)).toEqual(["2"]);
    });

    it("leaves the selection alone when nothing drives it", () => {
        expect(wantedSelection(undefined, undefined, items)).toBeUndefined();
        expect(wantedSelection(undefined, { status: "loading", value: undefined } as any, items)).toBeUndefined();
    });
});

describe("writeSelection", () => {
    it("hands a multi selection the whole list", () => {
        const setSelection = jest.fn();
        const objects = [object("a"), object("b")];
        writeSelection({ type: "Multi", setSelection } as any, objects);
        expect(setSelection).toHaveBeenCalledWith(objects);
    });

    it("hands a single selection just the first object, or nothing", () => {
        const setSelection = jest.fn();
        writeSelection({ type: "Single", setSelection } as any, [object("a"), object("b")]);
        expect(setSelection).toHaveBeenCalledWith(object("a"));

        setSelection.mockClear();
        writeSelection({ type: "Single", setSelection } as any, []);
        expect(setSelection).toHaveBeenCalledWith(undefined);
    });

    it("survives Mendix refusing the objects", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation();
        const setSelection = jest.fn(() => {
            throw new Error("object belongs to a different data source");
        });
        expect(() => writeSelection({ type: "Multi", setSelection } as any, [object("a")])).not.toThrow();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("does nothing when the property is not configured", () => {
        expect(() => writeSelection(undefined, [object("a")])).not.toThrow();
    });
});

describe("idToString and toBig", () => {
    it("keeps an absent id absent rather than turning it into a string", () => {
        expect(idToString(7)).toBe("7");
        expect(idToString("7")).toBe("7");
        expect(idToString(null)).toBeUndefined();
        expect(idToString(undefined)).toBeUndefined();
    });

    it("converts only what an Integer action variable can carry", () => {
        expect(toBig(3)?.eq(new Big(3))).toBe(true);
        expect(toBig("3")?.eq(new Big(3))).toBe(true);
        expect(toBig(undefined)).toBeUndefined();
        expect(toBig({})).toBeUndefined();
        expect(toBig("not a number")).toBeUndefined();
    });
});

describe("awaitsConfirmation", () => {
    const listAction = {} as ListActionValue<any>;
    const keep = {
        addMode: "addAndCallAction",
        moveMode: "moveAndCallAction",
        removeMode: "removeAndCallAction"
    } as const;

    // Regression: on a page that keeps moves on screen but binds no move action, adding an item
    // put every earlier move back once On add had finished.
    it("does not wait for a confirmation no action is bound to give", () => {
        expect(awaitsConfirmation({ ...keep, onAddAction: action() }, "move")).toBe(false);
        expect(awaitsConfirmation({ ...keep, moveAction: action() }, "add")).toBe(false);
        expect(awaitsConfirmation({ ...keep, onAddAction: action() }, "remove")).toBe(false);
    });

    it("waits for a bound action, either the plain or the per-item one", () => {
        expect(awaitsConfirmation({ ...keep, onAddAction: action() }, "add")).toBe(true);
        expect(awaitsConfirmation({ ...keep, moveAction: action() }, "move")).toBe(true);
        expect(awaitsConfirmation({ ...keep, itemMoveAction: listAction }, "move")).toBe(true);
        expect(awaitsConfirmation({ ...keep, onRemoveAction: action() }, "remove")).toBe(true);
        expect(awaitsConfirmation({ ...keep, itemRemoveAction: listAction }, "remove")).toBe(true);
    });

    it("does not wait when the timeline reverts the edit itself", () => {
        const revert = { addMode: "callAction", moveMode: "callAction", removeMode: "callAction" } as const;
        const bound = { onAddAction: action(), moveAction: action(), onRemoveAction: action() };
        expect(awaitsConfirmation({ ...revert, ...bound }, "add")).toBe(false);
        expect(awaitsConfirmation({ ...revert, ...bound }, "move")).toBe(false);
        expect(awaitsConfirmation({ ...revert, ...bound }, "remove")).toBe(false);
    });
});

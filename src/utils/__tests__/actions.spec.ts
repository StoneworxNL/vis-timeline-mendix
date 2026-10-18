import { Big } from "big.js";
import { ActionValue, ListActionValue, ObjectItem } from "mendix";
import {
    ActionQueue,
    awaitsConfirmation,
    fireAction,
    idToString,
    itemActionSource,
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

describe("ActionQueue", () => {
    afterEach(() => jest.useRealTimers());

    it("runs every call of a burst, one after the other, instead of dropping the ones that find it busy", () => {
        jest.useFakeTimers();
        const queue = new ActionQueue();
        let current = action();
        const first = current;
        queue.run("swap", () => current, { n: 1 });
        queue.run("swap", () => current, { n: 2 });
        queue.run("swap", () => current, { n: 3 });
        // Same render: Mendix has not said it is running yet, but the run started from this object.
        expect(first.execute).toHaveBeenCalledTimes(1);
        expect(first.execute).toHaveBeenCalledWith({ n: 1 });

        current = action({ isExecuting: true });
        queue.flush();
        expect(current.execute).not.toHaveBeenCalled();

        current = action();
        queue.flush();
        expect(current.execute).toHaveBeenCalledWith({ n: 2 });

        current = action();
        queue.flush();
        expect(current.execute).toHaveBeenCalledWith({ n: 3 });
        expect(queue.hasPending()).toBe(false);
        queue.dispose();
    });

    it("keeps actions apart, so a busy one does not hold up another", () => {
        const queue = new ActionQueue();
        const busy = action({ isExecuting: true });
        const free = action();
        queue.run("move", () => busy);
        queue.run("click", () => free, { id: "1" });
        expect(busy.execute).not.toHaveBeenCalled();
        expect(free.execute).toHaveBeenCalledWith({ id: "1" });
        queue.dispose();
    });

    it("only keeps the newest waiting run when asked to", () => {
        const queue = new ActionQueue();
        let current = action({ isExecuting: true });
        queue.run("range", () => current, { n: 1 }, true);
        queue.run("range", () => current, { n: 2 }, true);
        current = action();
        queue.flush();
        expect(current.execute).toHaveBeenCalledTimes(1);
        expect(current.execute).toHaveBeenCalledWith({ n: 2 });
        queue.dispose();
    });

    it("gives up on the same action object after a while, for an action Mendix never reports as running", () => {
        let now = 0;
        const queue = new ActionQueue(() => now);
        const only = action();
        queue.run("click", () => only, { n: 1 });
        queue.run("click", () => only, { n: 2 });
        expect(only.execute).toHaveBeenCalledTimes(1);
        now = 1000;
        queue.flush();
        expect(only.execute).toHaveBeenCalledTimes(2);
        expect(only.execute).toHaveBeenLastCalledWith({ n: 2 });
        queue.dispose();
    });

    it("drops a run whose action was unbound or cannot run", () => {
        const queue = new ActionQueue();
        let current: ActionValue | undefined = action({ isExecuting: true });
        queue.run("move", () => current);
        current = undefined;
        queue.flush();
        expect(queue.hasPending()).toBe(false);

        const refused = action({ canExecute: false });
        queue.run("move", () => refused);
        expect(refused.execute).not.toHaveBeenCalled();
        expect(queue.hasPending()).toBe(false);
        queue.dispose();
    });
});

describe("itemActionSource", () => {
    it("resolves the action for the row it belongs to", () => {
        const row = object("guid-1");
        const inner = action();
        const listAction = { get: jest.fn(() => inner) } as unknown as ListActionValue<any> & { get: jest.Mock };

        expect(
            itemActionSource(
                () => listAction,
                () => row
            )()
        ).toBe(inner);
        expect(listAction.get).toHaveBeenCalledWith(row);
    });

    it("has nothing to run without an object or an action", () => {
        const listAction = { get: jest.fn() } as unknown as ListActionValue<any> & { get: jest.Mock };
        expect(
            itemActionSource(
                () => listAction,
                () => undefined
            )()
        ).toBeUndefined();
        expect(
            itemActionSource(
                () => undefined,
                () => object("guid-1")
            )()
        ).toBeUndefined();
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

import { VisId } from "./values";

export interface LocalEditSettler {
    /** Records an edit the user made on the timeline and starts waiting for Mendix to confirm it. */
    mark(id: unknown): void;
    /** Tells the settler whether an edit action is busy. Waiting restarts once none is. */
    actionsChanged(running: boolean): void;
    /** Stops waiting, for when the edits were settled some other way. */
    cancel(): void;
    /** Stops waiting for good. Called before the timeline is destroyed. */
    dispose(): void;
}

/**
 * A move, remove or add the user keeps on screen may still be refused by Mendix, and a refusal
 * sends no new data that would put the item back. So every edit starts a wait: once no edit action
 * is busy for `delay` ms, `settle` puts back whatever Mendix has not confirmed.
 *
 * The wait starts at the edit itself, not when an action's busy state flips. An action that never
 * runs (the user may not execute it) or a nanoflow that refuses before Mendix shows it as busy
 * never flips that state, and the edit would otherwise stay on screen with nothing saved.
 */
export function createLocalEditSettler(
    edits: Set<VisId>,
    isRunning: () => boolean,
    settle: () => void,
    delay = 1000
): LocalEditSettler {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const cancel = (): void => {
        clearTimeout(timer);
        timer = undefined;
    };
    const schedule = (): void => {
        cancel();
        if (disposed || edits.size === 0) {
            return;
        }
        timer = setTimeout(() => {
            timer = undefined;
            // A busy action restarts the wait through actionsChanged(false) once it is done.
            if (disposed || edits.size === 0 || isRunning()) {
                return;
            }
            settle();
        }, delay);
    };

    return {
        mark(id) {
            if (id == null || disposed) {
                return;
            }
            edits.add(String(id));
            schedule();
        },
        actionsChanged(running) {
            if (running) {
                cancel();
            } else {
                schedule();
            }
        },
        cancel,
        dispose() {
            disposed = true;
            cancel();
        }
    };
}

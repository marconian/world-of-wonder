import { accumulateArray } from '.';

export interface CallStack<T = any> {
    actions: ActionDef[];
    finalizers: Action[];
    proportionSum: number;
    index: number;
    loop: boolean;
    loopProgress: number;
    parent?: CallStack;
    parentProgress: number;
    parentProgressRange: number;
    resultProvider?: (() => T) | T;
}

export type Action = (action: SteppedAction) => void;

export interface ActionDef {
    action: Action;
    proportion: number;
    name?: string;
}

export class SteppedAction {
    callStack?: CallStack;
    subactions: ActionDef[];
    finalizers: Action[];
    unbrokenInterval: number;
    sleepInterval: number;
    loopAction: boolean;
    started: boolean;
    canceled: boolean;
    completed: boolean;
    intervalIteration: number;
    stepIteration: number;
    intervalStepIteration?: number;
    intervalStartTime?: number;
    intervalEndTime?: number;
    progressUpdater?: ((action: SteppedAction) => void);

    constructor(progressUpdater?: Action, unbrokenInterval?: number, sleepInterval?: number) {
        this.callStack = undefined;
        this.subactions = [];
        this.finalizers = [];
        this.unbrokenInterval = unbrokenInterval && (unbrokenInterval >= 0) ? unbrokenInterval : 16;
        this.sleepInterval = sleepInterval && (sleepInterval >= 0) ? sleepInterval : 0;
        this.loopAction = false;
        this.started = false;
        this.canceled = false;
        this.completed = false;
        this.intervalIteration = 0; //number of times an unbroken interval has been completed
        this.stepIteration = 0; //number of times any of the stepper functions have been called
        this.progressUpdater = progressUpdater;
    }

    execute(): SteppedAction {
        if (!this.canceled && !this.completed && this.callStack === null && this.started === false) {
            this.started = true;
            if (this.subactions.length > 0) {
                this.beginSubactions(0, 1);
                if (this.progressUpdater) this.progressUpdater(this);
                window.setTimeout(this.step.bind(this), this.sleepInterval);
            } else {
                this.completed = true;
            }
        }

        return this;
    }

    step() {
        this.intervalStartTime = Date.now();
        this.intervalEndTime = this.intervalStartTime + this.unbrokenInterval;
        this.intervalStepIteration = 0;
        
        if (this.callStack) {
            const cs = this.callStack;
            while (Date.now() < this.intervalEndTime && !this.canceled && !this.completed) {
                const action = cs.actions[cs.index];
        
                cs.loop = false;
                action.action(this);
                this.intervalStepIteration += 1;
                this.stepIteration += 1;
        
                if (this.subactions.length > 0) {
                    this.beginSubactions(this.getProgress(), cs.loop ? 0 : 
                        (1 - cs.loopProgress) * action.proportion / cs.proportionSum * cs.parentProgressRange);
                } else {
                    while (cs && cs.loop === false && cs.index === cs.actions.length - 1) {
                        for (let i = 0; i < cs.finalizers.length; ++i) {
                            cs.finalizers[i](this);
                        }
                        this.callStack = cs.parent;
                    }

                    if (this.callStack) {
                        if (this.callStack.loop === false) {
                            this.callStack.loopProgress = 0;
                            this.callStack.index += 1;
                        }
                    } else {
                        this.completed = true;
                    }
                }
            }

            this.intervalStartTime = undefined;
            this.intervalEndTime = undefined;
            this.intervalStepIteration = undefined;
        
            if (this.progressUpdater) {
                this.progressUpdater(this);
            }
        
            this.intervalIteration += 1;
            if (this.canceled) {
                while (this.callStack) {
                    for (let i = 0; i < this.callStack.finalizers.length; ++i) {
                        this.callStack.finalizers[i](this);
                    }
                    this.callStack = this.callStack.parent;
                }
            } else if (!this.completed) {
                window.setTimeout(this.step.bind(this), this.sleepInterval);
            }
        }
    }

    beginSubactions(parentProgress: number, parentProgressRange: number) {
        this.callStack = {
            actions: this.subactions,
            finalizers: this.finalizers,
            proportionSum: accumulateArray(this.subactions, 0, (sum: number, subaction: ActionDef) => {
                return sum + subaction.proportion;
            }),
            index: 0,
            loop: false,
            loopProgress: 0,
            parent: this.callStack,
            parentProgress: parentProgress,
            parentProgressRange: parentProgressRange,
        };
        this.subactions = [];
        this.finalizers = [];
    }

    cancel() {
        this.canceled = true;
    }

    provideResult<T>(resultProvider: (() => T) | T) {
        if (this.callStack) {
            this.callStack.resultProvider = resultProvider;
        }
    }

    loop(progress?: number) {
        if (this.callStack) {
            this.callStack.loop = true;
            if (progress && progress >= 0 && progress < 1) {
                this.callStack.loopProgress = progress;
            }
        }
    }

    executeSubaction(subaction: (action: SteppedAction) => void, proportion?: number, name?: string) {
        this.subactions.push({
            action: subaction,
            proportion: proportion && proportion >= 0 ? proportion : 1,
            name: name
        });
        return this;
    }

    getResult<T>(recipient: (result?: T) => void) {
        this.subactions.push({
            action: (action) => {
                const resultProvider = action.callStack?.resultProvider;
                const resultProviderType = typeof(resultProvider);
                if (typeof resultProvider == 'function') {
                    recipient(resultProvider());
                } else if (resultProviderType) {
                    recipient(resultProvider);
                } else {
                    recipient();
                }
            },
            proportion: 0,
        });
        return this;
    }

    finalize(finalizer: Action) {
        this.finalizers.push(finalizer);
        return this;
    }

    getTimeRemainingInInterval() {
        if (this.intervalEndTime) {
            return Math.max(0, this.intervalEndTime - Date.now());
        } else {
            return 0;
        }
    }

    getProgress() {
        if (this.callStack) {
            if (this.callStack.proportionSum === 0) return this.callStack.parentProgress;
    
            let currentProportionSum = 0;
            for (let i = 0; i < this.callStack.index; ++i) {
                currentProportionSum += this.callStack.actions[i].proportion;
            }
            currentProportionSum += this.callStack.loopProgress * this.callStack.actions[this.callStack.index].proportion;
            return this.callStack.parentProgress + currentProportionSum / this.callStack.proportionSum * this.callStack.parentProgressRange;
        } else {
            return this.completed ? 1 : 0;
        }
    }

    getCurrentActionName() {
        let callStack = this.callStack;
        while (callStack) {
            const action = callStack.actions[callStack.index];
            if (typeof (action.name) === 'string') return action.name;
            callStack = callStack.parent;
        }
    
        return '';
    }
}

export default SteppedAction;
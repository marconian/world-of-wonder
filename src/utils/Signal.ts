class Signal {
    nextToken: number;
    listeners: Record<string, Function>;

    constructor() {
        this.nextToken = 1;
        this.listeners = {};
    }

    addListener(callback: Function, token: string) {
        if (typeof (token) !== 'string') {
            token = this.nextToken.toFixed(0);
            this.nextToken += 1;
        }
        this.listeners[token] = callback;
    }

    removeListener(token: string) {
        delete this.listeners[token];
    }

    fire() {
        for (const key in this.listeners) {
            if (this.listeners.hasOwnProperty(key)) {
                this.listeners[key].apply(null, arguments);
            }
        }
    }
}

export default Signal;
import { Vector3 } from 'three';

interface HeatInfo {
    current: number;
    absorption: number;
    limit: number;
    air: number;
    airInflow: number;
}
interface MoistureInfo {
    air: number;
    precipitation: number;
    limit: number;
    rate: number;
    airInflow: number;
}
interface AirInfo {
    outflow: number[];
    speed: number;
    direction: Vector3;
}

class Corner {
    id: number;
    position: Vector3;
    corners: number[];
    borders: number[];
    tiles: number[];
    distanceToPlateRoot?: number;
    distanceToPlateBoundary?: number;
    betweenPlates: boolean;
    elevation: number;
    pressure: number;
    temperature: number;
    heat?: HeatInfo;
    area: number;
    shear: number;
    humidity: number;
    moisture?: MoistureInfo;
    air: AirInfo;
    
    constructor(id: number, position: Vector3, cornerCount: number, borderCount: number, tileCount: number) {
        this.id = id;
        this.position = position;
        this.corners = new Array(cornerCount);
        this.borders = new Array(borderCount);
        this.tiles = new Array(tileCount);
        this.betweenPlates = false;
        this.pressure = 0;
        this.temperature = 0;
        this.elevation = 0;
        this.area = 0;
        this.shear = 0;
        this.humidity = 0;
        this.air = {
            outflow: [],
            speed: 0,
            direction: new Vector3()
        };
    }

    vectorTo(corner: Corner) {
        return corner.position.clone().sub(this.position);
    }

    toString() {
        return `Corner ${this.id.toFixed(0)} < ${this.position.x.toFixed(0)}, ${this.position.y.toFixed(0)}, ${this.position.z.toFixed(0)} >`;
    }

    static async revive<T extends Corner | (Corner | undefined)[]>(value: T, deep?: boolean): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Corner)) {
                const tasks = (value as (Corner | undefined)[])
                    .filter(v => v).map(v => Corner.revive(v as T, deep));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Corner)) {
            (value as any).__proto__ = Corner.prototype;

            if (value instanceof Corner) {
                if (value.position) (value.position as any).__proto__ = Vector3.prototype;
                if (value.air.direction) (value.air.direction as any).__proto__ = Vector3.prototype;
                // if (deep) {
                //     await Corner.revive(value.corners);
                //     await Border.revive(value.borders);
                //     await Tile.revive(value.tiles);
                // }
            }
        }

        return value;
    }
}

export default Corner;
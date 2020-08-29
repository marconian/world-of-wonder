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
    airOutflow: number;
}
interface AirInfo {
    outflow: number[];
    speed: number;
    direction: Vector3;
}

class Corner {
    id: number;
    position: Vector3;
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
    water: AirInfo;
    
    constructor(id: number, position: Vector3) {
        this.id = id;
        this.position = position;
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
        this.water = {
            outflow: [],
            speed: 0,
            direction: new Vector3()
        };
    }

    vectorTo(corner: Corner) {
        return corner.position.clone().sub(this.position);
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
                if (value.water.direction) (value.water.direction as any).__proto__ = Vector3.prototype;
            }
        }

        return value;
    }
}

export default Corner;
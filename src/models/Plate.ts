import { Vector3, Color } from 'three';
import Corner from './Corner';

class Plate {
    color: Color;
    driftAxis: Vector3;
    driftRate: number;
    spinRate: number;
    elevation: number;
    area: number;
    circumference: number;
    oceanic: boolean;
    root: number;
    tiles: number[];
    boundaryCorners: number[];
    boundaryBorders: number[];

    static async revive<T extends Plate | (Plate | undefined)[]>(value: T): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Plate)) {
                const tasks = (value as (Plate | undefined)[])
                    .filter(v => v).map(v => Plate.revive(v as T));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Plate)) {
            (value as any).__proto__ = Plate.prototype;

            if (value instanceof Plate) {
                if (value.color) (value.color as any).__proto__ = Color.prototype;
                if (value.driftAxis) (value.driftAxis as any).__proto__ = Vector3.prototype;
            }
        }

        return value;
    }

    constructor(color: Color, driftAxis: Vector3, driftRate: number, spinRate: number, elevation: number, oceanic: boolean, root: number) {
        this.color = color;
        this.driftAxis = driftAxis;
        this.driftRate = driftRate;
        this.spinRate = spinRate;
        this.elevation = elevation;
        this.area = 0;
        this.circumference = 0;
        this.oceanic = oceanic;
        this.root = root;
        this.tiles = [];
        this.boundaryCorners = [];
        this.boundaryBorders = [];
    }

    calculateMovement(corners: Corner[], position: Vector3) {
        const movement = this.driftAxis.clone().cross(position).setLength(this.driftRate * position.clone().projectOnVector(this.driftAxis).distanceTo(position));
        movement.add(corners[this.root].position.clone().cross(position).setLength(this.spinRate * position.clone().projectOnVector(corners[this.root].position).distanceTo(position)));
        return movement;
    }
}

export default Plate;
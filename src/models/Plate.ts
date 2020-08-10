import { Vector3, Color } from 'three';
import Tile from './Tile';
import Corner from './Corner';
import Border from './Border';

class Plate {
    color: Color;
    driftAxis: Vector3;
    driftRate: number;
    spinRate: number;
    elevation: number;
    area: number;
    circumference: number;
    oceanic: boolean;
    root: Corner;
    tiles: Tile[];
    boundaryCorners: Corner[];
    boundaryBorders: Border[];

    constructor(color: Color, driftAxis: Vector3, driftRate: number, spinRate: number, elevation: number, oceanic: boolean, root: Corner) {
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

    calculateMovement(position: Vector3) {
        const movement = this.driftAxis.clone().cross(position).setLength(this.driftRate * position.clone().projectOnVector(this.driftAxis).distanceTo(position));
        movement.add(this.root.position.clone().cross(position).setLength(this.spinRate * position.clone().projectOnVector(this.root.position).distanceTo(position)));
        return movement;
    }
}

export default Plate;
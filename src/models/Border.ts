import Corner from './Corner';
import Tile from './Tile';
import { Vector3 } from 'three';

class Border {
    id: number;
    corners: Corner[];
    borders: Border[];
    tiles: Tile[];
    betweenPlates: boolean;
    midpoint?: Vector3;

    constructor(id: number, cornerCount: number, borderCount: number, tileCount: number) {
        this.id = id;
        this.corners = new Array(cornerCount);
        this.borders = new Array(borderCount);
        this.tiles = new Array(tileCount);
        this.betweenPlates = false;
    }

    oppositeCorner(corner: Corner) {
        return (this.corners[0] === corner) ? this.corners[1] : this.corners[0];
    }

    oppositeTile(tile: Tile) {
        return (this.tiles[0] === tile) ? this.tiles[1] : this.tiles[0];
    }

    length() {
        return this.corners[0].position.distanceTo(this.corners[1].position);
    }

    isLandBoundary() {
        return (this.tiles[0].elevation > 0) !== (this.tiles[1].elevation > 0);
    }

    toString() {
        return `Border ${this.id.toFixed(0)}`;
    }
}

export default Border;
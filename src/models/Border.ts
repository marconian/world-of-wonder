import { Vector3 } from 'three';
import Corner from './Corner';
import Tile from './Tile';

class Border {
    id: number;
    corners: number[];
    borders: number[];
    tiles: number[];
    betweenPlates: boolean;
    midpoint?: Vector3;

    constructor(id: number, cornerCount: number, borderCount: number, tileCount: number) {
        this.id = id;
        this.corners = new Array(cornerCount);
        this.borders = new Array(borderCount);
        this.tiles = new Array(tileCount);
        this.betweenPlates = false;
    }

    oppositeCorner(corner: number) {
        return (this.corners[0] === corner) ? this.corners[1] : this.corners[0];
    }

    oppositeTile(tile: number) {
        return (this.tiles[0] === tile) ? this.tiles[1] : this.tiles[0];
    }

    length(corners: Corner[]) {
        return corners[this.corners[0]].position.distanceTo(corners[this.corners[1]].position);
    }

    isLandBoundary(tiles: Tile[]) {
        return (tiles[this.tiles[0]].elevation > 0) !== (tiles[this.tiles[1]].elevation > 0);
    }

    toString() {
        return `Border ${this.id.toFixed(0)}`;
    }

    static async revive<T extends Border | (Border | undefined)[]>(value: T, deep?: boolean): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Border)) {
                const tasks = (value as (Border | undefined)[])
                    .filter(v => v).map(v => Border.revive(v as T, deep));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Border)) {
            (value as any).__proto__ = Border.prototype;

            if (value instanceof Border) {
                if (value.midpoint) (value.midpoint as any).__proto__ = Vector3.prototype;
                
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

export default Border;
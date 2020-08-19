import { Vector3, Sphere } from 'three';
import Corner from './Corner';
import Border from './Border';
import { calculateTriangleArea } from '../utils';
import { Node } from './MeshDescription';

export type Biome = 'ocean' | 'oceanGlacier' | 'desert' | 'rainForest' | 'rocky' | 'plains' | 'grassland' | 'swamp' | 'deciduousForest' | 'tundra' | 'landGlacier' | 'coniferForest' | 'mountain' | 'snowyMountain' | 'snow';

export class Tile {
    id: number;
    position: Vector3;
    corners: number[];
    borders: (number | undefined)[];
    tiles: (number | undefined)[];
    elevation: number;
    boundingSphere: Sphere;
    averagePosition?: Vector3;
    plateMovement?: Vector3;
    normal?: Vector3;
    plate?: number;
    temperature: number;
    moisture: number;
    area: number;
    biome?: Biome;
    
    constructor(id: number, position: Vector3, cornerCount: number, borderCount: number, tileCount: number) {
        this.id = id;
        this.position = position;
        this.corners = new Array(cornerCount);
        this.borders = new Array(borderCount);
        this.tiles = new Array(tileCount);
        this.elevation = 0;
        this.temperature = 0;
        this.moisture = 0;
        this.area = 0;
        this.boundingSphere = new Sphere();
    }

    build(node: Node, tiles: Tile[], borders: Border[], corners: Corner[]) {
        for (let j = 0; j < node.f.length; j++) {
            this.corners[j] = node.f[j];
        }

        for (let j = 0; j < node.e.length; j++) {
            const border = borders[node.e[j]];
            for (let k = 0; k < this.corners.length; k++) {
                const corner0 = this.corners[k];
                const corner1 = this.corners[(k + 1) % this.corners.length];
                    
                if (border.tiles[0] === tiles.indexOf(this)) {
                    if (border.corners[1] === corner0 && border.corners[0] === corner1) {
                        border.corners[0] = corner0;
                        border.corners[1] = corner1;
                    } else if (border.corners[0] !== corner0 || border.corners[1] !== corner1) {
                        continue;
                    }
                } else {
                    if (border.corners[0] === corner0 && border.corners[1] === corner1) {
                        border.corners[1] = corner0;
                        border.corners[0] = corner1;
                    } else if (border.corners[1] !== corner0 || border.corners[0] !== corner1) {
                        continue;
                    }
                }

                this.borders[k] = node.e[j];
                this.tiles[k] = border.oppositeTile(tiles.indexOf(this));

                break;
            }
        }

        this.averagePosition = new Vector3(0, 0, 0);
        for (let j = 0; j < this.corners.length; j++) {
            this.averagePosition.add(corners[this.corners[j]].position);
        }
        this.averagePosition.multiplyScalar(1 / this.corners.length);

        let maxDistanceToCorner = 0;
        for (let j = 0; j < this.corners.length; j++) {
            maxDistanceToCorner = Math.max(maxDistanceToCorner, corners[this.corners[j]].position.distanceTo(this.averagePosition));
        }

        let area = 0;
        for (let j = 0; j < this.borders.length; j++) {
            if (this.borders[j]) {
                const border = borders[this.borders[j] as number];
                area += calculateTriangleArea(this.position, corners[border.corners[0]].position, corners[border.corners[1]].position);
            }
        }
        this.area = area;

        this.normal = this.position.clone().normalize();

        this.boundingSphere = new Sphere(this.averagePosition, maxDistanceToCorner);
    }
    
    toString() {
        return `Tile ${this.id.toFixed(0)} (${this.tiles.length.toFixed(0)} Neighbors) < ${this.position.x.toFixed(0)}, ${this.position.y.toFixed(0)}, ${this.position.z.toFixed(0)} >`;
    }

    static async revive<T extends Tile | (Tile | undefined)[]>(value: T, deep?: boolean): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Tile)) {
                const tasks = (value as (Tile | undefined)[])
                    .filter(v => v).map(v => Tile.revive(v as T, deep));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Tile)) {
            (value as any).__proto__ = Tile.prototype;

            if (value instanceof Tile) {
                if (value.position) (value.position as any).__proto__ = Vector3.prototype;
                if (value.boundingSphere) (value.boundingSphere as any).__proto__ = Sphere.prototype;
                if (value.averagePosition) (value.averagePosition as any).__proto__ = Vector3.prototype;
                if (value.plateMovement) (value.plateMovement as any).__proto__ = Vector3.prototype;
                if (value.normal) (value.normal as any).__proto__ = Vector3.prototype;
            }
        }

        return value;
    }
}

export default Tile;
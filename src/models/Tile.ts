import { Vector3, Sphere } from 'three';
import Corner from './Corner';
import Border from './Border';
import { calculateTriangleArea } from '../utils';
import Plate from './Plate';
import { Node } from './MeshDescription';

export type Biome = 'ocean' | 'oceanGlacier' | 'desert' | 'rainForest' | 'rocky' | 'plains' | 'grassland' | 'swamp' | 'deciduousForest' | 'tundra' | 'landGlacier' | 'coniferForest' | 'mountain' | 'snowyMountain' | 'snow';

export class Tile {
    id: number;
    position: Vector3;
    corners: Corner[];
    borders: (Border | undefined)[];
    tiles: (Tile | undefined)[];
    elevation: number;
    boundingSphere: Sphere;
    averagePosition?: Vector3;
    plateMovement?: Vector3;
    normal?: Vector3;
    plate?: Plate;
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

    build(node: Node, borders: Border[], corners: Corner[]) {
        for (let j = 0; j < node.f.length; j++) {
            this.corners[j] = corners[node.f[j]];
        }

        for (let j = 0; j < node.e.length; j++) {
            const border = borders[node.e[j]];
            if (border.tiles[0] === this) {
                for (let k = 0; k < this.corners.length; k++) {
                    const corner0 = this.corners[k];
                    const corner1 = this.corners[(k + 1) % this.corners.length];
                    
                    if (border.corners[1] === corner0 && border.corners[0] === corner1) {
                        border.corners[0] = corner0;
                        border.corners[1] = corner1;
                    } else if (border.corners[0] !== corner0 || border.corners[1] !== corner1) {
                        continue;
                    }

                    this.borders[k] = border;
                    this.tiles[k] = border.oppositeTile(this);

                    break;
                }
            } else {
                for (let k = 0; k < this.corners.length; k++) {
                    const corner0 = this.corners[k];
                    const corner1 = this.corners[(k + 1) % this.corners.length];

                    if (border.corners[0] === corner0 && border.corners[1] === corner1) {
                        border.corners[1] = corner0;
                        border.corners[0] = corner1;
                    } else if (border.corners[1] !== corner0 || border.corners[0] !== corner1) {
                        continue;
                    }

                    this.borders[k] = border;
                    this.tiles[k] = border.oppositeTile(this);

                    break;
                }
            }
        }

        this.averagePosition = new Vector3(0, 0, 0);
        for (let j = 0; j < this.corners.length; j++) {
            this.averagePosition.add(this.corners[j].position);
        }
        this.averagePosition.multiplyScalar(1 / this.corners.length);

        let maxDistanceToCorner = 0;
        for (let j = 0; j < this.corners.length; j++) {
            maxDistanceToCorner = Math.max(maxDistanceToCorner, this.corners[j].position.distanceTo(this.averagePosition));
        }

        let area = 0;
        for (let j = 0; j < this.borders.length; j++) {
            const border = this.borders[j];
            if (border) {
                area += calculateTriangleArea(this.position, border.corners[0].position, border.corners[1].position);
            }
        }
        this.area = area;

        this.normal = this.position.clone().normalize();

        this.boundingSphere = new Sphere(this.averagePosition, maxDistanceToCorner);
    }
    
    toString() {
        return `Tile ${this.id.toFixed(0)} (${this.tiles.length.toFixed(0)} Neighbors) < ${this.position.x.toFixed(0)}, ${this.position.y.toFixed(0)}, ${this.position.z.toFixed(0)} >`;
    }
}

export default Tile;
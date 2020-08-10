import { Vector3, Ray, Plane, Sphere } from 'three';
import Corner from './Corner';
import Border from './Border';
import { intersectRayWithSphere } from '../utils';
import Plate from './Plate';

export type Biome = 'ocean' | 'oceanGlacier' | 'desert' | 'rainForest' | 'rocky' | 'plains' | 'grassland' | 'swamp' | 'deciduousForest' | 'tundra' | 'landGlacier' | 'coniferForest' | 'mountain' | 'snowyMountain' | 'snow';

export class Tile {
    id: number;
    position: Vector3;
    corners: Corner[];
    borders: Border[];
    tiles: Tile[];
    elevation: number;
    boundingSphere?: Sphere;
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
    }

    intersectRay(ray: Ray) {
        if (this.boundingSphere && this.normal && this.averagePosition) {
            if (intersectRayWithSphere(ray, this.boundingSphere)) {
                const surface = new Plane().setFromNormalAndCoplanarPoint(this.normal, this.averagePosition);
                if (surface.distanceToPoint(ray.origin) <= 0) return false;
            
                const denominator = surface.normal.dot(ray.direction);
                if (denominator === 0) return false;
            
                const t = -(ray.origin.dot(surface.normal) + surface.constant) / denominator;
                const point = ray.direction.clone().multiplyScalar(t).add(ray.origin);
            
                const origin = new Vector3(0, 0, 0);
                for (let i = 0; i < this.corners.length; ++i) {
                    const j = (i + 1) % this.corners.length;
                    const side = new Plane().setFromCoplanarPoints(this.corners[j].position, this.corners[i].position, origin);
            
                    if (side.distanceToPoint(point) < 0) return false;
                }
            }
        }
    
        return false;
    }
    
    toString() {
        return `Tile ${this.id.toFixed(0)} (${this.tiles.length.toFixed(0)} Neighbors) < ${this.position.x.toFixed(0)}, ${this.position.y.toFixed(0)}, ${this.position.z.toFixed(0)} >`;
    }
}

export default Tile;
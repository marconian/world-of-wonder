import { Sphere, Ray } from 'three';
import Tile from './Tile';
import { intersectRayWithSphere } from '../utils';

class SpatialPartition {
    boundingSphere: Sphere;
    partitions: SpatialPartition[];
    tiles: Tile[];

    constructor(boundingSphere: Sphere, partitions: SpatialPartition[], tiles: Tile[]) {
        this.boundingSphere = boundingSphere;
        this.partitions = partitions;
        this.tiles = tiles;
    }

    intersectRay(ray: Ray): Tile | undefined {
        if (intersectRayWithSphere(ray, this.boundingSphere)) {
            for (let i = 0; i < this.partitions.length; ++i) {
                const intersection = this.partitions[i].intersectRay(ray);
                if (intersection) {
                    return intersection;
                }
            }
    
            for (let i = 0; i < this.tiles.length; ++i) {
                if (this.tiles[i].intersectRay(ray)) {
                    return this.tiles[i];
                }
            }
        }
    
        return;
    }
}

export default SpatialPartition;
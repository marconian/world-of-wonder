import { Sphere } from 'three';
import Tile from './Tile';

class SpatialPartition {
    boundingSphere: Sphere;
    partitions: SpatialPartition[];
    tiles: Tile[];

    constructor(boundingSphere: Sphere, partitions: SpatialPartition[], tiles: Tile[]) {
        this.boundingSphere = boundingSphere;
        this.partitions = partitions;
        this.tiles = tiles;
    }

    dispose() {
        this.partitions.splice(0, this.partitions.length);
        this.tiles.splice(0, this.tiles.length);
    }
}

export default SpatialPartition;
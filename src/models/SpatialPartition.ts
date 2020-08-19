import { Sphere } from 'three';

class SpatialPartition {
    boundingSphere: Sphere;
    partitions: SpatialPartition[];
    tiles: number[];

    constructor(boundingSphere: Sphere, partitions: SpatialPartition[], tiles: number[]) {
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
import Plate from './Plate';
import Topology from './Topology';
import SpatialPartition from './SpatialPartition';
import RenderData from './RenderData';
import Statistics from './Statistics';

class Planet {
    seed: number;
    originalSeed: number;
    topology?: Topology;
    partition?: SpatialPartition;
    renderData?: RenderData;
    statistics?: Statistics;
    plates: Plate[];

    constructor(seed: number) {
        this.seed = seed;
        this.plates = [];
        this.originalSeed = 0;
    }
}

export default Planet;
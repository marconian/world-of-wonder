import Corner from './Corner';
import Border from './Border';
import Tile from './Tile';

class Topology {
    corners: Corner[];
    borders: Border[];
    tiles: Tile[];

    constructor(corners: Corner[], borders: Border[], tiles: Tile[]) {
        this.corners = [...corners];
        this.borders = [...borders];
        this.tiles = [...tiles];
    }

    dispose() {
        this.corners.splice(0, this.corners.length);
        this.borders.splice(0, this.borders.length);
        this.tiles.splice(0, this.tiles.length);
    }
}

export default Topology;
import Corner from './Corner';
import Border from './Border';
import Tile from './Tile';

class Topology {
    corners: Corner[];
    borders: Border[];
    tiles: Tile[];

    constructor(cornerCount: number, borderCount: number, tileCount: number) {
        this.corners = new Array(cornerCount);
        this.borders = new Array(borderCount);
        this.tiles = new Array(tileCount);
    }
}

export default Topology;
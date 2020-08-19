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

    static async revive<T extends Topology | (Topology | undefined)[]>(value: T): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Topology)) {
                const tasks = (value as (Topology | undefined)[])
                    .filter(v => v).map(v => Topology.revive(v as T));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Topology)) {
            (value as any).__proto__ = Topology.prototype;

            if (value instanceof Topology) {
                await Promise.all([
                    Corner.revive(value.corners, false),
                    Border.revive(value.borders, false),
                    Tile.revive(value.tiles, false),
                ]);
            }
        }

        return value;
    }
}

export default Topology;
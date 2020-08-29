import { Vector3, Sphere, Color } from 'three';

export type Biome = 'ocean' | 'oceanGlacier' | 'desert' | 'rainForest' | 'rocky' | 'plains' | 'grassland' | 'swamp' | 'deciduousForest' | 'tundra' | 'landGlacier' | 'coniferForest' | 'mountain' | 'snowyMountain' | 'snow';

export class Tile {
    id: number;
    position: Vector3;
    elevation: number;
    boundingSphere: Sphere;
    plateMovement?: Vector3;
    normal?: Vector3;
    plate?: number;
    temperature: number;
    humidity: number;
    area: number;
    biome?: Biome;
    color?: Color[];
    
    constructor(id: number, position: Vector3) {
        this.id = id;
        this.position = position;
        this.elevation = 0;
        this.temperature = 0;
        this.humidity = 0;
        this.area = 0;
        this.boundingSphere = new Sphere();
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
                if (value.plateMovement) (value.plateMovement as any).__proto__ = Vector3.prototype;
                if (value.normal) (value.normal as any).__proto__ = Vector3.prototype;
            }
        }

        return value;
    }
}

export default Tile;
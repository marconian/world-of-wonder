import Corner from './Corner';
import Border from './Border';
import Tile from './Tile';
import { MeshDescription } from './MeshDescription';
import { Vector3, Sphere } from 'three';
import { calculateTriangleArea } from '../utils';

interface Relation {
    corners: number[];
    borders: number[];
    tiles: number[];
}

interface Relations {
    corners: Record<number, Relation>;
    borders: Record<number, Relation>;
    tiles: Record<number, Relation>;
}

class Topology {
    private readonly _corners: Corner[];
    private readonly _borders: Border[];
    private readonly _tiles: Tile[];

    private readonly _relations: Relations;

    constructor(mesh: MeshDescription, radius: number) {
        this._corners = [];
        this._borders = [];
        this._tiles = [];
        this._relations = {
            corners: {},
            borders: {},
            tiles: {}
        };
        
        for (let i = 0; i < mesh.faces.length; i++) {
            const face = mesh.faces[i];
            const corner = new Corner(i, face.centroid.clone().multiplyScalar(radius));

            this._corners.push(corner);

            this._relations.corners[i] = {
                corners: [],
                borders: [...face.e],
                tiles: [...face.n]
            };
        }
        
        for (let i = 0; i < mesh.edges.length; i++) {
            const edge = mesh.edges[i];
            const border = new Border(i);

            this._borders.push(border);

            this._relations.borders[i] = {
                corners: [...edge.f],
                borders: [],
                tiles: [...edge.n]
            };
            
            const midpoint = new Vector3(0, 0, 0);

            for (let j = 0; j < edge.f.length; j++) {
                const corner = this._corners[edge.f[j]];

                const borders = this._relations.corners[edge.f[j]].borders.filter(v => v !== i);
                this._relations.borders[i].borders.push(...borders);
                
                midpoint.add(corner.position);
            }

            border.midpoint = midpoint.divideScalar(edge.f.length);
        }
        
        for (let i = 0; i < mesh.nodes.length; i++) {
            const node = mesh.nodes[i];
            const tile = new Tile(i, node.p.clone().multiplyScalar(radius));
            this._tiles.push(tile);
            this._relations.tiles[i] = {
                corners: [...node.f],
                borders: [],
                tiles: []
            };
            
            const relation = this._relations.tiles[i];

            relation.borders.push(...node.e.sort(e => {
                const b = this._relations.borders[e];
                return node.f.map((c0, i) => {
                    const c1 = node.f[(i + 1) % node.f.length];
                    if ((c0 === b.corners[0] && c1 === b.corners[1]) || (c0 === b.corners[1] && c1 === b.corners[0])) {
                        return i;
                    }

                    return undefined;
                }).filter(v => v)[0] as number;
            }));

            relation.tiles.push(...relation.borders.map(v => {
                const t = this._relations.borders[v].tiles;
                return i === t[0] ? t[1] : t[0];
            }));

            for (const border of relation.borders.map(v => this._relations.borders[v]).filter(r => r.tiles[0] === i)) {
                const c = node.f.filter(f => border.corners.includes(f));
                if (border.corners[0] !== c[0]) {
                    border.corners[0] = c[0];
                    border.corners[1] = c[1];
                }
            }

            
            let maxDistanceToCorner = 0;

            tile.position  = new Vector3(0, 0, 0);
            for (const corner of relation.corners.map(c => this._corners[c])) {
                tile.position.add(corner.position);
                maxDistanceToCorner = Math.max(maxDistanceToCorner, corner.position.distanceTo(tile.position));
            }
            tile.position.divideScalar(relation.corners.length);

            tile.area = 0;
            for (const border of relation.borders.map(b => this._relations.borders[b])) {
                tile.area += calculateTriangleArea(tile.position, this._corners[border.corners[0]].position, this._corners[border.corners[1]].position);
            }
            tile.normal = tile.position.clone().normalize();
            tile.boundingSphere = new Sphere(tile.position, maxDistanceToCorner);
        }
    
        for (let i = 0; i < this._corners.length; i++) {
            const corner = this._corners[i];
            const relation = this._relations.corners[i];
            relation.corners.push(...relation.borders.map(v => {
                const c = this._relations.borders[v].corners;
                return i === c[0] ? c[1] : c[0];
            }));
            corner.area = 0;
            for (let j = 0; j < relation.tiles.length; j++) {
                corner.area += this._tiles[relation.tiles[j]].area / this._relations.tiles[relation.tiles[j]].corners.length;
            }
        }
    }

    corners(value?: Tile | Corner | Border) {
        if (value) {
            if (value instanceof Tile) {
                return this._relations.tiles[this._tiles.indexOf(value)].corners.map(v => this._corners[v]);
            } else if (value instanceof Corner) {
                return this._relations.corners[this._corners.indexOf(value)].corners.map(v => this._corners[v]);
            } else if (value instanceof Border) {
                return this._relations.borders[this._borders.indexOf(value)].corners.map(v => this._corners[v]);
            }
        }

        return this._corners;
    }

    borders(value?: Tile | Corner | Border) {
        if (value) {
            if (value instanceof Tile) {
                return this._relations.tiles[this._tiles.indexOf(value)].borders.map(v => this._borders[v]);
            } else if (value instanceof Corner) {
                return this._relations.corners[this._corners.indexOf(value)].borders.map(v => this._borders[v]);
            } else if (value instanceof Border) {
                return this._relations.borders[this._borders.indexOf(value)].borders.map(v => this._borders[v]);
            }
        }

        return this._borders;
    }

    tiles(value?: Tile | Corner | Border) {
        if (value) {
            if (value instanceof Tile) {
                return this._relations.tiles[this._tiles.indexOf(value)].tiles.map(v => this._tiles[v]);
            } else if (value instanceof Corner) {
                return this._relations.corners[this._corners.indexOf(value)].tiles.map(v => this._tiles[v]);
            } else if (value instanceof Border) {
                return this._relations.borders[this._borders.indexOf(value)].tiles.map(v => this._tiles[v]);
            }
        }

        return this._tiles;
    }

    opposite(value: Tile, border: Border): Tile;
    opposite(value: Corner, border: Border): Corner;
    opposite(value: Tile | Corner, border: Border): any {
        if (value instanceof Tile) {
            const tiles = this.tiles(border);
            return tiles[1 - tiles.indexOf(value)];
        } else if (value instanceof Corner) {
            const corners = this.corners(border);
            return corners[1 - corners.indexOf(value)];
        }
    }

    length(border: Border) {
        const corners = this.corners(border);
        return corners[0].position.distanceTo(corners[1].position);
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
                    Corner.revive(value.corners(), false),
                    Border.revive(value.borders(), false),
                    Tile.revive(value.tiles(), false),
                ]);
            }
        }

        return value;
    }

    dispose() {
        this._corners.splice(0, this._corners.length);
        this._borders.splice(0, this._borders.length);
        this._tiles.splice(0, this._tiles.length);
    }
}

export default Topology;
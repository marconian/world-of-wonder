import { Vector3, Sphere } from 'three';
import Tile from './Tile';

export class Node { 
    p: Vector3; 
    e: number[];
    f: number[];

    constructor(p: Vector3, e?: number[], f?: number[]) {
        this.p = p;
        this.e = e || [];
        this.f = f ||[];
    }
}

export class Edge { 
    n: number[];
    f: number[];
    subdivided_e: number[];
    subdivided_n: number[];

    constructor(n: number[], f?: number[]) {
        this.n = n;
        this.f = f || [];
        this.subdivided_e = [];
        this.subdivided_n = [];
    }
}

export class Face { 
    n: number[]; 
    e: number[]; 
    boundingSphere?: Sphere;
    children: Tile[];
    centroid?: Vector3;

    constructor(n: number[], e: number[]) {
        this.n = n;
        this.e = e;
        this.children = [];
    }

    release(): void {
        this.boundingSphere = undefined;
        this.children.splice(0, this.children.length);
    }
}

export interface MeshDescription {
    nodes: Node[];
    edges: Edge[];
    faces: Face[];
}
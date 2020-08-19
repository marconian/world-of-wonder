import { Vector3, Sphere } from 'three';

export class MeshDescription {
    readonly nodes: Node[] = [];
    readonly edges: Edge[] = [];
    readonly faces: Face[] = [];

    constructor(nodes: Node[], edges: Edge[], faces: Face[]) {
        this.nodes = [...nodes];
        this.edges = [...edges];
        this.faces = [...faces];
    }

    static async revive<T extends MeshDescription | (MeshDescription | undefined)[]>(value: T): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof MeshDescription)) {
                const tasks = (value as (MeshDescription | undefined)[])
                    .filter(v => v).map(v => MeshDescription.revive(v as T));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof MeshDescription)) {
            (value as any).__proto__ = MeshDescription.prototype;
            
            if (value instanceof MeshDescription) {
                await Promise.all([
                    Node.revive(value.nodes),
                    Edge.revive(value.edges),
                    Face.revive(value.faces),
                ]);
            }
        }

        return value;
    }
}

export class Node { 
    p: Vector3; 
    e: number[];
    f: number[];

    constructor(p: Vector3, e?: number[], f?: number[]) {
        this.p = p;
        this.e = e || [];
        this.f = f ||[];
    }

    static async revive<T extends Node | (Node | undefined)[]>(value: T): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Node)) {
                const tasks = (value as (Node | undefined)[])
                    .filter(v => v).map(v => Node.revive(v as T));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Node)) {
            (value as any).__proto__ = Node.prototype;

            if (value instanceof Node) {
                if (value.p) (value.p as any).__proto__ = Vector3.prototype;
            }
        }

        return value;
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

    static async revive<T extends Edge | (Edge | undefined)[]>(value: T): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Edge)) {
                const tasks = (value as (Edge | undefined)[])
                    .filter(v => v).map(v => Edge.revive(v as T));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Edge)) {
            (value as any).__proto__ = Edge.prototype;
        }

        return value;
    }
}

export class Face { 
    n: number[]; 
    e: number[]; 
    centroid: Vector3;
    children: number[];
    boundingSphere?: Sphere;

    constructor(n: number[], e: number[]) {
        this.n = n;
        this.e = e;
        this.children = [];
        this.centroid = new Vector3();
    }

    release(): void {
        this.boundingSphere = undefined;
        this.children.splice(0, this.children.length);
    }

    static async revive<T extends Face | (Face | undefined)[]>(value: T): Promise<T> {
        if (Array.isArray(value)) {
            if (value.length > 0 && !(value[0] instanceof Face)) {
                const tasks = (value as (Face | undefined)[])
                    .filter(v => v).map(v => Face.revive(v as T));
                await Promise.all(tasks);
            }
        } else if (!(value instanceof Face)) {
            (value as any).__proto__ = Face.prototype;

            if (value instanceof Face) {
                if (value.centroid) (value.centroid as any).__proto__ = Vector3.prototype;
                if (value.boundingSphere) (value.boundingSphere as any).__proto__ = Sphere.prototype;
                //await Tile.revive(value.children);
            }
        }

        return value;
    }
}
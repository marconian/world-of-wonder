import { Vector3, Sphere, Plane } from 'three';
import Tile from './Tile';
import XorShift128 from '../utils/XorShift128';
import { slerp } from '../utils';

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

export class MeshDescription {
    readonly nodes: Node[] = [];
    readonly edges: Edge[] = [];
    readonly faces: Face[] = [];

    readonly random: XorShift128;

    constructor(random?: XorShift128) {
        this.random = random || new XorShift128(0, 0, 0, 0);
    }
    
    async build(subdivisions: number, distortion: number) {
        this.icosahedron();
        this.subdivide(subdivisions);
        
        let totalDistortion = Math.ceil(this.edges.length * distortion);
        for (let i = 6; i > 0; i--) {
        
            const iterationDistortion = Math.floor(totalDistortion / i);
            totalDistortion -= iterationDistortion;
            
            await this.distort(iterationDistortion);
            await this.relax(0.5);
        }
        
        const averageNodeRadius = Math.sqrt(4 * Math.PI / this.nodes.length);
        const minShiftDelta = averageNodeRadius / 50000 * this.nodes.length;
        //const maxShiftDelta = averageNodeRadius / 50 * this.nodes.length;

        let priorShift: number;
        let currentShift: number = await this.relax(0.5);
        
        for (let i = 0; i < 300; i++) {
            priorShift = currentShift;
            currentShift = await this.relax(0.5);
            const shiftDelta = Math.abs(currentShift - priorShift);
            if (shiftDelta < minShiftDelta) { //shiftDelta >= minShiftDelta && action.intervalIteration - initialIntervalIteration < 300
                break; //const progress = Math.pow(Math.max(0, (maxShiftDelta - shiftDelta) / (maxShiftDelta - minShiftDelta)), 4);
            }
        }

        for (let i = 0; i < this.faces.length; i++) {
            const face = this.faces[i];
            const p0 = this.nodes[face.n[0]].p;
            const p1 = this.nodes[face.n[1]].p;
            const p2 = this.nodes[face.n[2]].p;
            face.centroid = this.calculateFaceCentroid(p0, p1, p2).multiplyScalar(-1000);
        }

        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            let faceIndex = node.f[0];
            for (let j = 1; j < node.f.length - 1; j++) {
                faceIndex = this.findNextFaceIndex(i, faceIndex);
                const k = node.f.indexOf(faceIndex);
                node.f[k] = node.f[j];
                node.f[j] = faceIndex;
            }
        }

        return this;
    }
    
    icosahedron(): MeshDescription {
        const phi = (1.0 + Math.sqrt(5.0)) / 2.0;
        const du = 1.0 / Math.sqrt(phi * phi + 1.0);
        const dv = phi * du;

        this.nodes.splice(0, this.nodes.length);
        this.nodes.push(
            new Node(new Vector3(0, +dv, +du)),
            new Node(new Vector3(0, +dv, -du)),
            new Node(new Vector3(0, -dv, +du)),
            new Node(new Vector3(0, -dv, -du)),
            new Node(new Vector3(+du, 0, +dv)),
            new Node(new Vector3(-du, 0, +dv)),
            new Node(new Vector3(+du, 0, -dv)),
            new Node(new Vector3(-du, 0, -dv)),
            new Node(new Vector3(+dv, +du, 0)),
            new Node(new Vector3(+dv, -du, 0)),
            new Node(new Vector3(-dv, +du, 0)),
            new Node(new Vector3(-dv, -du, 0))
        );
    
        this.edges.splice(0, this.edges.length);
        this.edges.push(
            new Edge([0, 1]), 
            new Edge([0, 4]), 
            new Edge([0, 5]), 
            new Edge([0, 8]), 
            new Edge([0, 10]), 
            new Edge([1, 6]), 
            new Edge([1, 7]), 
            new Edge([1, 8]), 
            new Edge([1, 10]), 
            new Edge([2, 3]), 
            new Edge([2, 4]), 
            new Edge([2, 5]), 
            new Edge([2, 9]), 
            new Edge([2, 11]), 
            new Edge([3, 6]), 
            new Edge([3, 7]), 
            new Edge([3, 9]), 
            new Edge([3, 11]), 
            new Edge([4, 5]), 
            new Edge([4, 8]), 
            new Edge([4, 9]), 
            new Edge([5, 10]), 
            new Edge([5, 11]), 
            new Edge([6, 7]), 
            new Edge([6, 8]), 
            new Edge([6, 9]), 
            new Edge([7, 10]), 
            new Edge([7, 11]), 
            new Edge([8, 9]), 
            new Edge([10, 11])
        );
    
        this.faces.splice(0, this.faces.length);
        this.faces.push(
            new Face([0, 1, 8], [0, 7, 3]),
            new Face([0, 4, 5], [1, 18, 2]),
            new Face([0, 5, 10], [2, 21, 4]),
            new Face([0, 8, 4], [3, 19, 1]),
            new Face([0, 10, 1], [4, 8, 0]),
            new Face([1, 6, 8], [5, 24, 7]),
            new Face([1, 7, 6], [6, 23, 5]),
            new Face([1, 10, 7], [8, 26, 6]),
            new Face([2, 3, 11], [9, 17, 13]),
            new Face([2, 4, 9], [10, 20, 12]),
            new Face([2, 5, 4], [11, 18, 10]),
            new Face([2, 9, 3], [12, 16, 9]),
            new Face([2, 11, 5], [13, 22, 11]),
            new Face([3, 6, 7], [14, 23, 15]),
            new Face([3, 7, 11], [15, 27, 17]),
            new Face([3, 9, 6], [16, 25, 14]),
            new Face([4, 8, 9], [19, 28, 20]),
            new Face([5, 11, 10], [22, 29, 21]),
            new Face([6, 9, 8], [25, 28, 24]),
            new Face([7, 10, 11], [26, 29, 27])
        );
    
        for (let i = 0; i < this.edges.length; i++)
            for (let j = 0; j < this.edges[i].n.length; j++)
                this.nodes[j].e.push(i);
    
        for (let i = 0; i < this.faces.length; i++)
            for (let j = 0; j < this.faces[i].n.length; j++)
                this.nodes[j].f.push(i);
    
        for (let i = 0; i < this.faces.length; i++)
            for (let j = 0; j < this.faces[i].e.length; j++)
                this.edges[j].f.push(i);

        return this;
    }
    
    private subdivide(degree: number): void {
        const nodes: Node[] = [];
        for (let i = 0; i < this.nodes.length; i++) {
            nodes.push(new Node(this.nodes[i].p));
        }
    
        const edges: Edge[] = [];
        for (let i = 0; i < this.edges.length; i++) {
            const edge = this.edges[i];
            edge.subdivided_n = [];
            edge.subdivided_e = [];

            const n0 = this.nodes[edge.n[0]];
            const n1 = this.nodes[edge.n[1]];
            const p0 = n0.p;
            const p1 = n1.p;

            nodes[edge.n[0]].e.push(edges.length);

            let priorNodeIndex = edge.n[0];
            for (let s = 1; s < degree; s++) {
                const edgeIndex = edges.length;
                const nodeIndex = nodes.length;

                edge.subdivided_e.push(edgeIndex);
                edge.subdivided_n.push(nodeIndex);

                edges.push(new Edge([priorNodeIndex, nodeIndex]));
                nodes.push(new Node(slerp(p0, p1, s / degree), [edgeIndex, edgeIndex + 1]));

                priorNodeIndex = nodeIndex;
            }

            edge.subdivided_e.push(edges.length);
            nodes[edge.n[1]].e.push(edges.length);
            edges.push(new Edge([priorNodeIndex, edge.n[1]]));
        }
    
        const faces: Face[] = [];
        for (let i = 0; i < this.faces.length; i++) {
            const face = this.faces[i];
            const edge0 = this.edges[face.e[0]];

            const getEdgeNode = (e: number, k: number) => {
                const edge = this.edges[face.e[e]];
                return edge.subdivided_n[face.n[e % 2] === edge.n[0] ? k : degree - 2 - k];
            };
    
            const faceNodes: number[] = [];
            faceNodes.push(face.n[0]);
            for (let j = 0; j < edge0.subdivided_n.length; j++)
                faceNodes.push(getEdgeNode(0, j));

            faceNodes.push(face.n[1]);
            for (let s = 1; s < degree; s++) {
                faceNodes.push(getEdgeNode(2, s - 1));

                const p0 = nodes[getEdgeNode(2, s - 1)].p;
                const p1 = nodes[getEdgeNode(1, s - 1)].p;

                for (let t = 1; t < degree - s; t++) {
                    faceNodes.push(nodes.length);
                    nodes.push(new Node(slerp(p0, p1, t / (degree - s))));
                }

                faceNodes.push(getEdgeNode(1, s - 1));
            }

            faceNodes.push(face.n[2]);

            const getEdgeEdge = (e: number, k: number) => {
                const edge = this.edges[face.e[e]];
                return edge.subdivided_e[face.n[e % 2] === edge.n[0] ? k : degree - 1 - k];
            };
    
            const faceEdges0 = [];
            for (let j = 0; j < degree; j++)
                faceEdges0.push(getEdgeEdge(0, j));

            let nodeIndex = degree + 1;
            for (let s = 1; s < degree; s++) {
                for (let t = 0; t < degree - s; t++) {
                    faceEdges0.push(edges.length);

                    const edge = new Edge([faceNodes[nodeIndex], faceNodes[nodeIndex + 1]]);
                    nodes[edge.n[0]].e.push(edges.length);
                    nodes[edge.n[1]].e.push(edges.length);

                    edges.push(edge);

                    nodeIndex++;
                }

                nodeIndex++;
            }
    
            const faceEdges1 = [];
            nodeIndex = 1;
            for (let s = 0; s < degree; s++) {
                for (let t = 1; t < degree - s; t++) {
                    faceEdges1.push(edges.length);

                    const edge = new Edge([faceNodes[nodeIndex], faceNodes[nodeIndex + degree - s]]);
                    nodes[edge.n[0]].e.push(edges.length);
                    nodes[edge.n[1]].e.push(edges.length);

                    edges.push(edge);

                    nodeIndex++;
                }

                faceEdges1.push(getEdgeEdge(1, s));

                nodeIndex += 2;
            }
    
            const faceEdges2 = [];
            nodeIndex = 1;
            for (let s = 0; s < degree; s++) {
                faceEdges2.push(getEdgeEdge(2, s));

                for (let t = 1; t < degree - s; t++) {
                    faceEdges2.push(edges.length);

                    const edge = new Edge([faceNodes[nodeIndex], faceNodes[nodeIndex + degree - s + 1]]);
                    nodes[edge.n[0]].e.push(edges.length);
                    nodes[edge.n[1]].e.push(edges.length);

                    edges.push(edge);

                    nodeIndex++;
                }

                nodeIndex += 2;
            }
    
            nodeIndex = 0;
            let edgeIndex = 0;
            for (let s = 0; s < degree; s++) {
                for (let t = 1; t < degree - s + 1; t++) {
                    const subFace: Face = new Face(
                        [faceNodes[nodeIndex], faceNodes[nodeIndex + 1], faceNodes[nodeIndex + degree - s + 1]],
                        [faceEdges0[edgeIndex], faceEdges1[edgeIndex], faceEdges2[edgeIndex]],
                    );

                    nodes[subFace.n[0]].f.push(faces.length);
                    nodes[subFace.n[1]].f.push(faces.length);
                    nodes[subFace.n[2]].f.push(faces.length);

                    edges[subFace.e[0]].f.push(faces.length);
                    edges[subFace.e[1]].f.push(faces.length);
                    edges[subFace.e[2]].f.push(faces.length);

                    faces.push(subFace);

                    nodeIndex++;
                    edgeIndex++;
                }
                nodeIndex++;
            }
    
            nodeIndex = 1;
            edgeIndex = 0;
            for (let s = 1; s < degree; s++) {
                for (let t = 1; t < degree - s + 1; t++) {
                    const subFace = new Face(
                        [faceNodes[nodeIndex], faceNodes[nodeIndex + degree - s + 2], faceNodes[nodeIndex + degree - s + 1]],
                        [faceEdges2[edgeIndex + 1], faceEdges0[edgeIndex + degree - s + 1], faceEdges1[edgeIndex]],
                    );

                    nodes[subFace.n[0]].f.push(faces.length);
                    nodes[subFace.n[1]].f.push(faces.length);
                    nodes[subFace.n[2]].f.push(faces.length);

                    edges[subFace.e[0]].f.push(faces.length);
                    edges[subFace.e[1]].f.push(faces.length);
                    edges[subFace.e[2]].f.push(faces.length);

                    faces.push(subFace);

                    nodeIndex++;
                    edgeIndex++;
                }

                nodeIndex += 2;
                edgeIndex += 1;
            }
        }
    
        this.nodes.splice(0, this.nodes.length);
        this.edges.splice(0, this.edges.length);
        this.faces.splice(0, this.faces.length);

        this.nodes.push(...nodes);
        this.edges.push(...edges);
        this.faces.push(...faces);
    }
    
    private async distort(degree: number) {    
        const rotationPredicate = (oldNode0: Node, oldNode1: Node, newNode0: Node, newNode1: Node) => {
            if (newNode0.f.length >= 7 ||
                newNode1.f.length >= 7 ||
                oldNode0.f.length <= 5 ||
                oldNode1.f.length <= 5) return false;
            const oldEdgeLength = oldNode0.p.distanceTo(oldNode1.p);
            const newEdgeLength = newNode0.p.distanceTo(newNode1.p);
            const ratio = oldEdgeLength / newEdgeLength;
            if (ratio >= 2 || ratio <= 0.5) return false;
            const v0 = oldNode1.p.clone().sub(oldNode0.p).divideScalar(oldEdgeLength);
            const v1 = newNode0.p.clone().sub(oldNode0.p).normalize();
            const v2 = newNode1.p.clone().sub(oldNode0.p).normalize();
            if (v0.dot(v1) < 0.2 || v0.dot(v2) < 0.2) return false;
            v0.negate();
            const v3 = newNode0.p.clone().sub(oldNode1.p).normalize();
            const v4 = newNode1.p.clone().sub(oldNode1.p).normalize();
            if (v0.dot(v3) < 0.2 || v0.dot(v4) < 0.2) return false;
            return true;
        };

        const tasks: Promise<void>[] = [];
        for (let i = 0; i < degree; i++) {
            tasks.push(new Promise((resolve) => {
                let consecutiveFailedAttempts = 0;
                let edgeIndex = this.random.integerExclusive(0, this.edges.length);
                while (!this.conditionalRotateEdge(edgeIndex, rotationPredicate)) {
                    if (consecutiveFailedAttempts++ >= this.edges.length) return; // return false;
                    edgeIndex = (edgeIndex + 1) % this.edges.length;
                }

                resolve();
            }));
        }
        
        await Promise.all(tasks);
    }
    
    private async relax(multiplier: number) {
        const totalSurfaceArea = 4 * Math.PI;
        const idealFaceArea = totalSurfaceArea / this.faces.length;
        const idealEdgeLength = Math.sqrt(idealFaceArea * 4 / Math.sqrt(3));
        const idealDistanceToCentroid = idealEdgeLength * Math.sqrt(3) / 3 * 0.9;
    
        const pointShifts = this.nodes.map(() => new Vector3(0, 0, 0));
        
        const tasks: Promise<void>[] = [];
        for (let i = 0; i < this.faces.length; i++) {
            tasks.push(new Promise((resolve) => {
                const face = this.faces[i];
                const n0 = this.nodes[face.n[0]];
                const n1 = this.nodes[face.n[1]];
                const n2 = this.nodes[face.n[2]];
                const p0 = n0.p;
                const p1 = n1.p;
                const p2 = n2.p;
                const centroid = this.calculateFaceCentroid(p0, p1, p2);//.normalize();
                const v0 = centroid.clone().sub(p0);
                const v1 = centroid.clone().sub(p1);
                const v2 = centroid.clone().sub(p2);
                const length0 = v0.length();
                const length1 = v1.length();
                const length2 = v2.length();
                v0.multiplyScalar(multiplier * (length0 - idealDistanceToCentroid) / length0);
                v1.multiplyScalar(multiplier * (length1 - idealDistanceToCentroid) / length1);
                v2.multiplyScalar(multiplier * (length2 - idealDistanceToCentroid) / length2);
                pointShifts[face.n[0]].add(v0);
                pointShifts[face.n[1]].add(v1);
                pointShifts[face.n[2]].add(v2);

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
    
        const origin = new Vector3(0, 0, 0);
        const plane = new Plane();
        for (let i = 0; i < this.nodes.length; i++) {
            tasks.push(new Promise((resolve) => {
                plane.setFromNormalAndCoplanarPoint(this.nodes[i].p, origin);
                pointShifts[i] = this.nodes[i].p.clone().add(plane.projectPoint(pointShifts[i], origin)).normalize();

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
    
        const rotationSupressions = this.nodes.map(() => 0);

        for (let i = 0; i < this.nodes.length; i++) {
            tasks.push(new Promise((resolve) => {
                const edge = this.edges[i];
                const oldPoint0 = this.nodes[edge.n[0]].p;
                const oldPoint1 = this.nodes[edge.n[1]].p;
                const newPoint0 = pointShifts[edge.n[0]];
                const newPoint1 = pointShifts[edge.n[1]];
                const oldVector = oldPoint1.clone().sub(oldPoint0).normalize();
                const newVector = newPoint1.clone().sub(newPoint0).normalize();
                const suppression = (1 - oldVector.dot(newVector)) * 0.5;
                rotationSupressions[edge.n[0]] = Math.max(rotationSupressions[edge.n[0]], suppression);
                rotationSupressions[edge.n[1]] = Math.max(rotationSupressions[edge.n[1]], suppression);

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        const tasks2: Promise<number>[] = [];

        for (let i = 0; i < this.nodes.length; i++) {
            tasks2.push(new Promise((resolve) => {
                const node = this.nodes[i];
                const point = node.p;
                const delta = point.clone();
                point.lerp(pointShifts[i], 1 - Math.sqrt(rotationSupressions[i])).normalize();
                delta.sub(point);

                resolve(delta.length());
            }));
        }
        
        const shifts = await Promise.all(tasks2);
        tasks2.splice(0, tasks2.length);
    
        const totalShift = shifts.reduce((a, b) => a + b);
    
        return totalShift;
    }
    
    private calculateFaceCentroid(pa: Vector3, pb: Vector3, pc: Vector3) {
        const x = (pa.x + pb.x + pc.x) / 3.;
        const y = (pa.y + pb.y + pc.y) / 3.;
        const z = (pa.z + pb.z + pc.z) / 3.;

        return new Vector3(x, y, z);
    }
    
    private conditionalRotateEdge(edgeIndex: number, predicate: (oldNode0: Node, oldNode1: Node, newNode0: Node, newNode1: Node) => boolean): boolean {
        const edge = this.edges[edgeIndex];
        const face0 = this.faces[edge.f[0]];
        const face1 = this.faces[edge.f[1]];
        const farNodeFaceIndex0 = this.getFaceOppositeNodeIndex(face0, edge);
        const farNodeFaceIndex1 = this.getFaceOppositeNodeIndex(face1, edge);
        const newNodeIndex0 = face0.n[farNodeFaceIndex0];
        const oldNodeIndex0 = face0.n[(farNodeFaceIndex0 + 1) % 3];
        const newNodeIndex1 = face1.n[farNodeFaceIndex1];
        const oldNodeIndex1 = face1.n[(farNodeFaceIndex1 + 1) % 3];
        const oldNode0 = this.nodes[oldNodeIndex0];
        const oldNode1 = this.nodes[oldNodeIndex1];
        const newNode0 = this.nodes[newNodeIndex0];
        const newNode1 = this.nodes[newNodeIndex1];
        const newEdgeIndex0 = face1.e[(farNodeFaceIndex1 + 2) % 3];
        const newEdgeIndex1 = face0.e[(farNodeFaceIndex0 + 2) % 3];
        const newEdge0 = this.edges[newEdgeIndex0];
        const newEdge1 = this.edges[newEdgeIndex1];
    
        if (!predicate(oldNode0, oldNode1, newNode0, newNode1)) return false;
    
        oldNode0.e.splice(oldNode0.e.indexOf(edgeIndex), 1);
        oldNode1.e.splice(oldNode1.e.indexOf(edgeIndex), 1);
        newNode0.e.push(edgeIndex);
        newNode1.e.push(edgeIndex);
    
        edge.n[0] = newNodeIndex0;
        edge.n[1] = newNodeIndex1;
    
        newEdge0.f.splice(newEdge0.f.indexOf(edge.f[1]), 1);
        newEdge1.f.splice(newEdge1.f.indexOf(edge.f[0]), 1);
        newEdge0.f.push(edge.f[0]);
        newEdge1.f.push(edge.f[1]);
    
        oldNode0.f.splice(oldNode0.f.indexOf(edge.f[1]), 1);
        oldNode1.f.splice(oldNode1.f.indexOf(edge.f[0]), 1);
        newNode0.f.push(edge.f[1]);
        newNode1.f.push(edge.f[0]);
    
        face0.n[(farNodeFaceIndex0 + 2) % 3] = newNodeIndex1;
        face1.n[(farNodeFaceIndex1 + 2) % 3] = newNodeIndex0;
    
        face0.e[(farNodeFaceIndex0 + 1) % 3] = newEdgeIndex0;
        face1.e[(farNodeFaceIndex1 + 1) % 3] = newEdgeIndex1;
        face0.e[(farNodeFaceIndex0 + 2) % 3] = edgeIndex;
        face1.e[(farNodeFaceIndex1 + 2) % 3] = edgeIndex;
    
        return true;
    }
    
    private getEdgeOppositeFaceIndex(edge: Edge, faceIndex: number) {
        if (edge.f[0] === faceIndex) return edge.f[1];
        if (edge.f[1] === faceIndex) return edge.f[0];

        // eslint-disable-next-line no-throw-literal
        throw 'Given face is not part of given edge.';
    }
    
    private getFaceOppositeNodeIndex(face: Face, edge: Edge) {
        if (face.n[0] !== edge.n[0] && face.n[0] !== edge.n[1]) return 0;
        if (face.n[1] !== edge.n[0] && face.n[1] !== edge.n[1]) return 1;
        if (face.n[2] !== edge.n[0] && face.n[2] !== edge.n[1]) return 2;

        // eslint-disable-next-line no-throw-literal
        throw 'Cannot find node of given face that is not also a node of given edge.';
    }
    
    private findNextFaceIndex(nodeIndex: number, faceIndex: number) {
        const face = this.faces[faceIndex];
        const nodeFaceIndex = face.n.indexOf(nodeIndex);
        const edge = this.edges[face.e[(nodeFaceIndex + 2) % 3]];

        return this.getEdgeOppositeFaceIndex(edge, faceIndex);
    }
}
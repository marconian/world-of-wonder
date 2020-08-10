/* eslint-disable no-throw-literal */
import React, { Component } from 'react';
import { Scene, PerspectiveCamera, BoxGeometry, MeshBasicMaterial, Mesh, WebGLRenderer, Camera, AmbientLight, DirectionalLight, Vector3, Color, Geometry, Face3, Sphere, MeshLambertMaterial, Plane, Matrix4, Euler } from 'three';
import SteppedAction from './utils/SteppedAction';
import Planet from './models/Planet';
import { MeshDescription, Edge, Node, Face } from './models/MeshDescription';
import './App.scss';
import XorShift128 from './utils/XorShift128';
import Corner from './models/Corner';
import Border from './models/Border';
import Tile from './models/Tile';
import { slerp, adjustRange, hashString, calculateTriangleArea, randomUnitVector } from './utils';
import SpatialPartition from './models/SpatialPartition';
import Plate from './models/Plate';
import Topology from './models/Topology';
import Whorl from './models/Whorl';
import Statistics, { StatisticsItem } from './models/Statistics';
import RenderData, { RenderSurface, RenderPlateBoundaries, RenderPlateMovement, RenderAirCurrents } from './models/RenderData';

interface AppState {
    subdivisions: number;
    distortionLevel: number;
    plateCount: number;
    oceanicRate: number;
    heatLevel: number;
    moistureLevel: number;
    seed: number;
}

interface ElevationBorderQueueItem {
    border: Border;
    corner: Corner;
    nextCorner: Corner;
    distanceToPlateBoundary: number;
    origin: {
        corner: Corner;
        pressure: number;
        shear: number;
        plate: Plate;
        calculateElevation: (distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number, pressure: number, shear: number) => number;
    }
}

interface AirHeatResult {
    corners: Corner[];
    airHeat: number;
}

interface AirMoistureResult {
    corners: Corner[];
    airMoisture: number;
}

interface TileSelection {
    tile: Tile;
    renderObject: Mesh;
}

const KEY: Record<string, number> = {};
for (let k = 0; k < 10; ++k) KEY[String.fromCharCode(k + 48)] = k + 48;
for (let k = 0; k < 26; ++k) KEY[String.fromCharCode(k + 65)] = k + 65;

// const KEY_ENTER = 13;
// const KEY_SHIFT = 16;
// const KEY_ESCAPE = 27;
// const KEY_SPACE = 32;
const KEY_LEFTARROW = 37;
const KEY_UPARROW = 38;
const KEY_RIGHTARROW = 39;
const KEY_DOWNARROW = 40;
const KEY_PAGEUP = 33;
const KEY_PAGEDOWN = 34;
const KEY_NUMPAD_PLUS = 107;
const KEY_NUMPAD_MINUS = 109;
// const KEY_FORWARD_SLASH = 191;

class App extends Component<{}, AppState> {
    sceneNode?: HTMLCanvasElement | null;
    renderer?: WebGLRenderer
    scene: Scene;
    camera: Camera;
    directionalLight: DirectionalLight;
    activeAction?: SteppedAction;
    
    planet?: Planet;
    tileSelection?: TileSelection;
    zoom = 1.0;
    zoomAnimationStartTime?: number;
    zoomAnimationDuration?: number;
    zoomAnimationStartValue?: number;
    zoomAnimationEndValue?: number;
    lastRenderFrameTime?: number;
    cameraLatitude = 0;
    cameraLongitude = 0;
    surfaceRenderMode = 'terrain';
    renderSunlight = true;
    renderPlateBoundaries = false;
    renderPlateMovements = false;
    renderAirCurrents = false;
    sunTimeOffset = 0;
    pressedKeys: Record<string, string> = {};
    disableKeys = false;

    constructor(props: {}) {
        super(props);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(75, 1, 0.2, 2000);

        this.directionalLight = new DirectionalLight(0xFFFFFF);
        this.directionalLight.position.set(-3, 3, 7).normalize();

        this.state = {
            subdivisions: 20,
            distortionLevel: 1,
            plateCount: 36,
            oceanicRate: 0.7,
            heatLevel: 1.0,
            moistureLevel: 1.0,
            seed: 0,
        };
    }

    componentDidMount(): void {
        const geometry = new BoxGeometry();
        const material = new MeshBasicMaterial({ color: 0x00ff00 });
        const cube = new Mesh(geometry, material);

        this.scene.add(cube);

        this.camera.position.z = 5;
        
        if (this.sceneNode) {
            this.renderer = new WebGLRenderer({
                canvas: this.sceneNode,
                antialias: true,
                alpha: true
            });

            //this.renderer.setFaceCulling(CullFaceFront, FrontFaceDirectionCW);
        
            const ambientLight = new AmbientLight(0xFFFFFF);
            this.scene.add(ambientLight);
            this.scene.add(this.directionalLight);

            this.animate();

            this.resetCamera();
            this.updateCamera();
            
            this.setSurfaceRenderMode(this.surfaceRenderMode, true);
            this.showHideSunlight(this.renderSunlight);
            this.showHidePlateBoundaries(this.renderPlateBoundaries);
            this.showHidePlateMovements(this.renderPlateMovements);
            this.showHideAirCurrents(this.renderAirCurrents);

            this.generatePlanetAsynchronous();
        }
    }

    render(): JSX.Element {
        return (
            <div className="app">
                <canvas className="scene" width={window.innerWidth} height={window.innerHeight} ref={(node) => this.sceneNode = node} />
            </div>
        );
    }

    generatePlanetAsynchronous() {
        let planet: Planet | undefined;
    
        const subdivisions = this.state.subdivisions;
    
        let distortionRate: number;
        if (this.state.distortionLevel < 0.25) distortionRate = adjustRange(this.state.distortionLevel, 0.00, 0.25, 0.000, 0.040);
        else if (this.state.distortionLevel < 0.50) distortionRate = adjustRange(this.state.distortionLevel, 0.25, 0.50, 0.040, 0.050);
        else if (this.state.distortionLevel < 0.75) distortionRate = adjustRange(this.state.distortionLevel, 0.50, 0.75, 0.050, 0.075);
        else distortionRate = adjustRange(this.state.distortionLevel, 0.75, 1.00, 0.075, 0.150);
    
        const originalSeed = this.state.seed;
        let seed: number;
        if (typeof (originalSeed) === 'number') seed = originalSeed;
        else if (typeof (originalSeed) === 'string') seed = hashString(originalSeed);
        else seed = Date.now();
        const random = new XorShift128(seed, 0, 0, 0);
    
        const plateCount = this.state.plateCount;
        const oceanicRate = this.state.oceanicRate;
        const heatLevel = this.state.heatLevel;
        const moistureLevel = this.state.moistureLevel;
    
        this.activeAction = new SteppedAction()
            .executeSubaction((action) => {
                this.generatePlanet(subdivisions, distortionRate, plateCount, oceanicRate, heatLevel, moistureLevel, random, action);
            }, 0, 'Generating Planet')
            .getResult<Planet>((result) => {
                planet = result;
                if (planet) {
                    planet.seed = seed;
                    planet.originalSeed = originalSeed;
                }
            })
            .executeSubaction(() => {
                if (planet) {
                    this.displayPlanet(planet);
                    //this.setSeed(null);
                }
            }, 0)
            .finalize(() => {
                this.activeAction = undefined;
                //ui.progressPanel.hide();
            })
            .execute();
    }

    generatePlanet(icosahedronSubdivision: number, topologyDistortionRate: number, plateCount: number, oceanicRate: number, heatLevel: number, moistureLevel: number, random: XorShift128, action: SteppedAction) {
        const planet = new Planet(this.state.seed);

        let mesh: MeshDescription | undefined;

        action
            .executeSubaction((action) => {
                this.generatePlanetMesh(icosahedronSubdivision, topologyDistortionRate, random, action);
            }, 6, 'Generating Mesh')
            .getResult<MeshDescription>((result) => mesh = result)
            .executeSubaction((action) => {
                if (mesh) {
                    this.generatePlanetTopology(mesh, action);
                }
            }, 1, 'Generating Topology')
            .getResult<Topology>((result) => planet.topology = result)
            .executeSubaction((action) => {
                if (planet.topology) {
                    this.generatePlanetPartition(planet.topology.tiles, action);
                }
            }, 1, 'Generating Spatial Partitions')
            .getResult<SpatialPartition>((result) => planet.partition = result)
            .executeSubaction((action) => {
                this.generatePlanetTerrain(planet, plateCount, oceanicRate, heatLevel, moistureLevel, random, action);
            }, 8, 'Generating Terrain')
            .executeSubaction((action) => {
                if (planet.topology) {
                    this.generatePlanetRenderData(planet.topology, random, action);
                }
            }, 1, 'Building Visuals')
            .getResult<RenderData>((result) => planet.renderData = result)
            .executeSubaction((action) => {
                if (planet.topology) {
                    this.generatePlanetStatistics(planet.topology, planet.plates, action);
                }
            }, 1, 'Compiling Statistics')
            .getResult<Statistics>((result) => planet.statistics = result)
            .provideResult<Planet>(planet);
    }
    
    generatePlanetMesh(icosahedronSubdivision: number, topologyDistortionRate: number, random: XorShift128, action: SteppedAction) {
        let mesh: MeshDescription | undefined;

        action.executeSubaction(() => {
            mesh = this.generateSubdividedIcosahedron(icosahedronSubdivision);
        }, 1, 'Generating Subdivided Icosahedron');
    
        action.executeSubaction((action) => {
            if (mesh) {
                let totalDistortion = Math.ceil(mesh.edges.length * topologyDistortionRate);
                let remainingIterations = 6;
                action.executeSubaction((action) => {
                    const iterationDistortion = Math.floor(totalDistortion / remainingIterations);
                    totalDistortion -= iterationDistortion;
                    action.executeSubaction((action) => {
                        if (mesh) {
                            this.distortMesh(mesh, iterationDistortion, random, action);
                        }
                    });
                    action.executeSubaction((action) => {
                        if (mesh) {
                            this.relaxMesh(mesh, 0.5, action);
                        }
                    });
                    --remainingIterations;
                    if (remainingIterations > 0) action.loop(1 - remainingIterations / 6);
                });
            }
        }, 15, 'Distorting Triangle Mesh');
    
        action.executeSubaction((action) => {
            if (mesh) {
                const initialIntervalIteration = action.intervalIteration;
        
                const averageNodeRadius = Math.sqrt(4 * Math.PI / mesh.nodes.length);
                const minShiftDelta = averageNodeRadius / 50000 * mesh.nodes.length;
                const maxShiftDelta = averageNodeRadius / 50 * mesh.nodes.length;
        
                let priorShift;
                let currentShift = this.relaxMesh(mesh, 0.5, action);
                action.executeSubaction((action) => {
                    if (mesh) {
                        priorShift = currentShift;
                        currentShift = this.relaxMesh(mesh, 0.5, action);
                        const shiftDelta = Math.abs(currentShift - priorShift);
                        if (shiftDelta >= minShiftDelta && action.intervalIteration - initialIntervalIteration < 300) {
                            action.loop(Math.pow(Math.max(0, (maxShiftDelta - shiftDelta) / (maxShiftDelta - minShiftDelta)), 4));
                        }
                    }
                });
            }
        }, 25, 'Relaxing Triangle Mesh');
    
        action.executeSubaction(() => {
            if (mesh) {
                for (let i = 0; i < mesh.faces.length; ++i) {
                    const face = mesh.faces[i];
                    const p0 = mesh.nodes[face.n[0]].p;
                    const p1 = mesh.nodes[face.n[1]].p;
                    const p2 = mesh.nodes[face.n[2]].p;
                    face.centroid = this.calculateFaceCentroid(p0, p1, p2).normalize();
                }
            }
        }, 1, 'Calculating Triangle Centroids');
    
        action.executeSubaction(() => {
            if (mesh) {
                for (let i = 0; i < mesh.nodes.length; ++i) {
                    const node = mesh.nodes[i];
                    let faceIndex = node.f[0];
                    for (let j = 1; j < node.f.length - 1; ++j) {
                        faceIndex = this.findNextFaceIndex(mesh, i, faceIndex);
                        const k = node.f.indexOf(faceIndex);
                        node.f[k] = node.f[j];
                        node.f[j] = faceIndex;
                    }
                }
            }
        }, 1, 'Reordering Triangle Nodes');
    
        action.provideResult<MeshDescription | undefined>(mesh);
    }
    
    generateIcosahedron(): MeshDescription {
        const phi = (1.0 + Math.sqrt(5.0)) / 2.0;
        const du = 1.0 / Math.sqrt(phi * phi + 1.0);
        const dv = phi * du;
    
        const nodes: Node[] = [
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
        ];
    
        const edges: Edge[] = [
            new Edge([0, 1, ]), 
            new Edge([0, 4, ]), 
            new Edge([0, 5, ]), 
            new Edge([0, 8, ]), 
            new Edge([0, 10, ]), 
            new Edge([1, 6, ]), 
            new Edge([1, 7, ]), 
            new Edge([1, 8, ]), 
            new Edge([1, 10, ]), 
            new Edge([2, 3, ]), 
            new Edge([2, 4, ]), 
            new Edge([2, 5, ]), 
            new Edge([2, 9, ]), 
            new Edge([2, 11, ]), 
            new Edge([3, 6, ]), 
            new Edge([3, 7, ]), 
            new Edge([3, 9, ]), 
            new Edge([3, 11, ]), 
            new Edge([4, 5, ]), 
            new Edge([4, 8, ]), 
            new Edge([4, 9, ]), 
            new Edge([5, 10, ]), 
            new Edge([5, 11, ]), 
            new Edge([6, 7, ]), 
            new Edge([6, 8, ]), 
            new Edge([6, 9, ]), 
            new Edge([7, 10, ]), 
            new Edge([7, 11, ]), 
            new Edge([8, 9, ]), 
            new Edge([10, 11, ])
        ];
    
        const faces: Face[] = [
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
        ];
    
        for (let i = 0; i < edges.length; ++i)
            for (let j = 0; j < edges[i].n.length; ++j)
                nodes[j].e.push(i);
    
        for (let i = 0; i < faces.length; ++i)
            for (let j = 0; j < faces[i].n.length; ++j)
                nodes[j].f.push(i);
    
        for (let i = 0; i < faces.length; ++i)
            for (let j = 0; j < faces[i].e.length; ++j)
                edges[j].f.push(i);
    
        return {
            nodes: nodes,
            edges: edges,
            faces: faces
        };
    }
    
    generateSubdividedIcosahedron(degree: number): MeshDescription {
        const icosahedron = this.generateIcosahedron();
    
        const nodes: Node[] = [];
        for (let i = 0; i < icosahedron.nodes.length; ++i) {
            nodes.push(new Node(icosahedron.nodes[i].p));
        }
    
        const edges: Edge[] = [];
        for (let i = 0; i < icosahedron.edges.length; ++i) {
            const edge = icosahedron.edges[i];
            edge.subdivided_n = [];
            edge.subdivided_e = [];
            const n0 = icosahedron.nodes[edge.n[0]];
            const n1 = icosahedron.nodes[edge.n[1]];
            const p0 = n0.p;
            const p1 = n1.p;
            nodes[edge.n[0]].e.push(edges.length);
            let priorNodeIndex = edge.n[0];
            for (let s = 1; s < degree; ++s) {
                const edgeIndex = edges.length;
                const nodeIndex = nodes.length;
                edge.subdivided_e.push(edgeIndex);
                edge.subdivided_n.push(nodeIndex);
                edges.push({
                    n: [priorNodeIndex, nodeIndex],
                    f: [],
                    subdivided_e: [],
                    subdivided_n: []
                });
                priorNodeIndex = nodeIndex;
                nodes.push({
                    p: slerp(p0, p1, s / degree),
                    e: [edgeIndex, edgeIndex + 1],
                    f: []
                });
            }
            edge.subdivided_e.push(edges.length);
            nodes[edge.n[1]].e.push(edges.length);
            edges.push(new Edge([priorNodeIndex, edge.n[1]]));
        }
    
        const faces: Face[] = [];
        for (let i = 0; i < icosahedron.faces.length; ++i) {
            const face = icosahedron.faces[i];
            const edge0 = icosahedron.edges[face.e[0]];
            const edge1 = icosahedron.edges[face.e[1]];
            const edge2 = icosahedron.edges[face.e[2]];
    
            const getEdgeNode0 = 
                (k: number) => (face.n[0] === edge0.n[0]) ? 
                    edge0.subdivided_n[k] : 
                    edge0.subdivided_n[degree - 2 - k];
            const getEdgeNode1 = (face.n[1] === edge1.n[0]) ?
                (k: number) => {
                    return edge1.subdivided_n[k];
                } :
                (k: number) => {
                    return edge1.subdivided_n[degree - 2 - k];
                };
            const getEdgeNode2 = (face.n[0] === edge2.n[0]) ?
                (k: number) => {
                    return edge2.subdivided_n[k];
                } :
                (k: number) => {
                    return edge2.subdivided_n[degree - 2 - k];
                };
    
            const faceNodes = [];
            faceNodes.push(face.n[0]);
            for (let j = 0; j < edge0.subdivided_n.length; ++j)
                faceNodes.push(getEdgeNode0(j));
            faceNodes.push(face.n[1]);
            for (let s = 1; s < degree; ++s) {
                faceNodes.push(getEdgeNode2(s - 1));
                const p0 = nodes[getEdgeNode2(s - 1)].p;
                const p1 = nodes[getEdgeNode1(s - 1)].p;
                for (let t = 1; t < degree - s; ++t) {
                    faceNodes.push(nodes.length);
                    nodes.push({
                        p: slerp(p0, p1, t / (degree - s)),
                        e: [],
                        f: [],
                    });
                }
                faceNodes.push(getEdgeNode1(s - 1));
            }
            faceNodes.push(face.n[2]);
    
            const getEdgeEdge0 = (face.n[0] === edge0.n[0]) ?
                (k: number) => {
                    return edge0.subdivided_e[k];
                } :
                (k: number) => {
                    return edge0.subdivided_e[degree - 1 - k];
                };
            const getEdgeEdge1 = (face.n[1] === edge1.n[0]) ?
                (k: number) => {
                    return edge1.subdivided_e[k];
                } :
                (k: number) => {
                    return edge1.subdivided_e[degree - 1 - k];
                };
            const getEdgeEdge2 = (face.n[0] === edge2.n[0]) ?
                (k: number) => {
                    return edge2.subdivided_e[k];
                } :
                (k: number) => {
                    return edge2.subdivided_e[degree - 1 - k];
                };
    
            const faceEdges0 = [];
            for (let j = 0; j < degree; ++j)
                faceEdges0.push(getEdgeEdge0(j));
            let nodeIndex = degree + 1;
            for (let s = 1; s < degree; ++s) {
                for (let t = 0; t < degree - s; ++t) {
                    faceEdges0.push(edges.length);
                    const edge = new Edge([faceNodes[nodeIndex], faceNodes[nodeIndex + 1], ]);
                    nodes[edge.n[0]].e.push(edges.length);
                    nodes[edge.n[1]].e.push(edges.length);
                    edges.push(edge);
                    ++nodeIndex;
                }
                ++nodeIndex;
            }
    
            const faceEdges1 = [];
            nodeIndex = 1;
            for (let s = 0; s < degree; ++s) {
                for (let t = 1; t < degree - s; ++t) {
                    faceEdges1.push(edges.length);
                    const edge = new Edge([faceNodes[nodeIndex], faceNodes[nodeIndex + degree - s], ]);
                    nodes[edge.n[0]].e.push(edges.length);
                    nodes[edge.n[1]].e.push(edges.length);
                    edges.push(edge);
                    ++nodeIndex;
                }
                faceEdges1.push(getEdgeEdge1(s));
                nodeIndex += 2;
            }
    
            const faceEdges2 = [];
            nodeIndex = 1;
            for (let s = 0; s < degree; ++s) {
                faceEdges2.push(getEdgeEdge2(s));
                for (let t = 1; t < degree - s; ++t) {
                    faceEdges2.push(edges.length);
                    const edge = new Edge([faceNodes[nodeIndex], faceNodes[nodeIndex + degree - s + 1], ]);
                    nodes[edge.n[0]].e.push(edges.length);
                    nodes[edge.n[1]].e.push(edges.length);
                    edges.push(edge);
                    ++nodeIndex;
                }
                nodeIndex += 2;
            }
    
            nodeIndex = 0;
            let edgeIndex = 0;
            for (let s = 0; s < degree; ++s) {
                for (let t = 1; t < degree - s + 1; ++t) {
                    const subFace: Face = new Face(
                        [faceNodes[nodeIndex], faceNodes[nodeIndex + 1], faceNodes[nodeIndex + degree - s + 1], ],
                        [faceEdges0[edgeIndex], faceEdges1[edgeIndex], faceEdges2[edgeIndex], ],
                    );
                    nodes[subFace.n[0]].f.push(faces.length);
                    nodes[subFace.n[1]].f.push(faces.length);
                    nodes[subFace.n[2]].f.push(faces.length);
                    edges[subFace.e[0]].f.push(faces.length);
                    edges[subFace.e[1]].f.push(faces.length);
                    edges[subFace.e[2]].f.push(faces.length);
                    faces.push(subFace);
                    ++nodeIndex;
                    ++edgeIndex;
                }
                ++nodeIndex;
            }
    
            nodeIndex = 1;
            edgeIndex = 0;
            for (let s = 1; s < degree; ++s) {
                for (let t = 1; t < degree - s + 1; ++t) {
                    const subFace = new Face(
                        [faceNodes[nodeIndex], faceNodes[nodeIndex + degree - s + 2], faceNodes[nodeIndex + degree - s + 1], ],
                        [faceEdges2[edgeIndex + 1], faceEdges0[edgeIndex + degree - s + 1], faceEdges1[edgeIndex], ],
                    );
                    nodes[subFace.n[0]].f.push(faces.length);
                    nodes[subFace.n[1]].f.push(faces.length);
                    nodes[subFace.n[2]].f.push(faces.length);
                    edges[subFace.e[0]].f.push(faces.length);
                    edges[subFace.e[1]].f.push(faces.length);
                    edges[subFace.e[2]].f.push(faces.length);
                    faces.push(subFace);
                    ++nodeIndex;
                    ++edgeIndex;
                }
                nodeIndex += 2;
                edgeIndex += 1;
            }
        }
    
        return {
            nodes: nodes,
            edges: edges,
            faces: faces
        };
    }
    
    getEdgeOppositeFaceIndex(edge: Edge, faceIndex: number) {
        if (edge.f[0] === faceIndex) return edge.f[1];
        if (edge.f[1] === faceIndex) return edge.f[0];

        throw 'Given face is not part of given edge.';
    }
    
    getFaceOppositeNodeIndex(face: Face, edge: Edge) {
        if (face.n[0] !== edge.n[0] && face.n[0] !== edge.n[1]) return 0;
        if (face.n[1] !== edge.n[0] && face.n[1] !== edge.n[1]) return 1;
        if (face.n[2] !== edge.n[0] && face.n[2] !== edge.n[1]) return 2;

        throw 'Cannot find node of given face that is not also a node of given edge.';
    }
    
    findNextFaceIndex(mesh: MeshDescription, nodeIndex: number, faceIndex: number) {
        const face = mesh.faces[faceIndex];
        const nodeFaceIndex = face.n.indexOf(nodeIndex);
        const edge = mesh.edges[face.e[(nodeFaceIndex + 2) % 3]];

        return this.getEdgeOppositeFaceIndex(edge, faceIndex);
    }
    
    conditionalRotateEdge(mesh: MeshDescription, edgeIndex: number, predicate: (oldNode0: Node, oldNode1: Node, newNode0: Node, newNode1: Node) => boolean): boolean {
        const edge = mesh.edges[edgeIndex];
        const face0 = mesh.faces[edge.f[0]];
        const face1 = mesh.faces[edge.f[1]];
        const farNodeFaceIndex0 = this.getFaceOppositeNodeIndex(face0, edge);
        const farNodeFaceIndex1 = this.getFaceOppositeNodeIndex(face1, edge);
        const newNodeIndex0 = face0.n[farNodeFaceIndex0];
        const oldNodeIndex0 = face0.n[(farNodeFaceIndex0 + 1) % 3];
        const newNodeIndex1 = face1.n[farNodeFaceIndex1];
        const oldNodeIndex1 = face1.n[(farNodeFaceIndex1 + 1) % 3];
        const oldNode0 = mesh.nodes[oldNodeIndex0];
        const oldNode1 = mesh.nodes[oldNodeIndex1];
        const newNode0 = mesh.nodes[newNodeIndex0];
        const newNode1 = mesh.nodes[newNodeIndex1];
        const newEdgeIndex0 = face1.e[(farNodeFaceIndex1 + 2) % 3];
        const newEdgeIndex1 = face0.e[(farNodeFaceIndex0 + 2) % 3];
        const newEdge0 = mesh.edges[newEdgeIndex0];
        const newEdge1 = mesh.edges[newEdgeIndex1];
    
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
    
    calculateFaceCentroid(pa: Vector3, pb: Vector3, pc: Vector3) {
        const vabHalf = pb.clone().sub(pa).divideScalar(2);
        const pabHalf = pa.clone().add(vabHalf);
        const centroid = pc.clone().sub(pabHalf).multiplyScalar(1 / 3).add(pabHalf);

        return centroid;
    }
    
    distortMesh(mesh: MeshDescription, degree: number, random: XorShift128, action: SteppedAction): boolean {    
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
    
        let i = 0;
        action.executeSubaction((action): void => {
            if (i >= degree) return;
    
            let consecutiveFailedAttempts = 0;
            let edgeIndex = random.integerExclusive(0, mesh.edges.length);
            while (!this.conditionalRotateEdge(mesh, edgeIndex, rotationPredicate)) {
                if (++consecutiveFailedAttempts >= mesh.edges.length) return; // return false;
                edgeIndex = (edgeIndex + 1) % mesh.edges.length;
            }
    
            ++i;
            action.loop(i / degree);
        });
    
        return true;
    }
    
    relaxMesh(mesh: MeshDescription, multiplier: number, action: SteppedAction) {
        const totalSurfaceArea = 4 * Math.PI;
        const idealFaceArea = totalSurfaceArea / mesh.faces.length;
        const idealEdgeLength = Math.sqrt(idealFaceArea * 4 / Math.sqrt(3));
        const idealDistanceToCentroid = idealEdgeLength * Math.sqrt(3) / 3 * 0.9;
    
        const pointShifts = new Array(mesh.nodes.length);
        action.executeSubaction(() => {
            for (let i = 0; i < mesh.nodes.length; ++i)
                pointShifts[i] = new Vector3(0, 0, 0);
        }, 1);
    
        let i = 0;
        action.executeSubaction((action) => {
            if (i >= mesh.faces.length) return;
    
            const face = mesh.faces[i];
            const n0 = mesh.nodes[face.n[0]];
            const n1 = mesh.nodes[face.n[1]];
            const n2 = mesh.nodes[face.n[2]];
            const p0 = n0.p;
            const p1 = n1.p;
            const p2 = n2.p;
            const centroid = this.calculateFaceCentroid(p0, p1, p2).normalize();
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
    
            ++i;
            action.loop(i / mesh.faces.length);
        }, mesh.faces.length);
    
        const origin = new Vector3(0, 0, 0);
        const plane = new Plane();
        action.executeSubaction(() => {
            for (let i = 0; i < mesh.nodes.length; ++i) {
                plane.setFromNormalAndCoplanarPoint(mesh.nodes[i].p, origin);
                //pointShifts[i] = mesh.nodes[i].p.clone().add(plane.projectPoint(pointShifts[i])).normalize();
                pointShifts[i] = mesh.nodes[i].p.clone().add(plane.projectPoint(pointShifts[i], new Vector3(0))).normalize();
            }
        }, mesh.nodes.length / 10);
    
        const rotationSupressions = new Array(mesh.nodes.length);
        for (let i = 0; i < mesh.nodes.length; ++i)
            rotationSupressions[i] = 0;
    
        action.executeSubaction((action) => {
            if (i >= mesh.edges.length) return;
    
            const edge = mesh.edges[i];
            const oldPoint0 = mesh.nodes[edge.n[0]].p;
            const oldPoint1 = mesh.nodes[edge.n[1]].p;
            const newPoint0 = pointShifts[edge.n[0]];
            const newPoint1 = pointShifts[edge.n[1]];
            const oldVector = oldPoint1.clone().sub(oldPoint0).normalize();
            const newVector = newPoint1.clone().sub(newPoint0).normalize();
            const suppression = (1 - oldVector.dot(newVector)) * 0.5;
            rotationSupressions[edge.n[0]] = Math.max(rotationSupressions[edge.n[0]], suppression);
            rotationSupressions[edge.n[1]] = Math.max(rotationSupressions[edge.n[1]], suppression);
    
            ++i;
            action.loop(i / mesh.edges.length);
        });
    
        let totalShift = 0;
        action.executeSubaction(() => {
            for (let i = 0; i < mesh.nodes.length; ++i) {
                const node = mesh.nodes[i];
                const point = node.p;
                const delta = point.clone();
                point.lerp(pointShifts[i], 1 - Math.sqrt(rotationSupressions[i])).normalize();
                delta.sub(point);
                totalShift += delta.length();
            }
        }, mesh.nodes.length / 20);
    
        return totalShift;
    }
    
    generatePlanetTopology(mesh: MeshDescription, action: SteppedAction) {
        const corners = new Array(mesh.faces.length);
        const borders = new Array(mesh.edges.length);
        const tiles = new Array(mesh.nodes.length);
    
        action.executeSubaction(() => {
            for (let i = 0; i < mesh.faces.length; ++i) {
                const face = mesh.faces[i];
                if (face.centroid) {
                    corners[i] = new Corner(i, face.centroid.clone().multiplyScalar(1000), face.e.length, face.e.length, face.n.length);
                }
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < mesh.edges.length; ++i) {
                //const edge = mesh.edges[i];
                borders[i] = new Border(i, 2, 4, 2); //edge.f.length, mesh.faces[edge.f[0]].e.length + mesh.faces[edge.f[1]].e.length - 2, edge.n.length
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < mesh.nodes.length; ++i) {
                const node = mesh.nodes[i];
                tiles[i] = new Tile(i, node.p.clone().multiplyScalar(1000), node.f.length, node.e.length, node.e.length);
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < corners.length; ++i) {
                const corner = corners[i];
                const face = mesh.faces[i];
                for (let j = 0; j < face.e.length; ++j) {
                    corner.borders[j] = borders[face.e[j]];
                }
                for (let j = 0; j < face.n.length; ++j) {
                    corner.tiles[j] = tiles[face.n[j]];
                }
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < borders.length; ++i) {
                const border = borders[i];
                const edge = mesh.edges[i];
                const averageCorner = new Vector3(0, 0, 0);
                let n = 0;
                for (let j = 0; j < edge.f.length; ++j) {
                    const corner = corners[edge.f[j]];
                    averageCorner.add(corner.position);
                    border.corners[j] = corner;
                    for (let k = 0; k < corner.borders.length; ++k) {
                        if (corner.borders[k] !== border) border.borders[n++] = corner.borders[k];
                    }
                }
                border.midpoint = averageCorner.multiplyScalar(1 / border.corners.length);
                for (let j = 0; j < edge.n.length; ++j) {
                    border.tiles[j] = tiles[edge.n[j]];
                }
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < corners.length; ++i) {
                const corner = corners[i];
                for (let j = 0; j < corner.borders.length; ++j) {
                    corner.corners[j] = corner.borders[j].oppositeCorner(corner);
                }
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < tiles.length; ++i) {
                const tile = tiles[i];
                const node = mesh.nodes[i];
                for (let j = 0; j < node.f.length; ++j) {
                    tile.corners[j] = corners[node.f[j]];
                }
                for (let j = 0; j < node.e.length; ++j) {
                    const border = borders[node.e[j]];
                    if (border.tiles[0] === tile) {
                        for (let k = 0; k < tile.corners.length; ++k) {
                            const corner0 = tile.corners[k];
                            const corner1 = tile.corners[(k + 1) % tile.corners.length];
                            if (border.corners[1] === corner0 && border.corners[0] === corner1) {
                                border.corners[0] = corner0;
                                border.corners[1] = corner1;
                            } else if (border.corners[0] !== corner0 || border.corners[1] !== corner1) {
                                continue;
                            }
                            tile.borders[k] = border;
                            tile.tiles[k] = border.oppositeTile(tile);
                            break;
                        }
                    } else {
                        for (let k = 0; k < tile.corners.length; ++k) {
                            const corner0 = tile.corners[k];
                            const corner1 = tile.corners[(k + 1) % tile.corners.length];
                            if (border.corners[0] === corner0 && border.corners[1] === corner1) {
                                border.corners[1] = corner0;
                                border.corners[0] = corner1;
                            } else if (border.corners[1] !== corner0 || border.corners[0] !== corner1) {
                                continue;
                            }
                            tile.borders[k] = border;
                            tile.tiles[k] = border.oppositeTile(tile);
                            break;
                        }
                    }
                }
    
                tile.averagePosition = new Vector3(0, 0, 0);
                for (let j = 0; j < tile.corners.length; ++j) {
                    tile.averagePosition.add(tile.corners[j].position);
                }
                tile.averagePosition.multiplyScalar(1 / tile.corners.length);
    
                let maxDistanceToCorner = 0;
                for (let j = 0; j < tile.corners.length; ++j) {
                    maxDistanceToCorner = Math.max(maxDistanceToCorner, tile.corners[j].position.distanceTo(tile.averagePosition));
                }
    
                let area = 0;
                for (let j = 0; j < tile.borders.length; ++j) {
                    area += calculateTriangleArea(tile.position, tile.borders[j].corners[0].position, tile.borders[j].corners[1].position);
                }
                tile.area = area;
    
                tile.normal = tile.position.clone().normalize();
    
                tile.boundingSphere = new Sphere(tile.averagePosition, maxDistanceToCorner);
            }
        });
    
        action.executeSubaction(() => {
            for (let i = 0; i < corners.length; ++i) {
                const corner = corners[i];
                corner.area = 0;
                for (let j = 0; j < corner.tiles.length; ++j) {
                    corner.area += corner.tiles[j].area / corner.tiles[j].corners.length;
                }
            }
        });
    
        action.provideResult<Topology>({
            corners: corners,
            borders: borders,
            tiles: tiles
        });
    }
    
    generatePlanetPartition(tiles: Tile[], action: SteppedAction) {
        const icosahedron = this.generateIcosahedron();
        action.executeSubaction(() => {
            for (let i = 0; i < icosahedron.faces.length; ++i) {
                const face = icosahedron.faces[i];
                const p0 = icosahedron.nodes[face.n[0]].p.clone().multiplyScalar(1000);
                const p1 = icosahedron.nodes[face.n[1]].p.clone().multiplyScalar(1000);
                const p2 = icosahedron.nodes[face.n[2]].p.clone().multiplyScalar(1000);
                const center = p0.clone().add(p1).add(p2).divideScalar(3);
                const radius = Math.max(center.distanceTo(p0), center.distanceTo(p2), center.distanceTo(p2));
                face.boundingSphere = new Sphere(center, radius);
                face.children = [];
            }
        });
    
        const unparentedTiles: Tile[] = [];
        let maxDistanceFromOrigin = 0;
        action.executeSubaction(() => {
            for (let i = 0; i < tiles.length; ++i) {
                const tile = tiles[i];
                if (tile.boundingSphere) {
                    maxDistanceFromOrigin = Math.max(maxDistanceFromOrigin, tile.boundingSphere.center.length() + tile.boundingSphere.radius);
        
                    let parentFound = false;
                    for (let j = 0; j < icosahedron.faces.length; ++j) {
                        const face = icosahedron.faces[j];
                        if (face.boundingSphere) {
                            const distance = tile.boundingSphere.center.distanceTo(face.boundingSphere.center) + tile.boundingSphere.radius;
                            if (distance < face.boundingSphere.radius) {
                                face.children.push(tile);
                                parentFound = true;
                                break;
                            }
                        }
                    }
                    if (!parentFound) {
                        unparentedTiles.push(tile);
                    }
                }
            }
        });
    
        let rootPartition: SpatialPartition;
        action.executeSubaction(() => {
            rootPartition = new SpatialPartition(new Sphere(new Vector3(0, 0, 0), maxDistanceFromOrigin), [], unparentedTiles);
            for (let i = 0; i < icosahedron.faces.length; ++i) {
                const face = icosahedron.faces[i];
                if (face.boundingSphere) {
                    rootPartition.partitions.push(new SpatialPartition(face.boundingSphere, [], face.children));
                    face.release();
                }
            }
        });
    
        action.provideResult<SpatialPartition>(() => rootPartition);
    }
    
    generatePlanetTerrain(planet: Planet, plateCount: number, oceanicRate: number, heatLevel: number, moistureLevel: number, random: XorShift128, action: SteppedAction) {
        action
            .executeSubaction((action) => {
                if (planet.topology) {
                    this.generatePlanetTectonicPlates(planet.topology, plateCount, oceanicRate, random, action);
                }
            }, 3, 'Generating Tectonic Plates')
            .getResult<Plate[]>((result) => {
                if (result) {
                    planet.plates.push(...result);
                }
            })
            .executeSubaction((action) => {
                if (planet.topology) {
                    this.generatePlanetElevation(planet.topology, action);
                }
            }, 4, 'Generating Elevation')
            .executeSubaction((action) => {
                if (planet.topology) {
                    this.generatePlanetWeather(planet.topology, heatLevel, moistureLevel, random, action);
                }
            }, 16, 'Generating Weather')
            .executeSubaction(() => {
                if (planet.topology) {
                    this.generatePlanetBiomes(planet.topology.tiles);
                }
            }, 1, 'Generating Biomes');
    }
    
    generatePlanetTectonicPlates(topology: Topology, plateCount: number, oceanicRate: number, random: XorShift128, action: SteppedAction) {
        const plates: Plate[] = [];
        const platelessTiles: Tile[] = [];
        const platelessTilePlates: Plate[] = [];

        action.executeSubaction(() => {
            let failedCount = 0;
            while (plates.length < plateCount && failedCount < 10000) {
                const corner = topology.corners[random.integerExclusive(0, topology.corners.length)];
                let adjacentToExistingPlate = false;
                for (let i = 0; i < corner.tiles.length; ++i) {
                    if (corner.tiles[i].plate) {
                        adjacentToExistingPlate = true;
                        failedCount += 1;
                        break;
                    }
                }
                if (adjacentToExistingPlate) continue;
    
                failedCount = 0;
    
                const oceanic = (random.unit() < oceanicRate);
                const plate = new Plate(
                    new Color(random.integer(0, 0xFFFFFF)),
                    randomUnitVector(random),
                    random.realInclusive(-Math.PI / 30, Math.PI / 30),
                    random.realInclusive(-Math.PI / 30, Math.PI / 30),
                    oceanic ? random.realInclusive(-0.8, -0.3) : random.realInclusive(0.1, 0.5),
                    oceanic,
                    corner);
    
                plates.push(plate);
    
                for (let i = 0; i < corner.tiles.length; ++i) {
                    corner.tiles[i].plate = plate;
                    plate.tiles.push(corner.tiles[i]);
                }
    
                for (let i = 0; i < corner.tiles.length; ++i) {
                    const tile = corner.tiles[i];
                    for (let j = 0; j < tile.tiles.length; ++j) {
                        const adjacentTile = tile.tiles[j];
                        if (!adjacentTile.plate) {
                            platelessTiles.push(adjacentTile);
                            platelessTilePlates.push(plate);
                        }
                    }
                }
            }
        });
    
        action.executeSubaction(() => {
            while (platelessTiles.length > 0) {
                const tileIndex = Math.floor(Math.pow(random.unit(), 2) * platelessTiles.length);
                const tile = platelessTiles[tileIndex];
                const plate = platelessTilePlates[tileIndex];
                platelessTiles.splice(tileIndex, 1);
                platelessTilePlates.splice(tileIndex, 1);

                if (!tile.plate) {
                    tile.plate = plate;
                    plate.tiles.push(tile);
                    for (let j = 0; j < tile.tiles.length; ++j) {
                        if (!tile.tiles[j].plate) {
                            platelessTiles.push(tile.tiles[j]);
                            platelessTilePlates.push(plate);
                        }
                    }
                }
            }
        });
    
        action.executeSubaction(this.calculateCornerDistancesToPlateRoot.bind(null, plates));
    
        action.provideResult<Plate[]>(plates);
    }
    
    calculateCornerDistancesToPlateRoot(plates: Plate[], action: SteppedAction) {
        interface CornerQueueItem { corner: Corner; distanceToPlateRoot: number };

        const distanceCornerQueue: CornerQueueItem[] = [];
        for (let i = 0; i < plates.length; ++i) {
            const corner = plates[i].root;
            corner.distanceToPlateRoot = 0;

            for (let j = 0; j < corner.corners.length; ++j) {
                distanceCornerQueue.push({
                    corner: corner.corners[j],
                    distanceToPlateRoot: corner.borders[j].length()
                });
            }
        }
    
        const distanceCornerQueueSorter = (left: CornerQueueItem, right: CornerQueueItem) => 
            left.distanceToPlateRoot - right.distanceToPlateRoot;
    
        action.executeSubaction((action) => {
            if (distanceCornerQueue.length === 0) return;
    
            const iEnd = distanceCornerQueue.length;
            for (let i = 0; i < iEnd; ++i) {
                const front = distanceCornerQueue[i];
                const corner = front.corner;
                const distanceToPlateRoot = front.distanceToPlateRoot;
                if (!corner.distanceToPlateRoot || corner.distanceToPlateRoot > distanceToPlateRoot) {
                    corner.distanceToPlateRoot = distanceToPlateRoot;
                    for (let j = 0; j < corner.corners.length; ++j) {
                        distanceCornerQueue.push({
                            corner: corner.corners[j],
                            distanceToPlateRoot: distanceToPlateRoot + corner.borders[j].length()
                        });
                    }
                }
            }
            distanceCornerQueue.splice(0, iEnd);
            distanceCornerQueue.sort(distanceCornerQueueSorter);
    
            action.loop();
        });
    }
    
    generatePlanetElevation(topology: Topology, action: SteppedAction) {

        let boundaryCorners: Corner[] | undefined;
        let boundaryCornerInnerBorderIndexes: number[] | undefined;
        let elevationBorderQueue: ElevationBorderQueueItem[] | undefined;

        const elevationBorderQueueSorter = (left: ElevationBorderQueueItem, right: ElevationBorderQueueItem) => 
            left.distanceToPlateBoundary - right.distanceToPlateBoundary;
    
        action
            .executeSubaction(() => {
                this.identifyBoundaryBorders(topology.borders);
            }, 1)
            .executeSubaction((action) => {
                this.collectBoundaryCorners(topology.corners, action);
            }, 1)
            .getResult<Corner[]>((result) => boundaryCorners = result)
            .executeSubaction((action) => {
                if (boundaryCorners) {
                    this.calculatePlateBoundaryStress(boundaryCorners, action);
                }
            }, 2)
            .getResult<number[]>((result) => boundaryCornerInnerBorderIndexes = result)
            .executeSubaction(() => {
                if (boundaryCorners) {
                    this.blurPlateBoundaryStress(boundaryCorners, 3, 0.4);
                }
            }, 2)
            .executeSubaction((action) => {
                if (boundaryCorners && boundaryCornerInnerBorderIndexes) {
                    this.populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes, action);
                }
            }, 2)
            .getResult<ElevationBorderQueueItem[]>((result) => elevationBorderQueue = result)
            .executeSubaction((action) => {
                if (elevationBorderQueue) {
                    this.processElevationBorderQueue(elevationBorderQueue, elevationBorderQueueSorter, action);
                }
            }, 10)
            .executeSubaction(() => {
                this.calculateTileAverageElevations(topology.tiles);
            }, 2);
    }
    
    identifyBoundaryBorders(borders: Border[]) {
        for (let i = 0; i < borders.length; ++i) {
            const border = borders[i];
            if (border.tiles[0].plate !== border.tiles[1].plate) {
                border.betweenPlates = true;
                border.corners[0].betweenPlates = true;
                border.corners[1].betweenPlates = true;
                border.tiles[0].plate?.boundaryBorders.push(border);
                border.tiles[1].plate?.boundaryBorders.push(border);
            }
        }
    }
    
    collectBoundaryCorners(corners: Corner[], action: SteppedAction) {
        const boundaryCorners = [];
        for (let j = 0; j < corners.length; ++j) {
            const corner = corners[j];
            if (corner.betweenPlates) {
                boundaryCorners.push(corner);
                corner.tiles[0].plate?.boundaryCorners.push(corner);
                if (corner.tiles[1].plate && corner.tiles[1].plate !== corner.tiles[0].plate) {
                    corner.tiles[1].plate.boundaryCorners.push(corner);
                }
                if (corner.tiles[2].plate && corner.tiles[2].plate !== corner.tiles[0].plate && corner.tiles[2].plate !== corner.tiles[1].plate) {
                    corner.tiles[2].plate.boundaryCorners.push(corner);
                }
            }
        }
    
        action.provideResult<Corner[]>(boundaryCorners);
    }
    
    calculatePlateBoundaryStress(boundaryCorners: Corner[], action: SteppedAction) {
        const boundaryCornerInnerBorderIndexes = new Array<number | undefined>(boundaryCorners.length);
        for (let i = 0; i < boundaryCorners.length; ++i) {
            const corner = boundaryCorners[i];
            corner.distanceToPlateBoundary = 0;
    
            let innerBorder;
            let innerBorderIndex;
            for (let j = 0; j < corner.borders.length; ++j) {
                const border = corner.borders[j];
                if (!border.betweenPlates) {
                    innerBorder = border;
                    innerBorderIndex = j;
                    break;
                }
            }
    
            if (innerBorder && innerBorderIndex) {
                boundaryCornerInnerBorderIndexes[i] = innerBorderIndex;
                const outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
                const outerBorder1 = corner.borders[(innerBorderIndex + 2) % corner.borders.length];
                const farCorner0 = outerBorder0.oppositeCorner(corner);
                const farCorner1 = outerBorder1.oppositeCorner(corner);
                const plate0 = innerBorder.tiles[0].plate;
                const plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;
                const boundaryVector = farCorner0.vectorTo(farCorner1);
                const boundaryNormal = boundaryVector.clone().cross(corner.position);
                if (plate0 && plate1) {
                    const stress = this.calculateStress(plate0.calculateMovement(corner.position), plate1.calculateMovement(corner.position), boundaryVector, boundaryNormal);
                    corner.pressure = stress.pressure;
                    corner.shear = stress.shear;
                }
            } else {
                boundaryCornerInnerBorderIndexes[i] = undefined;
                const plate0 = corner.tiles[0].plate;
                const plate1 = corner.tiles[1].plate;
                const plate2 = corner.tiles[2].plate;
                const boundaryVector0 = corner.corners[0].vectorTo(corner);
                const boundaryVector1 = corner.corners[1].vectorTo(corner);
                const boundaryVector2 = corner.corners[2].vectorTo(corner);
                const boundaryNormal0 = boundaryVector0.clone().cross(corner.position);
                const boundaryNormal1 = boundaryVector1.clone().cross(corner.position);
                const boundaryNormal2 = boundaryVector2.clone().cross(corner.position);

                if (plate0 && plate1 && plate2) {
                    const stress0 = this.calculateStress(plate0.calculateMovement(corner.position), plate1.calculateMovement(corner.position), boundaryVector0, boundaryNormal0);
                    const stress1 = this.calculateStress(plate1.calculateMovement(corner.position), plate2.calculateMovement(corner.position), boundaryVector1, boundaryNormal1);
                    const stress2 = this.calculateStress(plate2.calculateMovement(corner.position), plate0.calculateMovement(corner.position), boundaryVector2, boundaryNormal2);
        
                    corner.pressure = (stress0.pressure + stress1.pressure + stress2.pressure) / 3;
                    corner.shear = (stress0.shear + stress1.shear + stress2.shear) / 3;
                }
            }
        }
    
        action.provideResult<(number | undefined)[]>(boundaryCornerInnerBorderIndexes);
    }
    
    calculateStress(movement0: Vector3, movement1: Vector3, boundaryVector: Vector3, boundaryNormal: Vector3) {
        const relativeMovement = movement0.clone().sub(movement1);
        const pressureVector = relativeMovement.clone().projectOnVector(boundaryNormal);
        let pressure = pressureVector.length();
        if (pressureVector.dot(boundaryNormal) > 0) {
            pressure = -pressure;
        }

        const shear = relativeMovement.clone().projectOnVector(boundaryVector).length();

        return {
            pressure: 2 / (1 + Math.exp(-pressure / 30)) - 1,
            shear: 2 / (1 + Math.exp(-shear / 30)) - 1
        };
    }
    
    blurPlateBoundaryStress(boundaryCorners: Corner[], stressBlurIterations: number, stressBlurCenterWeighting: number) {
        const newCornerPressure = new Array(boundaryCorners.length);
        const newCornerShear = new Array(boundaryCorners.length);
        for (let i = 0; i < stressBlurIterations; ++i) {
            for (let j = 0; j < boundaryCorners.length; ++j) {
                const corner = boundaryCorners[j];
                let averagePressure = 0;
                let averageShear = 0;
                let neighborCount = 0;
                for (let k = 0; k < corner.corners.length; ++k) {
                    const neighbor = corner.corners[k];
                    if (neighbor.betweenPlates) {
                        averagePressure += neighbor.pressure;
                        averageShear += neighbor.shear;
                        ++neighborCount;
                    }
                }
                newCornerPressure[j] = corner.pressure * stressBlurCenterWeighting + (averagePressure / neighborCount) * (1 - stressBlurCenterWeighting);
                newCornerShear[j] = corner.shear * stressBlurCenterWeighting + (averageShear / neighborCount) * (1 - stressBlurCenterWeighting);
            }
    
            for (let j = 0; j < boundaryCorners.length; ++j) {
                const corner = boundaryCorners[j];
                if (corner.betweenPlates) {
                    corner.pressure = newCornerPressure[j];
                    corner.shear = newCornerShear[j];
                }
            }
        }
    }
    
    populateElevationBorderQueue(boundaryCorners: Corner[], boundaryCornerInnerBorderIndexes: number[], action: SteppedAction) {
        const elevationBorderQueue: ElevationBorderQueueItem[] = [];
        for (let i = 0; i < boundaryCorners.length; ++i) {
            const corner = boundaryCorners[i];
    
            const innerBorderIndex = boundaryCornerInnerBorderIndexes[i];
            if (innerBorderIndex) {
                const innerBorder = corner.borders[innerBorderIndex];
                const outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
                const plate0 = innerBorder.tiles[0].plate;
                const plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;
    
                let calculateElevation;
    
                if (plate0 && plate1) {
                    if (corner.pressure > 0.3) {
                        corner.elevation = Math.max(plate0.elevation, plate1.elevation) + corner.pressure;
                        if (plate0.oceanic === plate1.oceanic)
                            calculateElevation = this.calculateCollidingElevation;
                        else if (plate0.oceanic)
                            calculateElevation = this.calculateSubductingElevation;
                        else
                            calculateElevation = this.calculateSuperductingElevation;
                    } else if (corner.pressure < -0.3) {
                        corner.elevation = Math.max(plate0.elevation, plate1.elevation) - corner.pressure / 4;
                        calculateElevation = this.calculateDivergingElevation;
                    } else if (corner.shear > 0.3) {
                        corner.elevation = Math.max(plate0.elevation, plate1.elevation) + corner.shear / 8;
                        calculateElevation = this.calculateShearingElevation;
                    } else {
                        corner.elevation = (plate0.elevation + plate1.elevation) / 2;
                        calculateElevation = this.calculateDormantElevation;
                    }
    
                    const nextCorner = innerBorder.oppositeCorner(corner);
                    if (!nextCorner.betweenPlates) {
                        elevationBorderQueue.push({
                            origin: {
                                corner: corner,
                                pressure: corner.pressure,
                                shear: corner.shear,
                                plate: plate0,
                                calculateElevation: calculateElevation
                            },
                            border: innerBorder,
                            corner: corner,
                            nextCorner: nextCorner,
                            distanceToPlateBoundary: innerBorder.length(),
                        });
                    }
                }
            } else {
                const plate0 = corner.tiles[0].plate;
                const plate1 = corner.tiles[1].plate;
                const plate2 = corner.tiles[2].plate;
    
                corner.elevation = 0;

                if (plate0 && plate1 && plate2) {
                    if (corner.pressure > 0.3) {
                        corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.pressure;
                    } else if (corner.pressure < -0.3) {
                        corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.pressure / 4;
                    } else if (corner.shear > 0.3) {
                        corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.shear / 8;
                    } else {
                        corner.elevation = (plate0.elevation + plate1.elevation + plate2.elevation) / 3;
                    }
                }
            }
        }
    
        action.provideResult<ElevationBorderQueueItem[]>(elevationBorderQueue);
    }
    
    calculateCollidingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.5) {
            t = t / 0.5;
            return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
        } else {
            return plateElevation;
        }
    }
    
    calculateSuperductingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number, pressure: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.2) {
            t = t / 0.2;
            return boundaryElevation + t * (plateElevation - boundaryElevation + pressure / 2);
        } else if (t < 0.5) {
            t = (t - 0.2) / 0.3;
            return plateElevation + Math.pow(t - 1, 2) * pressure / 2;
        } else {
            return plateElevation;
        }
    }
    
    calculateSubductingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        const t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
    }
    
    calculateDivergingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.3) {
            t = t / 0.3;
            return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
        } else {
            return plateElevation;
        }
    }
    
    calculateShearingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.2) {
            t = t / 0.2;
            return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
        } else {
            return plateElevation;
        }
    }
    
    calculateDormantElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        const t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        const elevationDifference = boundaryElevation - plateElevation;
        return t * t * elevationDifference * (2 * t - 3) + boundaryElevation;
    }
    
    processElevationBorderQueue(elevationBorderQueue: ElevationBorderQueueItem[], elevationBorderQueueSorter: (left: ElevationBorderQueueItem, right: ElevationBorderQueueItem) => number, action: SteppedAction) {
        if (elevationBorderQueue.length === 0) return;
    
        const iEnd = elevationBorderQueue.length;
        for (let i = 0; i < iEnd; ++i) {
            const front = elevationBorderQueue[i];
            const corner = front.nextCorner;
            if (!corner.elevation && corner.distanceToPlateRoot) {
                corner.distanceToPlateBoundary = front.distanceToPlateBoundary;
                corner.elevation = front.origin.calculateElevation(
                    corner.distanceToPlateBoundary,
                    corner.distanceToPlateRoot,
                    front.origin.corner.elevation,
                    front.origin.plate.elevation,
                    front.origin.pressure,
                    front.origin.shear);
    
                for (let j = 0; j < corner.borders.length; ++j) {
                    const border = corner.borders[j];
                    if (!border.betweenPlates) {
                        const nextCorner = corner.corners[j];
                        const distanceToPlateBoundary = corner.distanceToPlateBoundary + border.length();
                        if (!nextCorner.distanceToPlateBoundary || nextCorner.distanceToPlateBoundary > distanceToPlateBoundary) {
                            elevationBorderQueue.push({
                                origin: front.origin,
                                border: border,
                                corner: corner,
                                nextCorner: nextCorner,
                                distanceToPlateBoundary: distanceToPlateBoundary,
                            });
                        }
                    }
                }
            }
        }
        elevationBorderQueue.splice(0, iEnd);
        elevationBorderQueue.sort(elevationBorderQueueSorter);
    
        action.loop();
    }
    
    calculateTileAverageElevations(tiles: Tile[]) {
        for (let i = 0; i < tiles.length; ++i) {
            const tile = tiles[i];
            let elevation = 0;
            for (let j = 0; j < tile.corners.length; ++j) {
                elevation += tile.corners[j].elevation;
            }
            tile.elevation = elevation / tile.corners.length;
        }
    }
    
    generatePlanetWeather(topology: Topology, heatLevel: number, moistureLevel: number, random: XorShift128, action: SteppedAction) {
        const planetRadius = 1000;
        const whorls: Whorl[] = [];
        let activeCorners: Corner[] = [];
        let totalHeat = 0;
        let remainingHeat = 0;
        let totalMoisture = 0;
        let remainingMoisture = 0;
    
        action
            .executeSubaction((action) => {
                this.generateAirCurrentWhorls(planetRadius, random, action);
            }, 1, 'Generating Air Currents')
            .getResult<Whorl[]>((result) => {
                if (result) {
                    whorls.push(...result);
                }
            })
            .executeSubaction((action) => {
                this.calculateAirCurrents(topology.corners, whorls, planetRadius, action);
            }, 1, 'Generating Air Currents')
            .executeSubaction((action) => {
                this.initializeAirHeat(topology.corners, heatLevel, action);
            }, 2, 'Calculating Temperature')
            .getResult<AirHeatResult>((result) => {
                if (result) {
                    activeCorners.push(...result.corners);
                    totalHeat = result.airHeat;
                    remainingHeat = result.airHeat;
                }
            })
            .executeSubaction((action) => {
                const consumedHeat = this.processAirHeat(activeCorners);
                remainingHeat -= consumedHeat;
                if (remainingHeat > 0 && consumedHeat >= 0.0001) action.loop(1 - remainingHeat / totalHeat);
            }, 8, 'Calculating Temperature')
            .executeSubaction(() => {
                this.calculateTemperature(topology.corners, topology.tiles, planetRadius);
            }, 1, 'Calculating Temperature')
            .executeSubaction((action) => {
                this.initializeAirMoisture(topology.corners, moistureLevel, action);
            }, 2, 'Calculating Moisture')
            .getResult<AirMoistureResult>((result) => {
                if (result) {
                    activeCorners = result.corners;
                    totalMoisture = result.airMoisture;
                    remainingMoisture = result.airMoisture;
                }
            })
            .executeSubaction((action) => {
                const consumedMoisture = this.processAirMoisture(activeCorners);
                remainingMoisture -= consumedMoisture;
                if (remainingMoisture > 0 && consumedMoisture >= 0.0001) action.loop(1 - remainingMoisture / totalMoisture);
            }, 32, 'Calculating Moisture')
            .executeSubaction(() => {
                this.calculateMoisture(topology.corners, topology.tiles);
            }, 1, 'Calculating Moisture');
    }
    
    generateAirCurrentWhorls(planetRadius: number, random: XorShift128, action: SteppedAction) {
        const whorls: Whorl[] = [];
        let direction = random.integer(0, 1) ? 1 : -1;
        const layerCount = random.integer(4, 7);
        const circumference = Math.PI * 2 * planetRadius;
        const fullRevolution = Math.PI * 2;
        const baseWhorlRadius = circumference / (2 * (layerCount - 1));
    
        whorls.push({
            center: new Vector3(0, planetRadius, 0)
                .applyAxisAngle(new Vector3(1, 0, 0), random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                .applyAxisAngle(new Vector3(0, 1, 0), random.real(0, fullRevolution)),
            strength: random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
            radius: random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        });
    
        for (let i = 1; i < layerCount - 1; ++i) {
            direction = -direction;
            const baseTilt = i / (layerCount - 1) * fullRevolution / 2;
            const layerWhorlCount = Math.ceil((Math.sin(baseTilt) * planetRadius * fullRevolution) / baseWhorlRadius);
            for (let j = 0; j < layerWhorlCount; ++j) {
                whorls.push({
                    center: new Vector3(0, planetRadius, 0)
                        .applyAxisAngle(new Vector3(1, 0, 0), random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                        .applyAxisAngle(new Vector3(0, 1, 0), random.real(0, fullRevolution))
                        .applyAxisAngle(new Vector3(1, 0, 0), baseTilt)
                        .applyAxisAngle(new Vector3(0, 1, 0), fullRevolution * (j + (i % 2) / 2) / layerWhorlCount),
                    strength: random.realInclusive(fullRevolution / 48, fullRevolution / 32) * direction,
                    radius: random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
                });
            }
        }
    
        direction = -direction;
        whorls.push({
            center: new Vector3(0, planetRadius, 0)
                .applyAxisAngle(new Vector3(1, 0, 0), random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                .applyAxisAngle(new Vector3(0, 1, 0), random.real(0, fullRevolution))
                .applyAxisAngle(new Vector3(1, 0, 0), fullRevolution / 2),
            strength: random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
            radius: random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        });
    
        action.provideResult<Whorl[]>(whorls);
    }
    
    calculateAirCurrents(corners: Corner[], whorls: Whorl[], planetRadius: number, action: SteppedAction) {
        let i = 0;
        action.executeSubaction((action) => {
            if (i >= corners.length) return;
    
            const corner = corners[i];
            const airCurrent = new Vector3(0, 0, 0);
            let weight = 0;
            for (let j = 0; j < whorls.length; ++j) {
                const whorl = whorls[j];
                const angle = whorl.center.angleTo(corner.position);
                const distance = angle * planetRadius;
                if (distance < whorl.radius) {
                    const normalizedDistance = distance / whorl.radius;
                    const whorlWeight = 1 - normalizedDistance;
                    const whorlStrength = planetRadius * whorl.strength * whorlWeight * normalizedDistance;
                    const whorlCurrent = whorl.center.clone().cross(corner.position).setLength(whorlStrength);
                    airCurrent.add(whorlCurrent);
                    weight += whorlWeight;
                }
            }
            airCurrent.divideScalar(weight);
            corner.airCurrent = airCurrent;
            corner.airCurrentSpeed = airCurrent.length(); //kilometers per hour
    
            corner.airCurrentOutflows = new Array(corner.borders.length);
            const airCurrentDirection = airCurrent.clone().normalize();
            let outflowSum = 0;
            for (let j = 0; j < corner.corners.length; ++j) {
                const vector = corner.vectorTo(corner.corners[j]).normalize();
                const dot = vector.dot(airCurrentDirection);
                if (dot > 0) {
                    corner.airCurrentOutflows[j] = dot;
                    outflowSum += dot;
                } else {
                    corner.airCurrentOutflows[j] = 0;
                }
            }
    
            if (outflowSum > 0) {
                for (let j = 0; j < corner.borders.length; ++j) {
                    corner.airCurrentOutflows[j] /= outflowSum;
                }
            }
    
            ++i;
            action.loop(i / corners.length);
        });
    }
    
    initializeAirHeat(corners: Corner[], heatLevel: number, action: SteppedAction) {
        const activeCorners = [];
        let airHeat = 0;
        for (let i = 0; i < corners.length; ++i) {
            const corner = corners[i];
            corner.airHeat = corner.area * heatLevel;
            corner.newAirHeat = 0;
            corner.heat = 0;
    
            corner.heatAbsorption = 0.1 * corner.area / Math.max(0.1, Math.min(corner.airCurrentSpeed, 1));
            if (corner.elevation <= 0) {
                corner.maxHeat = corner.area;
            } else {
                corner.maxHeat = corner.area;
                corner.heatAbsorption *= 2;
            }
    
            activeCorners.push(corner);
            airHeat += corner.airHeat;
        }
    
        action.provideResult<AirHeatResult>({
            corners: activeCorners,
            airHeat: airHeat
        });
    }
    
    processAirHeat(activeCorners: Corner[]) {
        let consumedHeat = 0;
        const activeCornerCount = activeCorners.length;
        for (let i = 0; i < activeCornerCount; ++i) {
            const corner = activeCorners[i];
            if (corner.airHeat === 0) continue;
    
            let heatChange = Math.max(0, Math.min(corner.airHeat, corner.heatAbsorption * (1 - corner.heat / corner.maxHeat)));
            corner.heat += heatChange;
            consumedHeat += heatChange;
            const heatLoss = corner.area * (corner.heat / corner.maxHeat) * 0.02;
            heatChange = Math.min(corner.airHeat, heatChange + heatLoss);
    
            const remainingCornerAirHeat = corner.airHeat - heatChange;
            corner.airHeat = 0;
    
            for (let j = 0; j < corner.corners.length; ++j) {
                if (corner.airCurrentOutflows && corner.airCurrentOutflows[j] > 0) {
                    const outflow = corner.airCurrentOutflows[j];
                    corner.corners[j].newAirHeat += remainingCornerAirHeat * outflow;
                    activeCorners.push(corner.corners[j]);
                }
            }
        }
    
        activeCorners.splice(0, activeCornerCount);
    
        for (let i = 0; i < activeCorners.length; ++i) {
            const corner = activeCorners[i];
            corner.airHeat = corner.newAirHeat;
        }
        for (let i = 0; i < activeCorners.length; ++i) {
            activeCorners[i].newAirHeat = 0;
        }
    
        return consumedHeat;
    }
    
    calculateTemperature(corners: Corner[], tiles: Tile[], planetRadius: number) {
        for (let i = 0; i < corners.length; ++i) {
            const corner = corners[i];
            const latitudeEffect = Math.sqrt(1 - Math.abs(corner.position.y) / planetRadius);
            const elevationEffect = 1 - Math.pow(Math.max(0, Math.min(corner.elevation * 0.8, 1)), 2);
            const normalizedHeat = corner.heat / corner.area;
            corner.temperature = (latitudeEffect * elevationEffect * 0.7 + normalizedHeat * 0.3) * 5 / 3 - 2 / 3;
            delete corner.airHeat;
            delete corner.newAirHeat;
            delete corner.heat;
            delete corner.maxHeat;
            delete corner.heatAbsorption;
        }
    
        for (let i = 0; i < tiles.length; ++i) {
            const tile = tiles[i];
            tile.temperature = 0;
            for (let j = 0; j < tile.corners.length; ++j) {
                tile.temperature += tile.corners[j].temperature;
            }
            tile.temperature /= tile.corners.length;
        }
    }
    
    initializeAirMoisture(corners: Corner[], moistureLevel: number, action: SteppedAction) {
        const activeCorners = [];
        let airMoisture = 0;

        for (let i = 0; i < corners.length; ++i) {
            const corner = corners[i];
            corner.airMoisture = (corner.elevation > 0) ? 0 : corner.area * moistureLevel * Math.max(0, Math.min(0.5 + corner.temperature * 0.5, 1));
            corner.newAirMoisture = 0;
            corner.precipitation = 0;
    
            corner.precipitationRate = 0.0075 * corner.area / Math.max(0.1, Math.min(corner.airCurrentSpeed, 1));
            corner.precipitationRate *= 1 + (1 - Math.max(0, Math.max(corner.temperature, 1))) * 0.1;
            if (corner.elevation > 0) {
                corner.precipitationRate *= 1 + corner.elevation * 0.5;
                corner.maxPrecipitation = corner.area * (0.25 + Math.max(0, Math.min(corner.elevation, 1)) * 0.25);
            } else {
                corner.maxPrecipitation = corner.area * 0.25;
            }
    
            activeCorners.push(corner);
            airMoisture += corner.airMoisture;
        }
    
        action.provideResult<AirMoistureResult>({
            corners: activeCorners,
            airMoisture: airMoisture
        });
    }
    
    processAirMoisture(activeCorners: Corner[]) {
        let consumedMoisture = 0;
        const activeCornerCount = activeCorners.length;
        for (let i = 0; i < activeCornerCount; ++i) {
            const corner = activeCorners[i];
            if (corner.airMoisture && corner.precipitationRate && corner.precipitation && corner.maxPrecipitation && corner.airCurrentOutflows) {
                let moistureChange = Math.max(0, Math.min(corner.airMoisture, corner.precipitationRate * (1 - corner.precipitation / corner.maxPrecipitation)));
                corner.precipitation += moistureChange;
                consumedMoisture += moistureChange;
                const moistureLoss = corner.area * (corner.precipitation / corner.maxPrecipitation) * 0.02;
                moistureChange = Math.min(corner.airMoisture, moistureChange + moistureLoss);
        
                const remainingCornerAirMoisture = corner.airMoisture - moistureChange;
                corner.airMoisture = 0;
        
                for (let j = 0; j < corner.corners.length; ++j) {
                    let newAirMoisture = corner.corners[j].newAirMoisture || 0;

                    const outflow = corner.airCurrentOutflows[j];
                    if (outflow > 0) {
                        newAirMoisture += remainingCornerAirMoisture * outflow;
                        corner.corners[j].newAirMoisture = newAirMoisture;
                        activeCorners.push(corner.corners[j]);
                    }
                }
            }
    
        }
    
        activeCorners.splice(0, activeCornerCount);
    
        for (let i = 0; i < activeCorners.length; ++i) {
            const corner = activeCorners[i];
            corner.airMoisture = corner.newAirMoisture;
        }
        for (let i = 0; i < activeCorners.length; ++i) {
            activeCorners[i].newAirMoisture = 0;
        }
    
        return consumedMoisture;
    }
    
    calculateMoisture(corners: Corner[], tiles: Tile[]) {
        for (let i = 0; i < corners.length; ++i) {
            const corner = corners[i];
            if (corner.precipitation) {
                corner.moisture = corner.precipitation / corner.area / 0.5;
            }
            delete corner.airMoisture;
            delete corner.newAirMoisture;
            delete corner.precipitation;
            delete corner.maxPrecipitation;
            delete corner.precipitationRate;
        }
    
        for (let i = 0; i < tiles.length; ++i) {
            const tile = tiles[i];
            tile.moisture = 0;
            for (let j = 0; j < tile.corners.length; ++j) {
                tile.moisture += tile.corners[j].moisture;
            }
            tile.moisture /= tile.corners.length;
        }
    }
    
    generatePlanetBiomes(tiles: Tile[]) {
        for (let i = 0; i < tiles.length; ++i) {
            const tile = tiles[i];
            const elevation = Math.max(0, tile.elevation);
            const temperature = tile.temperature;
            const moisture = tile.moisture;
    
            if (elevation <= 0) {
                if (temperature > 0) {
                    tile.biome = 'ocean';
                } else {
                    tile.biome = 'oceanGlacier';
                }
            } else if (elevation < 0.6) {
                if (temperature > 0.75) {
                    if (moisture < 0.25) {
                        tile.biome = 'desert';
                    } else {
                        tile.biome = 'rainForest';
                    }
                } else if (temperature > 0.5) {
                    if (moisture < 0.25) {
                        tile.biome = 'rocky';
                    } else if (moisture < 0.50) {
                        tile.biome = 'plains';
                    } else {
                        tile.biome = 'swamp';
                    }
                } else if (temperature > 0) {
                    if (moisture < 0.25) {
                        tile.biome = 'plains';
                    } else if (moisture < 0.50) {
                        tile.biome = 'grassland';
                    } else {
                        tile.biome = 'deciduousForest';
                    }
                } else {
                    if (moisture < 0.25) {
                        tile.biome = 'tundra';
                    } else {
                        tile.biome = 'landGlacier';
                    }
                }
            } else if (elevation < 0.8) {
                if (temperature > 0) {
                    if (moisture < 0.25) {
                        tile.biome = 'tundra';
                    } else {
                        tile.biome = 'coniferForest';
                    }
                } else {
                    tile.biome = 'tundra';
                }
            } else {
                if (temperature > 0 || moisture < 0.25) {
                    tile.biome = 'mountain';
                } else {
                    tile.biome = 'snowyMountain';
                }
            }
        }
    }
    
    generatePlanetRenderData(topology: Topology, random: XorShift128, action: SteppedAction) {
        const renderData: RenderData = {};
    
        action
            .executeSubaction((action) => {
                this.buildSurfaceRenderObject(topology.tiles, random, action);
            }, 8, 'Building Surface Visuals')
            .getResult<RenderSurface>((result) => {
                renderData.surface = result;
            })
            .executeSubaction((action) => {
                this.buildPlateBoundariesRenderObject(topology.borders, action);
            }, 1, 'Building Plate Boundary Visuals')
            .getResult<RenderPlateBoundaries>((result) => {
                renderData.plateBoundaries = result;
            })
            .executeSubaction((action) => {
                this.buildPlateMovementsRenderObject(topology.tiles, action);
            }, 2, 'Building Plate Movement Visuals')
            .getResult<RenderPlateMovement>((result) => {
                renderData.plateMovements = result;
            })
            .executeSubaction((action) => {
                this.buildAirCurrentsRenderObject(topology.corners, action);
            }, 2, 'Building Air Current Visuals')
            .getResult<RenderAirCurrents>((result) => {
                renderData.airCurrents = result;
            });
    
        action.provideResult<RenderData>(renderData);
    }
    
    buildSurfaceRenderObject(tiles: Tile[], random: XorShift128, action: SteppedAction) {
        const planetGeometry = new Geometry();
        const terrainColors: Color[][] = [];
        const plateColors: Color[][] = [];
        const elevationColors: Color[][] = [];
        const temperatureColors: Color[][] = [];
        const moistureColors: Color[][] = [];
    
        let i = 0;
        action.executeSubaction((action) => {
            if (i >= tiles.length) return;
    
            const tile = tiles[i];
    
            const colorDeviance = new Color(random.unit(), random.unit(), random.unit());
            let terrainColor;
            if (tile.elevation <= 0) {
                if (tile.biome === 'ocean') terrainColor = new Color(0x0066FF).lerp(new Color(0x0044BB), Math.min(-tile.elevation, 1)).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'oceanGlacier') terrainColor = new Color(0xDDEEFF).lerp(colorDeviance, 0.10);
                else terrainColor = new Color(0xFF00FF);
            } else if (tile.elevation < 0.6) {
                const normalizedElevation = tile.elevation / 0.6;
                if (tile.biome === 'desert') terrainColor = new Color(0xDDDD77).lerp(new Color(0xBBBB55), normalizedElevation).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'rainForest') terrainColor = new Color(0x44DD00).lerp(new Color(0x229900), normalizedElevation).lerp(colorDeviance, 0.20);
                else if (tile.biome === 'rocky') terrainColor = new Color(0xAA9977).lerp(new Color(0x887755), normalizedElevation).lerp(colorDeviance, 0.15);
                else if (tile.biome === 'plains') terrainColor = new Color(0x99BB44).lerp(new Color(0x667722), normalizedElevation).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'grassland') terrainColor = new Color(0x77CC44).lerp(new Color(0x448822), normalizedElevation).lerp(colorDeviance, 0.15);
                else if (tile.biome === 'swamp') terrainColor = new Color(0x77AA44).lerp(new Color(0x446622), normalizedElevation).lerp(colorDeviance, 0.25);
                else if (tile.biome === 'deciduousForest') terrainColor = new Color(0x33AA22).lerp(new Color(0x116600), normalizedElevation).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'tundra') terrainColor = new Color(0x9999AA).lerp(new Color(0x777788), normalizedElevation).lerp(colorDeviance, 0.15);
                else if (tile.biome === 'landGlacier') terrainColor = new Color(0xDDEEFF).lerp(colorDeviance, 0.10);
                else terrainColor = new Color(0xFF00FF);
            } else if (tile.elevation < 0.8) {
                const normalizedElevation = (tile.elevation - 0.6) / 0.2;
                if (tile.biome === 'tundra') terrainColor = new Color(0x777788).lerp(new Color(0x666677), normalizedElevation).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'coniferForest') terrainColor = new Color(0x338822).lerp(new Color(0x116600), normalizedElevation).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'snow') terrainColor = new Color(0xEEEEEE).lerp(new Color(0xDDDDDD), normalizedElevation).lerp(colorDeviance, 0.10);
                else if (tile.biome === 'mountain') terrainColor = new Color(0x555544).lerp(new Color(0x444433), normalizedElevation).lerp(colorDeviance, 0.05);
                else terrainColor = new Color(0xFF00FF);
            } else {
                const normalizedElevation = Math.min((tile.elevation - 0.8) / 0.5, 1);
                if (tile.biome === 'mountain') terrainColor = new Color(0x444433).lerp(new Color(0x333322), normalizedElevation).lerp(colorDeviance, 0.05);
                else if (tile.biome === 'snowyMountain') terrainColor = new Color(0xDDDDDD).lerp(new Color(0xFFFFFF), normalizedElevation).lerp(colorDeviance, 0.10);
                else terrainColor = new Color(0xFF00FF);
            }
    
            const plateColor = tile.plate?.color.clone();
    
            let elevationColor;
            if (tile.elevation <= 0) elevationColor = new Color(0x224488).lerp(new Color(0xAADDFF), Math.max(0, Math.min((tile.elevation + 3 / 4) / (3 / 4), 1)));
            else if (tile.elevation < 0.75) elevationColor = new Color(0x997755).lerp(new Color(0x553311), Math.max(0, Math.min((tile.elevation) / (3 / 4), 1)));
            else elevationColor = new Color(0x553311).lerp(new Color(0x222222), Math.max(0, Math.min((tile.elevation - 3 / 4) / (1 / 2), 1)));
    
            let temperatureColor;
            if (tile.temperature <= 0) temperatureColor = new Color(0x0000FF).lerp(new Color(0xBBDDFF), Math.max(0, Math.min((tile.temperature + 2 / 3) / (2 / 3), 1)));
            else temperatureColor = new Color(0xFFFF00).lerp(new Color(0xFF0000), Math.max(0, Math.min((tile.temperature) / (3 / 3), 1)));
    
            const moistureColor = new Color(0xFFCC00).lerp(new Color(0x0066FF), Math.max(0, Math.min(tile.moisture, 1)));
    
            const baseIndex = planetGeometry.vertices.length;
            if (tile.averagePosition && plateColor) {
                planetGeometry.vertices.push(tile.averagePosition);
                for (let j = 0; j < tile.corners.length; ++j) {
                    const cornerPosition = tile.corners[j].position;
                    planetGeometry.vertices.push(cornerPosition);
                    planetGeometry.vertices.push(tile.averagePosition.clone().sub(cornerPosition).multiplyScalar(0.1).add(cornerPosition));
        
                    const i0 = j * 2;
                    const i1 = ((j + 1) % tile.corners.length) * 2;
                    if (tile.normal) {
                        this.buildTileWedge(planetGeometry.faces, baseIndex, i0, i1, tile.normal);
                    }
                    this.buildTileWedgeColors(terrainColors, terrainColor, terrainColor.clone().multiplyScalar(0.5));
                    this.buildTileWedgeColors(plateColors, plateColor, plateColor.clone().multiplyScalar(0.5));
                    this.buildTileWedgeColors(elevationColors, elevationColor, elevationColor.clone().multiplyScalar(0.5));
                    this.buildTileWedgeColors(temperatureColors, temperatureColor, temperatureColor.clone().multiplyScalar(0.5));
                    this.buildTileWedgeColors(moistureColors, moistureColor, moistureColor.clone().multiplyScalar(0.5));

                    for (let k = planetGeometry.faces.length - 3; k < planetGeometry.faces.length; ++k) {
                        planetGeometry.faces[k].vertexColors = terrainColors[k];
                    }
                }
            }
    
            ++i;
    
            action.loop(i / tiles.length);
        });
    
        //planetGeometry.dynamic = true;
        planetGeometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1000);
        const planetMaterial = new MeshLambertMaterial({
            color: new Color(0x000000),
            //ambient: new Color(0xFFFFFF),
            vertexColors: true
        });
        const planetRenderObject = new Mesh(planetGeometry, planetMaterial);
    
        action.provideResult<RenderSurface>({
            geometry: planetGeometry,
            terrainColors: terrainColors,
            plateColors: plateColors,
            elevationColors: elevationColors,
            temperatureColors: temperatureColors,
            moistureColors: moistureColors,
            material: planetMaterial,
            renderObject: planetRenderObject,
        });
    }
    
    buildPlateBoundariesRenderObject(borders: Border[], action: SteppedAction) {
        const geometry = new Geometry();
    
        let i = 0;
        action.executeSubaction((action) => {
            if (i >= borders.length) return;
    
            const border = borders[i];
            if (border.betweenPlates && border.midpoint) {
                const normal = border.midpoint.clone().normalize();
                const offset = normal.clone().multiplyScalar(1);
    
                const borderPoint0 = border.corners[0].position;
                const borderPoint1 = border.corners[1].position;
                const tilePoint0 = border.tiles[0].averagePosition;
                const tilePoint1 = border.tiles[1].averagePosition;

                if (tilePoint0 && tilePoint1) {
                    const baseIndex = geometry.vertices.length;
                    geometry.vertices.push(borderPoint0.clone().add(offset));
                    geometry.vertices.push(borderPoint1.clone().add(offset));
                    geometry.vertices.push(tilePoint0.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
                    geometry.vertices.push(tilePoint0.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));
                    geometry.vertices.push(tilePoint1.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
                    geometry.vertices.push(tilePoint1.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));
        
                    const pressure = Math.max(-1, Math.min((border.corners[0].pressure + border.corners[1].pressure) / 2, 1));
                    const shear = Math.max(0, Math.min((border.corners[0].shear + border.corners[1].shear) / 2, 1));
                    const innerColor = (pressure <= 0) ? new Color(1 + pressure, 1, 0) : new Color(1, 1 - pressure, 0);
                    const outerColor = new Color(0, shear / 2, shear);
        
                    geometry.faces.push(new Face3(baseIndex + 0, baseIndex + 1, baseIndex + 2, normal, [innerColor, innerColor, outerColor]));
                    geometry.faces.push(new Face3(baseIndex + 1, baseIndex + 3, baseIndex + 2, normal, [innerColor, outerColor, outerColor]));
                    geometry.faces.push(new Face3(baseIndex + 1, baseIndex + 0, baseIndex + 5, normal, [innerColor, innerColor, outerColor]));
                    geometry.faces.push(new Face3(baseIndex + 0, baseIndex + 4, baseIndex + 5, normal, [innerColor, outerColor, outerColor]));
                }
            }
    
            ++i;
    
            action.loop(i / borders.length);
        });
    
        geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1010);
        const material = new MeshBasicMaterial({
            vertexColors: true
        });
        const renderObject = new Mesh(geometry, material);
    
        action.provideResult<RenderPlateBoundaries>({
            geometry: geometry,
            material: material,
            renderObject: renderObject,
        });
    }
    
    buildPlateMovementsRenderObject(tiles: Tile[], action: SteppedAction) {
        const geometry = new Geometry();
    
        let i = 0;
        action.executeSubaction((action) => {
            if (i >= tiles.length) return;
    
            const tile = tiles[i];
            const plate = tile.plate;
            if (plate) {
                const movement = plate.calculateMovement(tile.position);
                const plateMovementColor = new Color(1 - plate.color.r, 1 - plate.color.g, 1 - plate.color.b);
        
                this.buildArrow(geometry, tile.position.clone().multiplyScalar(1.002), movement.clone().multiplyScalar(0.5), tile.position.clone().normalize(), Math.min(movement.length(), 4), plateMovementColor);
        
                tile.plateMovement = movement;
            }
    
            ++i;
    
            action.loop(i / tiles.length);
        });
    
        geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1010);
        const material = new MeshBasicMaterial({
            vertexColors: true,
        });
        const renderObject = new Mesh(geometry, material);
    
        action.provideResult<RenderPlateMovement>({
            geometry: geometry,
            material: material,
            renderObject: renderObject,
        });
    }
    
    buildAirCurrentsRenderObject(corners: Corner[], action: SteppedAction) {
        const geometry = new Geometry();
    
        let i = 0;
        action.executeSubaction((action) => {
            if (i >= corners.length) return;
    
            const corner = corners[i];
            if (corner.airCurrent) {
                this.buildArrow(geometry, corner.position.clone().multiplyScalar(1.002), corner.airCurrent.clone().multiplyScalar(0.5), corner.position.clone().normalize(), Math.min(corner.airCurrent.length(), 4));
            }
    
            ++i;
    
            action.loop(i / corners.length);
        });
    
        geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1010);
        const material = new MeshBasicMaterial({
            color: new Color(0xFFFFFF),
        });
        const renderObject = new Mesh(geometry, material);
    
        action.provideResult<RenderAirCurrents>({
            geometry: geometry,
            material: material,
            renderObject: renderObject,
        });
    }
    
    buildArrow(geometry: Geometry, position: Vector3, direction: Vector3, normal: Vector3, baseWidth: number, color: Color = new Color('white')) {
        if (direction.lengthSq() === 0) return;
        const sideOffset = direction.clone().cross(normal).setLength(baseWidth / 2);
        const baseIndex = geometry.vertices.length;
        geometry.vertices.push(position.clone().add(sideOffset), position.clone().add(direction), position.clone().sub(sideOffset));
        geometry.faces.push(new Face3(baseIndex, baseIndex + 2, baseIndex + 1, normal, [color, color, color]));
    }
    
    buildTileWedge(f: Face3[], b: number, s: number, t: number, n: Vector3) {
        f.push(new Face3(b + s + 2, b + t + 2, b, n));
        f.push(new Face3(b + s + 1, b + t + 1, b + t + 2, n));
        f.push(new Face3(b + s + 1, b + t + 2, b + s + 2, n));
    }
    
    buildTileWedgeColors(f: Color[][], c: Color, bc: Color) {
        f.push([c, c, c]);
        f.push([bc, bc, c]);
        f.push([bc, c, c]);
    }
    
    generatePlanetStatistics(topology: Topology, plates: Plate[], action: SteppedAction) {
        const statistics: Statistics = {};
    
        const updateMinMaxAvg = (stats: StatisticsItem, value: number) => {
            stats.min = Math.min(stats.min, value);
            stats.max = Math.max(stats.max, value);
            stats.avg += value;
        };
    
        statistics.corners = {
            count: topology.corners.length,
            airCurrent: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            elevation: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            temperature: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            moisture: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            distanceToPlateBoundary: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            distanceToPlateRoot: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            pressure: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            shear: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            doublePlateBoundaryCount: 0,
            triplePlateBoundaryCount: 0,
            innerLandBoundaryCount: 0,
            outerLandBoundaryCount: 0,
        };
    
        for (let i = 0; i < topology.corners.length; ++i) {
            const corner = topology.corners[i];
            if (corner.airCurrent) {
                updateMinMaxAvg(statistics.corners.airCurrent, corner.airCurrent.length());
            }
            updateMinMaxAvg(statistics.corners.elevation, corner.elevation);
            updateMinMaxAvg(statistics.corners.temperature, corner.temperature);
            updateMinMaxAvg(statistics.corners.moisture, corner.moisture);
            if (corner.distanceToPlateBoundary) {
                updateMinMaxAvg(statistics.corners.distanceToPlateBoundary, corner.distanceToPlateBoundary);
            }
            if (corner.distanceToPlateRoot) {
                updateMinMaxAvg(statistics.corners.distanceToPlateRoot, corner.distanceToPlateRoot);
            }
            if (corner.betweenPlates) {
                updateMinMaxAvg(statistics.corners.pressure, corner.pressure);
                updateMinMaxAvg(statistics.corners.shear, corner.shear);
                if (!corner.borders[0].betweenPlates || !corner.borders[1].betweenPlates || !corner.borders[2].betweenPlates) {
                    statistics.corners.doublePlateBoundaryCount += 1;
                } else {
                    statistics.corners.triplePlateBoundaryCount += 1;
                }
            }
            const landCount = ((corner.tiles[0].elevation > 0) ? 1 : 0) + ((corner.tiles[1].elevation > 0) ? 1 : 0) + ((corner.tiles[2].elevation > 0) ? 1 : 0);
            if (landCount === 2) {
                statistics.corners.innerLandBoundaryCount += 1;
            } else if (landCount === 1) {
                statistics.corners.outerLandBoundaryCount += 1;
            }
            if (corner.corners.length !== 3) throw 'Corner has as invalid number of neighboring corners.';
            if (corner.borders.length !== 3) throw 'Corner has as invalid number of borders.';
            if (corner.tiles.length !== 3) throw 'Corner has as invalid number of tiles.';
        }
    
        statistics.corners.airCurrent.avg /= statistics.corners.count;
        statistics.corners.elevation.avg /= statistics.corners.count;
        statistics.corners.temperature.avg /= statistics.corners.count;
        statistics.corners.moisture.avg /= statistics.corners.count;
        statistics.corners.distanceToPlateBoundary.avg /= statistics.corners.count;
        statistics.corners.distanceToPlateRoot.avg /= statistics.corners.count;
        statistics.corners.pressure.avg /= (statistics.corners.doublePlateBoundaryCount + statistics.corners.triplePlateBoundaryCount);
        statistics.corners.shear.avg /= (statistics.corners.doublePlateBoundaryCount + statistics.corners.triplePlateBoundaryCount);
    
        statistics.borders = {
            count: topology.borders.length,
            length: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            plateBoundaryCount: 0,
            plateBoundaryPercentage: 0,
            landBoundaryCount: 0,
            landBoundaryPercentage: 0,
        };
    
        for (let i = 0; i < topology.borders.length; ++i) {
            const border = topology.borders[i];
            const length = border.length();
            updateMinMaxAvg(statistics.borders.length, length);
            if (border.betweenPlates) {
                statistics.borders.plateBoundaryCount += 1;
                statistics.borders.plateBoundaryPercentage += length;
            }
            if (border.isLandBoundary()) {
                statistics.borders.landBoundaryCount += 1;
                statistics.borders.landBoundaryPercentage += length;
            }
            if (border.corners.length !== 2) throw 'Border has as invalid number of corners.';
            if (border.borders.length !== 4) throw 'Border has as invalid number of neighboring borders.';
            if (border.tiles.length !== 2) throw 'Border has as invalid number of tiles.';
        }
    
        statistics.borders.plateBoundaryPercentage /= statistics.borders.length.avg;
        statistics.borders.landBoundaryPercentage /= statistics.borders.length.avg;
        statistics.borders.length.avg /= statistics.borders.count;
    
        statistics.tiles = {
            count: topology.tiles.length,
            totalArea: 0,
            area: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            elevation: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            temperature: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            moisture: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            plateMovement: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            biomeCounts: {},
            biomeAreas: {},
            pentagonCount: 0,
            hexagonCount: 0,
            heptagonCount: 0,
        };
    
        for (let i = 0; i < topology.tiles.length; ++i) {
            const tile = topology.tiles[i];
            updateMinMaxAvg(statistics.tiles.area, tile.area);
            updateMinMaxAvg(statistics.tiles.elevation, tile.elevation);
            updateMinMaxAvg(statistics.tiles.temperature, tile.temperature);
            updateMinMaxAvg(statistics.tiles.moisture, tile.moisture);
            if (tile.plateMovement) {
                updateMinMaxAvg(statistics.tiles.plateMovement, tile.plateMovement.length());
            }
            if (tile.biome) {
                if (!statistics.tiles.biomeCounts[tile.biome]) statistics.tiles.biomeCounts[tile.biome] = 0;
                statistics.tiles.biomeCounts[tile.biome] += 1;
                if (!statistics.tiles.biomeAreas[tile.biome]) statistics.tiles.biomeAreas[tile.biome] = 0;
                statistics.tiles.biomeAreas[tile.biome] += tile.area;
            }
            if (tile.tiles.length === 5) statistics.tiles.pentagonCount += 1;
            else if (tile.tiles.length === 6) statistics.tiles.hexagonCount += 1;
            else if (tile.tiles.length === 7) statistics.tiles.heptagonCount += 1;
            else throw 'Tile has an invalid number of neighboring tiles.';
            if (tile.tiles.length !== tile.borders.length) throw 'Tile has a neighbor and border count that do not match.';
            if (tile.tiles.length !== tile.corners.length) throw 'Tile has a neighbor and corner count that do not match.';
        }
    
        statistics.tiles.totalArea = statistics.tiles.area.avg;
        statistics.tiles.area.avg /= statistics.tiles.count;
        statistics.tiles.elevation.avg /= statistics.tiles.count;
        statistics.tiles.temperature.avg /= statistics.tiles.count;
        statistics.tiles.moisture.avg /= statistics.tiles.count;
        statistics.tiles.plateMovement.avg /= statistics.tiles.count;
    
        statistics.plates = {
            count: plates.length,
            tileCount: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            area: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            boundaryElevation: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            boundaryBorders: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
            circumference: {
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                avg: 0
            },
        };
    
        for (let i = 0; i < plates.length; ++i) {
            const plate = plates[i];
            updateMinMaxAvg(statistics.plates.tileCount, plate.tiles.length);
            plate.area = 0;
            for (let j = 0; j < plate.tiles.length; ++j) {
                const tile = plate.tiles[j];
                plate.area += tile.area;
            }
            updateMinMaxAvg(statistics.plates.area, plate.area);
            let elevation = 0;
            for (let j = 0; j < plate.boundaryCorners.length; ++j) {
                const corner = plate.boundaryCorners[j];
                elevation += corner.elevation;
            }
            updateMinMaxAvg(statistics.plates.boundaryElevation, elevation / plate.boundaryCorners.length);
            updateMinMaxAvg(statistics.plates.boundaryBorders, plate.boundaryBorders.length);
            plate.circumference = 0;
            for (let j = 0; j < plate.boundaryBorders.length; ++j) {
                const border = plate.boundaryBorders[j];
                plate.circumference += border.length();
            }
            updateMinMaxAvg(statistics.plates.circumference, plate.circumference);
        }
    
        statistics.plates.tileCount.avg /= statistics.plates.count;
        statistics.plates.area.avg /= statistics.plates.count;
        statistics.plates.boundaryElevation.avg /= statistics.plates.count;
        statistics.plates.boundaryBorders.avg /= statistics.plates.count;
        statistics.plates.circumference.avg /= statistics.plates.count;
    
        action.provideResult<Statistics>(statistics);
    }
    getZoomDelta() {
        const zoomIn = (this.pressedKeys[KEY_NUMPAD_PLUS] || this.pressedKeys[KEY_PAGEUP]);
        const zoomOut = (this.pressedKeys[KEY_NUMPAD_MINUS] || this.pressedKeys[KEY_PAGEDOWN]);
        if (zoomIn && !zoomOut) return -1;
        if (zoomOut && !zoomIn) return +1;
        return 0;
    }
    
    getLatitudeDelta() {
        const up = (this.pressedKeys[KEY.W] || this.pressedKeys[KEY.Z] || this.pressedKeys[KEY_UPARROW]);
        const down = (this.pressedKeys[KEY.S] || this.pressedKeys[KEY_DOWNARROW]);
        if (up && !down) return +1;
        if (down && !up) return -1;
        return 0;
    }
    
    getLongitudeDelta() {
        const left = (this.pressedKeys[KEY.A] || this.pressedKeys[KEY.Q] || this.pressedKeys[KEY_LEFTARROW]);
        const right = (this.pressedKeys[KEY.D] || this.pressedKeys[KEY_RIGHTARROW]);
        if (right && !left) return +1;
        if (left && !right) return -1;
        return 0;
    }
    
    animate() {
        if (this.renderer) {
            const currentRenderFrameTime = Date.now();
            const frameDuration = this.lastRenderFrameTime ? (currentRenderFrameTime - this.lastRenderFrameTime) * 0.001 : 0;
        
            let cameraNeedsUpdated = false;
            if (this.zoomAnimationStartTime && this.zoomAnimationDuration && this.zoomAnimationEndValue) {
                if (this.zoomAnimationStartTime + this.zoomAnimationDuration <= currentRenderFrameTime) {
                    this.zoom = this.zoomAnimationEndValue;
                    this.zoomAnimationStartTime = undefined;
                    this.zoomAnimationDuration = undefined;
                    this.zoomAnimationStartValue = undefined;
                    this.zoomAnimationEndValue = undefined;
                } else {
                    if (this.zoomAnimationStartValue) {
                        const zoomAnimationProgress = (currentRenderFrameTime - this.zoomAnimationStartTime) / this.zoomAnimationDuration;
                        this.zoom = (this.zoomAnimationEndValue - this.zoomAnimationStartValue) * zoomAnimationProgress + this.zoomAnimationStartValue;
                    }
                }
                cameraNeedsUpdated = true;
            }
        
            const cameraZoomDelta = this.getZoomDelta();
            if (frameDuration > 0 && cameraZoomDelta !== 0) {
                this.zoom = Math.max(0, Math.min(this.zoom + frameDuration * cameraZoomDelta * 0.5, 1));
                cameraNeedsUpdated = true;
            }
        
            const cameraLatitudeDelta = this.getLatitudeDelta();
            if (frameDuration > 0 && cameraLatitudeDelta !== 0) {
                this.cameraLatitude += frameDuration * -cameraLatitudeDelta * Math.PI * (this.zoom * 0.5 + (1 - this.zoom) * 1 / 20);
                this.cameraLatitude = Math.max(-Math.PI * 0.49, Math.min(this.cameraLatitude, Math.PI * 0.49));
                cameraNeedsUpdated = true;
            }
        
            const cameraLongitudeDelta = this.getLongitudeDelta();
            if (frameDuration > 0 && cameraLongitudeDelta !== 0) {
                this.cameraLongitude += frameDuration * cameraLongitudeDelta * Math.PI * (this.zoom * Math.PI / 8 + (1 - this.zoom) / (20 * Math.max(Math.cos(this.cameraLatitude), 0.1)));
                this.cameraLongitude = this.cameraLongitude - Math.floor(this.cameraLongitude / (Math.PI * 2)) * Math.PI * 2;
                cameraNeedsUpdated = true;
            }
        
            if (cameraNeedsUpdated) this.updateCamera();
        
            const sunTime = Math.PI * 2 * currentRenderFrameTime / 60000 + this.sunTimeOffset;
            this.directionalLight.position.set(Math.cos(sunTime), 0, Math.sin(sunTime)).normalize();
        
            requestAnimationFrame(() => this.animate());
            this.renderer.render(this.scene, this.camera);
        
            this.lastRenderFrameTime = currentRenderFrameTime;
        }
    }
    
    resizeHandler() {
        this.updateCamera();
        this.renderer?.setSize(window.innerWidth, window.innerHeight);
    }
    
    resetCamera() {
        this.zoom = 1.0;
        this.zoomAnimationStartTime = undefined;
        this.zoomAnimationDuration = undefined;
        this.zoomAnimationStartValue = undefined;
        this.zoomAnimationEndValue = undefined;
        this.cameraLatitude = 0;
        this.cameraLongitude = 0;
    }
    
    updateCamera() {
        //this.camera.aspect = window.innerWidth / window.innerHeight;=
    
        const transformation = new Matrix4().makeRotationFromEuler(new Euler(this.cameraLatitude, this.cameraLongitude, 0, 'YXZ'));
        this.camera.position.set(0, -50, 1050);
        this.camera.position.lerp(new Vector3(0, 0, 2000), Math.pow(this.zoom, 2.0));
        this.camera.position.applyMatrix4(transformation);
        this.camera.up.set(0, 1, 0);
        this.camera.up.applyMatrix4(transformation);
        this.camera.lookAt(new Vector3(0, 0, 1000).applyMatrix4(transformation));
        //this.camera.updateProjectionMatrix();
    }
    
    // zoomHandler(event) {
    //     if (this.zoomAnimationStartTime) {
    //         this.zoomAnimationStartTime = Date.now();
    //         this.zoomAnimationStartValue = this.zoom;
    //         this.zoomAnimationEndValue = Math.max(0, Math.min(this.zoomAnimationStartValue - event.deltaY * 0.04, 1));
    //         this.zoomAnimationDuration = Math.abs(this.zoomAnimationStartValue - this.zoomAnimationEndValue) * 1000;
    //     } else if (this.zoomAnimationEndValue) {
    //         this.zoomAnimationStartTime = Date.now();
    //         this.zoomAnimationStartValue = this.zoom;
    //         this.zoomAnimationEndValue = Math.max(0, Math.min(this.zoomAnimationEndValue - event.deltaY * 0.04, 1));
    //         this.zoomAnimationDuration = Math.abs(this.zoomAnimationStartValue - this.zoomAnimationEndValue) * 1000;
    //     }
    // }
    
    selectTile(tile: Tile) {
        if (this.tileSelection) {
            if (this.tileSelection.tile === tile) return;
            this.deselectTile();
        }
    
        console.log(tile);

        if (tile.averagePosition && tile.boundingSphere) {
            const outerColor = new Color(0x000000);
            const innerColor = new Color(0xFFFFFF);
        
            const geometry = new Geometry();
        
            geometry.vertices.push(tile.averagePosition);
            for (let i = 0; i < tile.corners.length; ++i) {
                geometry.vertices.push(tile.corners[i].position);
                geometry.faces.push(new Face3(i + 1, (i + 1) % tile.corners.length + 1, 0, tile.normal, [outerColor, outerColor, innerColor]));
            }
        
            geometry.boundingSphere = tile.boundingSphere.clone();
        
            const material = new MeshLambertMaterial({
                vertexColors: true
            });
            material.transparent = true;
            material.opacity = 0.5;
            material.polygonOffset = true;
            material.polygonOffsetFactor = -2;
            material.polygonOffsetUnits = -2;
            this.tileSelection = {
                tile: tile,
                renderObject: new Mesh(geometry, material)
            };
            this.planet?.renderData?.surface?.renderObject.add(this.tileSelection.renderObject);
        }
    }
    
    deselectTile() {
        if (this.tileSelection) {
            this.planet?.renderData?.surface?.renderObject.remove(this.tileSelection.renderObject);
            this.tileSelection = undefined;
        }
    }
    
    // clickHandler(event) {
    //     if (this.renderer && this.planet) {
    //         const x = event.pageX / this.renderer.domElement.width * 2 - 1;
    //         const y = 1 - event.pageY / this.renderer.domElement.height * 2;
    //         const rayCaster = new Raycaster(new Vector3(x, y, 0), this.camera.position);
    //         const intersection = this.planet.partition?.intersectRay(rayCaster.ray);
    //         if (intersection)
    //             this.selectTile(intersection);
    //         else
    //             this.deselectTile();
    //     }
    // }
    
    // keyDownHandler(event) {
    //     if (this.disableKeys === true) return;
    
    //     switch (event.which) {
    //     case KEY.W:
    //     case KEY.A:
    //     case KEY.S:
    //     case KEY.D:
    //     case KEY.Z:
    //     case KEY.Q:
    //     case KEY_LEFTARROW:
    //     case KEY_RIGHTARROW:
    //     case KEY_UPARROW:
    //     case KEY_DOWNARROW:
    //     case KEY_PAGEUP:
    //     case KEY_PAGEDOWN:
    //     case KEY_NUMPAD_PLUS:
    //     case KEY_NUMPAD_MINUS:
    //         this.pressedKeys[event.which] = true;
    //         event.preventDefault();
    //         break;
    //     }
    // }
    
    // keyUpHandler(event) {
    //     if (this.disableKeys === true) return;
    
    //     switch (event.which) {
    //     case KEY.W:
    //     case KEY.A:
    //     case KEY.S:
    //     case KEY.D:
    //     case KEY.Z:
    //     case KEY.Q:
    //     case KEY_LEFTARROW:
    //     case KEY_RIGHTARROW:
    //     case KEY_UPARROW:
    //     case KEY_DOWNARROW:
    //     case KEY_PAGEUP:
    //     case KEY_PAGEDOWN:
    //     case KEY_NUMPAD_PLUS:
    //     case KEY_NUMPAD_MINUS:
    //         this.pressedKeys[event.which] = false;
    //         event.preventDefault();
    //         break;
    //     case KEY_ESCAPE:
    //         if (this.activeAction) {
    //             ui.progressCancelButton.click();
    //             event.preventDefault();
    //         }
    //         break;
    //     case KEY_FORWARD_SLASH:
    //     case KEY['0']:
    //         this.showHideInterface();
    //         event.preventDefault();
    //         break;
    //     case KEY_SPACE:
    //         this.generatePlanetAsynchronous();
    //         event.preventDefault();
    //         break;
    //     case KEY['1']:
    //         setSubdivisions(20);
    //         this.generatePlanetAsynchronous();
    //         event.preventDefault();
    //         break;
    //     case KEY['2']:
    //         setSubdivisions(40);
    //         this.generatePlanetAsynchronous();
    //         event.preventDefault();
    //         break;
    //     case KEY['3']:
    //         setSubdivisions(60);
    //         this.generatePlanetAsynchronous();
    //         event.preventDefault();
    //         break;
    //     case KEY['5']:
    //         this.setSurfaceRenderMode('terrain');
    //         event.preventDefault();
    //         break;
    //     case KEY['6']:
    //         this.setSurfaceRenderMode('plates');
    //         event.preventDefault();
    //         break;
    //     case KEY['7']:
    //         this.setSurfaceRenderMode('elevation');
    //         event.preventDefault();
    //         break;
    //     case KEY['8']:
    //         this.setSurfaceRenderMode('temperature');
    //         event.preventDefault();
    //         break;
    //     case KEY['9']:
    //         this.setSurfaceRenderMode('moisture');
    //         event.preventDefault();
    //         break;
    //     case KEY.U:
    //         this.showHideSunlight();
    //         event.preventDefault();
    //         break;
    //     case KEY.I:
    //         this.showHidePlateBoundaries();
    //         event.preventDefault();
    //         break;
    //     case KEY.O:
    //         this.showHidePlateMovements();
    //         event.preventDefault();
    //         break;
    //     case KEY.P:
    //         this.showHideAirCurrents();
    //         event.preventDefault();
    //         break;
    //     }
    // }
    
    // cancelButtonHandler() {
    //     if (this.activeAction) {
    //         this.activeAction.cancel();
    //     }
    // }
    
    displayPlanet(newPlanet: Planet) {
        if (this.planet?.renderData?.surface) {
            this.tileSelection = undefined;
            this.scene.remove(this.planet.renderData.surface.renderObject);
        } else {
            this.sunTimeOffset = Math.PI * 2 * (1 / 12 - Date.now() / 60000);
        }
    
        this.planet = newPlanet;
        if (this.planet.renderData?.surface) {
            this.scene.add(this.planet.renderData.surface.renderObject);
        }
    
        this.setSurfaceRenderMode(this.surfaceRenderMode, true);
        this.showHideSunlight(this.renderSunlight);
        this.showHidePlateBoundaries(this.renderPlateBoundaries);
        this.showHidePlateMovements(this.renderPlateMovements);
        this.showHideAirCurrents(this.renderAirCurrents);
    
    
        this.updateCamera();
        this.updateUI();
    
        console.log('Original Seed', this.planet?.originalSeed);
        console.log('Raw Seed', this.planet?.seed);
        console.log('Statistics', this.planet?.statistics);
    }
    
    showHideInterface() {
        // ui.helpPanel.toggle();
        // ui.controlPanel.toggle();
        // ui.dataPanel.toggle();
        // ui.updatePanel.toggle();
    }
    
    updateUI() {
        // ui.tileCountLabel.text(this.planet.statistics.tiles.count.toFixed(0));
        // ui.pentagonCountLabel.text(this.planet.statistics.tiles.pentagonCount.toFixed(0));
        // ui.hexagonCountLabel.text(this.planet.statistics.tiles.hexagonCount.toFixed(0));
        // ui.heptagonCountLabel.text(this.planet.statistics.tiles.heptagonCount.toFixed(0));
        // ui.plateCountLabel.text(this.planet.statistics.plates.count.toFixed(0));
        // ui.waterPercentageLabel.text(((this.planet.statistics.tiles.biomeAreas['ocean'] + this.planet.statistics.tiles.biomeAreas['oceanGlacier']) / this.planet.statistics.tiles.totalArea * 100).toFixed(0) + '%');
    
        // ui.rawSeedLabel.val(this.planet.seed);
        // ui.originalSeedLabel.val(this.planet.originalSeed !== null ? this.planet.originalSeed : '');
    
        // ui.minAirCurrentSpeedLabel.text(this.planet.statistics.corners.airCurrent.min.toFixed(0));
        // ui.avgAirCurrentSpeedLabel.text(this.planet.statistics.corners.airCurrent.avg.toFixed(0));
        // ui.maxAirCurrentSpeedLabel.text(this.planet.statistics.corners.airCurrent.max.toFixed(0));
    
        // ui.minElevationLabel.text((this.planet.statistics.tiles.elevation.min * 100).toFixed(0));
        // ui.avgElevationLabel.text((this.planet.statistics.tiles.elevation.avg * 100).toFixed(0));
        // ui.maxElevationLabel.text((this.planet.statistics.tiles.elevation.max * 100).toFixed(0));
    
        // ui.minTemperatureLabel.text((this.planet.statistics.tiles.temperature.min * 100).toFixed(0));
        // ui.avgTemperatureLabel.text((this.planet.statistics.tiles.temperature.avg * 100).toFixed(0));
        // ui.maxTemperatureLabel.text((this.planet.statistics.tiles.temperature.max * 100).toFixed(0));
    
        // ui.minMoistureLabel.text((this.planet.statistics.tiles.moisture.min * 100).toFixed(0));
        // ui.avgMoistureLabel.text((this.planet.statistics.tiles.moisture.avg * 100).toFixed(0));
        // ui.maxMoistureLabel.text((this.planet.statistics.tiles.moisture.max * 100).toFixed(0));
    
        // ui.minPlateMovementSpeedLabel.text(this.planet.statistics.tiles.plateMovement.min.toFixed(0));
        // ui.avgPlateMovementSpeedLabel.text(this.planet.statistics.tiles.plateMovement.avg.toFixed(0));
        // ui.maxPlateMovementSpeedLabel.text(this.planet.statistics.tiles.plateMovement.max.toFixed(0));
    
        // ui.minTileAreaLabel.text(this.planet.statistics.tiles.area.min.toFixed(0));
        // ui.avgTileAreaLabel.text(this.planet.statistics.tiles.area.avg.toFixed(0));
        // ui.maxTileAreaLabel.text(this.planet.statistics.tiles.area.max.toFixed(0));
    
        // ui.minPlateAreaLabel.text((this.planet.statistics.plates.area.min / 1000).toFixed(0) + 'K');
        // ui.avgPlateAreaLabel.text((this.planet.statistics.plates.area.avg / 1000).toFixed(0) + 'K');
        // ui.maxPlateAreaLabel.text((this.planet.statistics.plates.area.max / 1000).toFixed(0) + 'K');
    
        // ui.minPlateCircumferenceLabel.text(this.planet.statistics.plates.circumference.min.toFixed(0));
        // ui.avgPlateCircumferenceLabel.text(this.planet.statistics.plates.circumference.avg.toFixed(0));
        // ui.maxPlateCircumferenceLabel.text(this.planet.statistics.plates.circumference.max.toFixed(0));
    }
    
    updateProgressUI() {
        // const progress = action.getProgress();
        // ui.progressBar.css('width', (progress * 100).toFixed(0) + '%');
        // ui.progressBarLabel.text((progress * 100).toFixed(0) + '%');
        // ui.progressActionLabel.text(action.getCurrentActionName());
    }
    
    setSurfaceRenderMode(mode: string, force: boolean) {
        if (mode !== this.surfaceRenderMode || force) {
            // $('#surfaceDisplayList>button').removeClass('toggled');
            // ui.surfaceDisplayButtons[mode].addClass('toggled');
    
            this.surfaceRenderMode = mode;
    
            if (this.planet?.renderData?.surface) {
                let colors;
                if (mode === 'terrain') colors = this.planet.renderData.surface.terrainColors;
                else if (mode === 'plates') colors = this.planet.renderData.surface.plateColors;
                else if (mode === 'elevation') colors = this.planet.renderData.surface.elevationColors;
                else if (mode === 'temperature') colors = this.planet.renderData.surface.temperatureColors;
                else if (mode === 'moisture') colors = this.planet.renderData.surface.moistureColors;
                else return;
        
                const faces = this.planet.renderData.surface.geometry.faces;
                for (let i = 0; i < faces.length; ++i) faces[i].vertexColors = colors[i];
        
                this.planet.renderData.surface.geometry.colorsNeedUpdate = true;
            }
        }
    }
    
    showHideSunlight(show?: boolean) {
        if (typeof (show) === 'boolean') this.renderSunlight = show;
        else this.renderSunlight = !this.renderSunlight;
        // if (this.renderSunlight) ui.showSunlightButton.addClass('toggled');
        // if (!this.renderSunlight) ui.showSunlightButton.removeClass('toggled');
    
        if (this.planet?.renderData?.surface) {
            const material = this.planet.renderData.surface.material;
            if (this.renderSunlight) {
                material.color = new Color(0xFFFFFF);
                //material.ambient = new Color(0x444444);
            } else {
                material.color = new Color(0x000000);
                //material.ambient = new Color(0xFFFFFF);
            }
            material.needsUpdate = true;
        }
    }
    
    showHidePlateBoundaries(show?: boolean) {
        if (typeof (show) === 'boolean') this.renderPlateBoundaries = show;
        else this.renderPlateBoundaries = !this.renderPlateBoundaries;
        // if (this.renderPlateBoundaries) ui.showPlateBoundariesButton.addClass('toggled');
        // if (!this.renderPlateBoundaries) ui.showPlateBoundariesButton.removeClass('toggled');
    
        if (this.planet?.renderData?.surface && this.planet?.renderData.plateBoundaries) {
            if (this.renderPlateBoundaries) this.planet.renderData.surface.renderObject.add(this.planet.renderData.plateBoundaries.renderObject);
            else this.planet.renderData.surface.renderObject.remove(this.planet.renderData.plateBoundaries.renderObject);
        }
    }
    
    showHidePlateMovements(show?: boolean) {
        if (typeof (show) === 'boolean') this.renderPlateMovements = show;
        else this.renderPlateMovements = !this.renderPlateMovements;
        // if (this.renderPlateMovements) ui.showPlateMovementsButton.addClass('toggled');
        // if (!this.renderPlateMovements) ui.showPlateMovementsButton.removeClass('toggled');
    
        if (this.planet?.renderData?.surface && this.planet?.renderData.plateMovements) {
            if (this.renderPlateMovements) this.planet.renderData.surface.renderObject.add(this.planet.renderData.plateMovements.renderObject);
            else this.planet.renderData.surface.renderObject.remove(this.planet.renderData.plateMovements.renderObject);
        }
    }
    
    showHideAirCurrents(show?: boolean) {
        if (typeof (show) === 'boolean') this.renderAirCurrents = show;
        else this.renderAirCurrents = !this.renderAirCurrents;
        // if (this.renderAirCurrents) ui.showAirCurrentsButton.addClass('toggled');
        // if (!this.renderAirCurrents) ui.showAirCurrentsButton.removeClass('toggled');
    
        if (this.planet?.renderData?.surface && this.planet?.renderData.airCurrents) {
            if (this.renderAirCurrents) this.planet.renderData.surface.renderObject.add(this.planet.renderData.airCurrents.renderObject);
            else this.planet.renderData.surface.renderObject.remove(this.planet.renderData.airCurrents.renderObject);
        }
    }
    
    serializePlanetMesh(mesh: MeshDescription, prefix: string, suffix: string) {
        const stringPieces = [];
    
        stringPieces.push(prefix, '{nodes:[');
        for (let i = 0; i < mesh.nodes.length; ++i) {
            const node = mesh.nodes[i];
            stringPieces.push(i !== 0 ? ',\n{p:new Vector3(' : '\n{p:new Vector3(', node.p.x.toString(), ',', node.p.y.toString(), ',', node.p.z.toString(), '),e:[', node.e[0].toFixed(0));
            for (let j = 1; j < node.e.length; ++j) stringPieces.push(',', node.e[j].toFixed(0));
            stringPieces.push('],f:[', node.f[0].toFixed(0));
            for (let j = 1; j < node.f.length; ++j) stringPieces.push(',', node.f[j].toFixed(0));
            stringPieces.push(']}');
        }
        stringPieces.push('\n],edges:[');
        for (let i = 0; i < mesh.edges.length; ++i) {
            const edge = mesh.edges[i];
            stringPieces.push(i !== 0 ? ',\n{n:[' : '\n{n:[', edge.n[0].toFixed(0), ',', edge.n[1].toFixed(0), '],f:[', edge.f[0].toFixed(0), ',', edge.f[1].toFixed(0), ']}');
        }
        stringPieces.push('\n],faces:[');
        for (let i = 0; i < mesh.faces.length; ++i) {
            const face = mesh.faces[i];
            stringPieces.push(i !== 0 ? ',\n{n:[' : '\n{n:[', face.n[0].toFixed(0), ',', face.n[1].toFixed(0), ',', face.n[2].toFixed(0), '],e:[', face.e[0].toFixed(0), ',', face.e[1].toFixed(0), ',', face.e[2].toFixed(0), ']}');
        }
        stringPieces.push('\n]}', suffix);
    
        return stringPieces.join('');
    }
}

export default App;

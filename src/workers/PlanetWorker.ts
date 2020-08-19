import { MeshDescription } from '../models/MeshDescription';
import Corner from '../models/Corner';
import { expose } from 'comlink';
import Border from '../models/Border';
import Tile from '../models/Tile';
import { Vector3, Color } from 'three';
import Topology from '../models/Topology';
import Plate from '../models/Plate';
import XorShift128 from '../utils/XorShift128';
import { randomUnitVector } from '../utils';
import Whorl from '../models/Whorl';

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
    corners: number[];
    airHeat: number;
}

interface AirMoistureResult {
    corners: number[];
    airMoisture: number;
}

export class PlanetWorker {
    mesh?: MeshDescription;
    readonly corners: Corner[] = [];
    readonly borders: Border[] = [];
    readonly tiles: Tile[] = [];
    topology?: Topology;
    plates: Plate[] = [];
    radius: number = 0;
    readonly random: XorShift128;

    constructor() {
        this.random = new XorShift128(0, 0, 0, 0);
    }

    async init(mesh: MeshDescription, radius: number, seed: number) {
        this.mesh = await MeshDescription.revive(mesh);
        this.radius = radius;
        this.random.reseed(seed, seed, seed, seed);
    }
    
    async generateTopology() {
        this.corners.splice(0, this.corners.length);
        this.borders.splice(0, this.borders.length);
        this.tiles.splice(0, this.tiles.length);

        if (this.mesh) {
            for (let i = 0; i < this.mesh.faces.length; i++) {
                const face = this.mesh.faces[i];
                this.corners.push(new Corner(i, face.centroid.clone().multiplyScalar(this.radius), face.e.length, face.e.length, face.n.length));
            }
            
            for (let i = 0; i < this.mesh.edges.length; i++) {
                this.borders.push(new Border(i, 2, 4, 2));
            }
            
            for (let i = 0; i < this.mesh.nodes.length; i++) {
                const node = this.mesh.nodes[i];
                this.tiles.push(new Tile(i, node.p.clone().multiplyScalar(this.radius), node.f.length, node.e.length, node.e.length));
            }
    
            for (let i = 0; i < this.corners.length; i++) {
                const corner = this.corners[i];
                const face = this.mesh.faces[i];
                for (let j = 0; j < face.e.length; j++) {
                    corner.borders[j] = face.e[j];
                }
                for (let j = 0; j < face.n.length; j++) {
                    corner.tiles[j] = face.n[j];
                }
            }
                
            for (let i = 0; i < this.borders.length; i++) {
                const border = this.borders[i];
                const edge = this.mesh.edges[i];
                const averageCorner = new Vector3(0, 0, 0);
    
                let n = 0;
                for (let j = 0; j < edge.f.length; j++) {
                    const corner = this.corners[edge.f[j]];
                    averageCorner.add(corner.position);
                    
                    border.corners[j] = edge.f[j];
    
                    for (let k = 0; k < corner.borders.length; k++) {
                        if (corner.borders[k] !== i) {
                            border.borders[n++] = corner.borders[k];
                        }
                    }
                }
    
                border.midpoint = averageCorner.multiplyScalar(1 / border.corners.length);
                
                for (let j = 0; j < edge.n.length; j++) {
                    border.tiles[j] = edge.n[j];
                }
            }
        
            for (let i = 0; i < this.corners.length; i++) {
                const corner = this.corners[i];
                for (let j = 0; j < corner.borders.length; j++) {
                    corner.corners[j] = this.borders[corner.borders[j]].oppositeCorner(i);
                }
            }
            
            for (let i = 0; i < this.tiles.length; i++) {
                const tile = this.tiles[i];
                tile.build(this.mesh.nodes[i], this.tiles, this.borders, this.corners);
            }
                
            for (let i = 0; i < this.corners.length; i++) {
                const corner = this.corners[i];
                corner.area = 0;
                for (let j = 0; j < corner.tiles.length; j++) {
                    corner.area += this.tiles[corner.tiles[j]].area / this.tiles[corner.tiles[j]].corners.length;
                }
            }
        }
    
        this.topology = new Topology(this.corners, this.borders, this.tiles);

        return this.topology;
    }
    
    async generateTerrain(plateCount: number, oceanicRate: number, heatLevel: number, moistureLevel: number) {
        if (this.topology) {
            this.generatePlanetTectonicPlates(plateCount, oceanicRate);
            this.generatePlanetElevation();
            this.generatePlanetWeather(heatLevel, moistureLevel);
            this.generatePlanetBiomes();
        }
    }
    
    private generatePlanetTectonicPlates(plateCount: number, oceanicRate: number) {
        const topology = this.topology;
        if (topology) {
            const plates: Plate[] = [];
            const used: number[] = [];
            const remaining: number[] = topology.tiles.map((v, i) => i);

            for (let i = 0; i < plateCount; i++) {
                let cornerIndex: number = 0;

                let adjacent = true;
                while (adjacent) {
                    cornerIndex = this.random.integerExclusive(0, topology.corners.length);
                    const tiles = topology.corners[cornerIndex].tiles;
                    adjacent = plates.filter(p => topology.corners[p.root].tiles
                        .filter(t => tiles.includes(t)).length > 0).length > 0;
                }

                const oceanic = (this.random.unit() < oceanicRate);
                const plate = new Plate(
                    new Color(this.random.integer(0, 0xFFFFFF)),
                    randomUnitVector(this.random),
                    this.random.realInclusive(-Math.PI / 30, Math.PI / 30),
                    this.random.realInclusive(-Math.PI / 30, Math.PI / 30),
                    oceanic ? this.random.realInclusive(-0.8, -0.3) : this.random.realInclusive(0.1, 0.5),
                    oceanic,
                    cornerIndex);

                plates.push(plate);
            }

            for (let plateIndex = 0; plateIndex < plates.length; plateIndex++) {
                const plate = plates[plateIndex];
                const corner = topology.corners[plate.root];
                plate.tiles.push(...corner.tiles);

                for (const tileIndex of corner.tiles) {
                    const tile = topology.tiles[tileIndex];
                    tile.plate = plateIndex;

                    used.push(tileIndex);
                    remaining.splice(remaining.indexOf(tileIndex), 1);
                }
            }

            while (remaining.length > 0) {
                const plateIndex = this.random.index(plates);
                if (plateIndex) {
                    const plate = plates[plateIndex];
                    const tileIndex = this.random.value(plate.tiles.map(t => this.random.value(topology.tiles[t].tiles
                        .filter(st => st && !topology.tiles[st].plate) as number[]))
                        .filter(t => t));

                    if (tileIndex) {
                        const tile = topology.tiles[tileIndex];
                        tile.plate = plateIndex;
                        
                        plate.tiles.push(tileIndex);
    
                        used.push(tileIndex);
                        remaining.splice(remaining.indexOf(tileIndex), 1);
                    }
                }
            }

            this.plates = plates;
        
            this.calculateCornerDistancesToPlateRoot();
        }
    }
    
    private calculateCornerDistancesToPlateRoot() {
        const topology = this.topology;
        const plates = this.plates;
        if (topology && plates) {
            interface CornerQueueItem { corner: Corner; distanceToPlateRoot: number };
    
            const distanceCornerQueue: CornerQueueItem[] = [];
            for (let i = 0; i < plates.length; i++) {
                const corner = topology.corners[plates[i].root];
                corner.distanceToPlateRoot = 0;
    
                for (let j = 0; j < corner.corners.length; j++) {
                    distanceCornerQueue.push({
                        corner: topology.corners[corner.corners[j]],
                        distanceToPlateRoot: topology.borders[corner.borders[j]].length(topology.corners)
                    });
                }
            }
        
            const distanceCornerQueueSorter = (left: CornerQueueItem, right: CornerQueueItem) => 
                left.distanceToPlateRoot - right.distanceToPlateRoot;
        
            if (distanceCornerQueue.length === 0) return;
    
            const iEnd = distanceCornerQueue.length;
            for (let i = 0; i < iEnd; i++) {
                const front = distanceCornerQueue[i];
                const corner = front.corner;
                const distanceToPlateRoot = front.distanceToPlateRoot;
                if (!corner.distanceToPlateRoot || corner.distanceToPlateRoot > distanceToPlateRoot) {
                    corner.distanceToPlateRoot = distanceToPlateRoot;
                    for (let j = 0; j < corner.corners.length; j++) {
                        distanceCornerQueue.push({
                            corner: topology.corners[corner.corners[j]],
                            distanceToPlateRoot: distanceToPlateRoot + topology.borders[corner.borders[j]].length(topology.corners)
                        });
                    }
                }
            }
            distanceCornerQueue.splice(0, iEnd);
            distanceCornerQueue.sort(distanceCornerQueueSorter);
        }
    }
    
    private generatePlanetElevation() {
        if (this.topology) {
            this.identifyBoundaryBorders();
    
            const boundaryCorners: number[] = this.collectBoundaryCorners();
            const boundaryCornerInnerBorderIndexes = this.calculatePlateBoundaryStress(boundaryCorners);
    
            this.blurPlateBoundaryStress(boundaryCorners, 3, 0.4);
            const elevationBorderQueue = this.populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes);
    
            this.processElevationBorderQueue(elevationBorderQueue);
            this.calculateTileAverageElevations();
        }
    }
    
    private identifyBoundaryBorders() {
        if (this.topology) {
            for (let i = 0; i < this.topology.borders.length; i++) {
                const border = this.topology.borders[i];
                const plate0 = this.topology.tiles[border.tiles[0]].plate;
                const plate1 = this.topology.tiles[border.tiles[1]].plate;

                if (plate0 && plate1 && plate0 !== plate1) {
                    border.betweenPlates = true;

                    this.topology.corners[border.corners[0]].betweenPlates = true;
                    this.topology.corners[border.corners[1]].betweenPlates = true;

                    this.plates[plate0].boundaryBorders.push(i);
                    this.plates[plate1].boundaryBorders.push(i);
                }
            }
        }
    }
    
    private collectBoundaryCorners() {
        const boundaryCorners: number[] = [];
        if (this.topology) {
            for (let j = 0; j < this.topology.corners.length; j++) {
                const corner = this.topology.corners[j];
                const plate0 = this.topology.tiles[corner.tiles[0]].plate;
                const plate1 = this.topology.tiles[corner.tiles[1]].plate;
                const plate2 = this.topology.tiles[corner.tiles[2]].plate;

                if (corner.betweenPlates && plate0 && plate1) {
                    boundaryCorners.push(j);

                    this.plates[plate0].boundaryBorders.push(j);
                    if (plate1 && plate0 !== plate1) {
                        this.plates[plate1].boundaryCorners.push(j);
                    }
                    if (plate2 && plate2 !== plate1 && plate2 !== plate1) {
                        this.plates[plate2].boundaryCorners.push(j);
                    }
                }
            }
        }

        return boundaryCorners;
    }
    
    private calculatePlateBoundaryStress(boundaryCorners: number[]) {
        const boundaryCornerInnerBorderIndexes = new Array<number | undefined>(boundaryCorners.length);

        if (this.topology) {
            for (let i = 0; i < boundaryCorners.length; i++) {
                const corner = this.topology.corners[boundaryCorners[i]];
                corner.distanceToPlateBoundary = 0;
        
                let innerBorder;
                let innerBorderIndex;
                for (let j = 0; j < corner.borders.length; j++) {
                    const border = this.topology.borders[corner.borders[j]];
                    if (!border.betweenPlates) {
                        innerBorder = border;
                        innerBorderIndex = j;
                        break;
                    }
                }
        
                if (innerBorder && innerBorderIndex) {
                    boundaryCornerInnerBorderIndexes[i] = innerBorderIndex;
                    const outerBorder0 = this.topology.borders[corner.borders[(innerBorderIndex + 1) % corner.borders.length]];
                    const outerBorder1 = this.topology.borders[corner.borders[(innerBorderIndex + 2) % corner.borders.length]];
                    const farCorner0 = this.topology.corners[outerBorder0.oppositeCorner(boundaryCorners[i])];
                    const farCorner1 = this.topology.corners[outerBorder1.oppositeCorner(boundaryCorners[i])];
                    const plate0 = this.topology.tiles[innerBorder.tiles[0]].plate;
                    const plate1 = this.topology.tiles[outerBorder0.tiles[0]].plate !== plate0 ? this.topology.tiles[outerBorder0.tiles[0]].plate : this.topology.tiles[outerBorder0.tiles[1]].plate;
                    const boundaryVector = farCorner0.vectorTo(farCorner1);
                    const boundaryNormal = boundaryVector.clone().cross(corner.position);
                    if (plate0 && plate1) {
                        const stress = this.calculateStress(this.plates[plate0].calculateMovement(this.topology.corners, corner.position), this.plates[plate1].calculateMovement(this.topology.corners, corner.position), boundaryVector, boundaryNormal);
                        corner.pressure = stress.pressure;
                        corner.shear = stress.shear;
                    }
                } else {
                    boundaryCornerInnerBorderIndexes[i] = undefined;
                    const plate0 = this.topology.tiles[corner.tiles[0]].plate;
                    const plate1 = this.topology.tiles[corner.tiles[1]].plate;
                    const plate2 = this.topology.tiles[corner.tiles[2]].plate;
                    const boundaryVector0 = this.topology.corners[corner.corners[0]].vectorTo(corner);
                    const boundaryVector1 = this.topology.corners[corner.corners[1]].vectorTo(corner);
                    const boundaryVector2 = this.topology.corners[corner.corners[2]].vectorTo(corner);
                    const boundaryNormal0 = boundaryVector0.clone().cross(corner.position);
                    const boundaryNormal1 = boundaryVector1.clone().cross(corner.position);
                    const boundaryNormal2 = boundaryVector2.clone().cross(corner.position);
    
                    if (plate0 && plate1 && plate2) {
                        const stress0 = this.calculateStress(this.plates[plate0].calculateMovement(this.topology.corners, corner.position), this.plates[plate1].calculateMovement(this.topology.corners, corner.position), boundaryVector0, boundaryNormal0);
                        const stress1 = this.calculateStress(this.plates[plate1].calculateMovement(this.topology.corners, corner.position), this.plates[plate2].calculateMovement(this.topology.corners, corner.position), boundaryVector1, boundaryNormal1);
                        const stress2 = this.calculateStress(this.plates[plate2].calculateMovement(this.topology.corners, corner.position), this.plates[plate0].calculateMovement(this.topology.corners, corner.position), boundaryVector2, boundaryNormal2);
            
                        corner.pressure = (stress0.pressure + stress1.pressure + stress2.pressure) / 3;
                        corner.shear = (stress0.shear + stress1.shear + stress2.shear) / 3;
                    }
                }
            }
        }

        return boundaryCornerInnerBorderIndexes;
    }
    
    private calculateStress(movement0: Vector3, movement1: Vector3, boundaryVector: Vector3, boundaryNormal: Vector3) {
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
    
    private blurPlateBoundaryStress(boundaryCorners: number[], stressBlurIterations: number, stressBlurCenterWeighting: number) {
        if (this.topology) {
            const newCornerPressure = new Array(boundaryCorners.length);
            const newCornerShear = new Array(boundaryCorners.length);

            for (let i = 0; i < stressBlurIterations; i++) {
                for (let j = 0; j < boundaryCorners.length; j++) {
                    const corner = this.topology.corners[boundaryCorners[j]];

                    let averagePressure = 0;
                    let averageShear = 0;
                    let neighborCount = 0;
                    for (let k = 0; k < corner.corners.length; k++) {
                        const neighbor = this.topology.corners[corner.corners[k]];
                        if (neighbor.betweenPlates) {
                            averagePressure += neighbor.pressure;
                            averageShear += neighbor.shear;
                            neighborCount++;
                        }
                    }

                    newCornerPressure[j] = corner.pressure * stressBlurCenterWeighting + (averagePressure / neighborCount) * (1 - stressBlurCenterWeighting);
                    newCornerShear[j] = corner.shear * stressBlurCenterWeighting + (averageShear / neighborCount) * (1 - stressBlurCenterWeighting);
                }
        
                for (let j = 0; j < boundaryCorners.length; j++) {
                    const corner = this.topology.corners[boundaryCorners[j]];
                    if (corner.betweenPlates) {
                        corner.pressure = newCornerPressure[j];
                        corner.shear = newCornerShear[j];
                    }
                }
            }
        }
    }
    
    private populateElevationBorderQueue(boundaryCorners: number[], boundaryCornerInnerBorderIndexes: (number | undefined)[]) {
        const elevationBorderQueue: ElevationBorderQueueItem[] = [];

        if (this.topology) {
            for (let i = 0; i < boundaryCorners.length; i++) {
                const corner = this.topology.corners[boundaryCorners[i]];
        
                const innerBorderIndex = boundaryCornerInnerBorderIndexes[i];
                if (innerBorderIndex) {
                    const innerBorder = this.topology.borders[corner.borders[innerBorderIndex]];
                    const outerBorder0 = this.topology.borders[corner.borders[(innerBorderIndex + 1) % corner.borders.length]];
                    const plateIndex0 = this.topology.tiles[innerBorder.tiles[0]].plate;
                    const plateIndex1 = this.topology.tiles[outerBorder0.tiles[0]].plate !== plateIndex0 ? this.topology.tiles[outerBorder0.tiles[0]].plate : this.topology.tiles[outerBorder0.tiles[1]].plate;
        
                    let calculateElevation: (distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number, pressure: number, shear: number) => number;
        
                    if (plateIndex0 && plateIndex1) {
                        const plate0 = this.plates[plateIndex0];
                        const plate1 = this.plates[plateIndex1];

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
        
                        const nextCorner = this.topology.corners[innerBorder.oppositeCorner(boundaryCorners[i])];
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
                                distanceToPlateBoundary: innerBorder.length(this.topology.corners),
                            });
                        }
                    }
                } else {
                    const plateIndex0 = this.topology.tiles[corner.tiles[0]].plate;
                    const plateIndex1 = this.topology.tiles[corner.tiles[1]].plate;
                    const plateIndex2 = this.topology.tiles[corner.tiles[2]].plate;
        
                    //corner.elevation = 0;
    
                    if (plateIndex0 && plateIndex1 && plateIndex2) {
                        const plate0 = this.plates[plateIndex0];
                        const plate1 = this.plates[plateIndex1];
                        const plate2 = this.plates[plateIndex2];

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
        }

        return elevationBorderQueue;
    }
    
    private calculateCollidingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.5) {
            t = t / 0.5;
            return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
        } else {
            return plateElevation;
        }
    }
    
    private calculateSuperductingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number, pressure: number) {
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
    
    private calculateSubductingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        const t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
    }
    
    private calculateDivergingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.3) {
            t = t / 0.3;
            return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
        } else {
            return plateElevation;
        }
    }
    
    private calculateShearingElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        let t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        if (t < 0.2) {
            t = t / 0.2;
            return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
        } else {
            return plateElevation;
        }
    }
    
    private calculateDormantElevation(distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number) {
        const t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
        const elevationDifference = boundaryElevation - plateElevation;
        return t * t * elevationDifference * (2 * t - 3) + boundaryElevation;
    }
    
    private processElevationBorderQueue(queue: ElevationBorderQueueItem[]) {
        if (this.topology) {
            const queueSorter = (left: ElevationBorderQueueItem, right: ElevationBorderQueueItem) => 
                left.distanceToPlateBoundary - right.distanceToPlateBoundary;
    
            
            while(queue.length > 0) {
                const end = queue.length;
    
                for (let i = 0; i < end; i++) {
                    const front = queue[i];
                    const corner = front.nextCorner;
    
                    if (!corner.elevation) {
                        corner.distanceToPlateBoundary = front.distanceToPlateBoundary;
                        corner.elevation = front.origin.calculateElevation(
                            corner.distanceToPlateBoundary,
                            corner.distanceToPlateRoot || 0,
                            front.origin.corner.elevation,
                            front.origin.plate.elevation,
                            front.origin.pressure,
                            front.origin.shear);
            
                        for (let j = 0; j < corner.borders.length; j++) {
                            const border = this.topology.borders[corner.borders[j]];
                            if (!border.betweenPlates) {
                                const nextCorner = this.topology.corners[corner.corners[j]];
                                const distanceToPlateBoundary = corner.distanceToPlateBoundary + border.length(this.topology.corners);
                                if (!nextCorner.distanceToPlateBoundary || nextCorner.distanceToPlateBoundary > distanceToPlateBoundary) {
                                    queue.push({
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
    
                queue.splice(0, end);
                queue.sort(queueSorter);
            }
        }
    }
    
    private calculateTileAverageElevations() {
        if (this.topology) {
            for (let i = 0; i < this.topology.tiles.length; i++) {
                const tile = this.topology.tiles[i];
                let elevation = 0;
                for (let j = 0; j < tile.corners.length; j++) {
                    elevation += this.topology.corners[tile.corners[j]].elevation;
                }
                tile.elevation = elevation / tile.corners.length;
            }
        }
    }
    
    private generatePlanetWeather(heatLevel: number, moistureLevel: number) {
        if (this.topology) {
            let remainingHeat = 0;
            let consumedHeat = 1;
            let remainingMoisture = 0;
            
            const whorls: Whorl[] = this.generateAirCurrentWhorls();
            this.calculateAirCurrents(whorls);
            
            const airHeatResult = this.initializeAirHeat(heatLevel);
            if (airHeatResult) {
                remainingHeat = airHeatResult.airHeat;
        
                while (remainingHeat > 0 && consumedHeat >= 0.0001) {
                    consumedHeat = this.processAirHeat(airHeatResult.corners);
                    remainingHeat -= consumedHeat;
                }
            }
            
            this.calculateTemperature();

            let consumedMoisture = 1;
            const airMoistureResult = this.initializeAirMoisture(moistureLevel);
            if (airMoistureResult) {
                remainingMoisture = airMoistureResult.airMoisture;
        
                while (remainingMoisture > 0 && consumedMoisture >= 0.0001) {
                    consumedMoisture = this.processAirMoisture(airMoistureResult.corners);
                    remainingMoisture -= consumedMoisture;
                }
            }
    
            this.calculateMoisture();
        }
    }
    
    private generateAirCurrentWhorls() {
        const whorls: Whorl[] = [];
        let direction = this.random.integer(0, 1) ? 1 : -1;
        const layerCount = this.random.integer(4, 7);
        const circumference = Math.PI * 2 * this.radius;
        const fullRevolution = Math.PI * 2;
        const baseWhorlRadius = circumference / (2 * (layerCount - 1));
    
        whorls.push({
            center: new Vector3(0, this.radius, 0)
                .applyAxisAngle(new Vector3(1, 0, 0), this.random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                .applyAxisAngle(new Vector3(0, 1, 0), this.random.real(0, fullRevolution)),
            strength: this.random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
            radius: this.random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        });
    
        for (let i = 1; i < layerCount - 1; i++) {
            direction = -direction;
            const baseTilt = i / (layerCount - 1) * fullRevolution / 2;
            const layerWhorlCount = Math.ceil((Math.sin(baseTilt) * this.radius * fullRevolution) / baseWhorlRadius);
            for (let j = 0; j < layerWhorlCount; j++) {
                whorls.push({
                    center: new Vector3(0, this.radius, 0)
                        .applyAxisAngle(new Vector3(1, 0, 0), this.random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                        .applyAxisAngle(new Vector3(0, 1, 0), this.random.real(0, fullRevolution))
                        .applyAxisAngle(new Vector3(1, 0, 0), baseTilt)
                        .applyAxisAngle(new Vector3(0, 1, 0), fullRevolution * (j + (i % 2) / 2) / layerWhorlCount),
                    strength: this.random.realInclusive(fullRevolution / 48, fullRevolution / 32) * direction,
                    radius: this.random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
                });
            }
        }
    
        direction = -direction;
        whorls.push({
            center: new Vector3(0, this.radius, 0)
                .applyAxisAngle(new Vector3(1, 0, 0), this.random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                .applyAxisAngle(new Vector3(0, 1, 0), this.random.real(0, fullRevolution))
                .applyAxisAngle(new Vector3(1, 0, 0), fullRevolution / 2),
            strength: this.random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
            radius: this.random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        });

        return whorls;
    }
    
    calculateAirCurrents(whorls: Whorl[]) {
        if (this.topology) {
            for(const corner of this.topology.corners) {
                const airCurrent = new Vector3(0, 0, 0);

                let weight = 0;
                for (let j = 0; j < whorls.length; j++) {
                    const whorl = whorls[j];
                    const angle = whorl.center.angleTo(corner.position);
                    const distance = angle * this.radius;

                    if (distance < whorl.radius) {
                        const normalizedDistance = distance / whorl.radius;
                        const whorlWeight = 1 - normalizedDistance;
                        const whorlStrength = this.radius * whorl.strength * whorlWeight * normalizedDistance;
                        const whorlCurrent = whorl.center.clone().cross(corner.position).setLength(whorlStrength);

                        airCurrent.add(whorlCurrent);
                        weight += whorlWeight;
                    }
                }

                airCurrent.divideScalar(weight);
                corner.air.direction = airCurrent.clone().normalize();
                corner.air.speed = airCurrent.length(); //kilometers per hour
        
                corner.air.outflow = new Array(corner.borders.length);

                let outflowSum = 0;
                for (let j = 0; j < corner.corners.length; j++) {
                    const vector = corner.vectorTo(this.topology.corners[corner.corners[j]]).normalize();
                    const dot = vector.dot(corner.air.direction);

                    corner.air.outflow[j] = dot > 0 ? dot : 0;
                    outflowSum += corner.air.outflow[j];
                }
        
                if (outflowSum > 0) {
                    for (let j = 0; j < corner.borders.length; j++) {
                        corner.air.outflow[j] /= outflowSum;
                    }
                }
            }
        }
    }
    
    initializeAirHeat(heatLevel: number) {
        const corners = this.topology?.corners;
        if (corners) {
            const activeCorners: number[] = [];

            let airHeat = 0;
            for (let c = 0; c < corners.length; c++) {
                const corner = corners[c];

                corner.heat = {
                    current: 0,
                    absorption: 0.1 * corner.area / Math.max(0.1, Math.min(corner.air.speed, 1)),
                    limit: corner.area,
                    air: corner.area * heatLevel,
                    airInflow: 0
                };

                if (corner.elevation > 0) {
                    corner.heat.absorption *= 2;
                }
        
                activeCorners.push(c);
                airHeat += corner.heat.air;
            }
    
            const result: AirHeatResult = {
                corners: activeCorners,
                airHeat: airHeat
            };
            
            return result;
        }

        return undefined;
    }
    
    processAirHeat(corners: number[]) {
        const activeCorners: number[] = [];

        let consumedHeat = 0;
        if (this.topology) {
            for (const c of corners) {
                const corner = this.topology.corners[c];

                if (corner.heat) {
                    let change = Math.max(0, Math.min(corner.heat.air, corner.heat.absorption * (1 - corner.heat.current / corner.heat.limit)));
                    corner.heat.current += change;
                    consumedHeat += change;

                    const heatLoss = corner.area * (corner.heat.current / corner.heat.limit) * 0.002;
                    change = Math.min(corner.heat.air, change + heatLoss);
            
                    const remainingCornerAirHeat = corner.heat.air - change;
                    corner.heat.air = 0;
            
                    if (corner.air.outflow) {
                        for (let j = 0; j < corner.corners.length; j++) {
                            const adjacent = this.topology.corners[corner.corners[j]];
                            const outflow = corner.air.outflow[j];
                            
                            if (adjacent.heat && outflow > 0) {
                                adjacent.heat.airInflow += remainingCornerAirHeat * outflow;
                                activeCorners.push(corner.corners[j]);
                            }
                        }
                    }
                }
            }
        
            for (const c of activeCorners) {
                const corner = this.topology.corners[c];
                if (corner.heat) {
                    corner.heat.air = corner.heat.airInflow;
                    corner.heat.airInflow = 0;
                }
            }
        }
    
        return consumedHeat;
    }
    
    calculateTemperature() {
        if (this.topology) {
            for (let i = 0; i < this.topology.corners.length; i++) {
                const corner = this.topology.corners[i];

                if (corner.heat) {
                    const latitudeEffect = Math.sqrt(1 - Math.abs(corner.position.y) / this.radius);
                    const elevationEffect = 1 - Math.pow(Math.max(0, Math.min(corner.elevation * 0.8, 1)), 2);
                    const normalizedHeat = corner.heat.current / corner.area;

                    corner.temperature = (latitudeEffect * elevationEffect * 0.7 + normalizedHeat * 0.3) * 5 / 3 - 2 / 3;
                }

                //corner.heat = undefined;
            }
        
            for (let i = 0; i < this.topology.tiles.length; i++) {
                const tile = this.topology.tiles[i];

                tile.temperature = 0;
                for (const c of tile.corners) {
                    tile.temperature += this.topology.corners[c].temperature;
                }
                tile.temperature /= tile.corners.length;
            }
        }
    }
    
    initializeAirMoisture(moistureLevel: number) {
        const corners = this.topology?.corners;

        if (corners) {
            const activeCorners: number[] = [];

            let airMoisture = 0;
            for (let i = 0; i < corners.length; i++) {
                const corner = corners[i];

                corner.moisture = {
                    air: (corner.elevation > 0) ? 0 : corner.area * moistureLevel * Math.max(0, Math.min(0.5 + corner.temperature * 0.5, 1)),
                    airInflow: 0,
                    precipitation: 0,
                    rate: (0.0075 * corner.area / Math.max(0.1, Math.min(corner.air.speed, 1))) * (1 + (1 - Math.max(0, Math.max(corner.temperature, 1))) * 0.1),
                    limit: corner.area * 0.25
                };

                if (corner.elevation > 0) {
                    corner.moisture.rate *= 1 + corner.elevation * 0.5;
                    corner.moisture.limit = corner.area * (0.25 + Math.max(0, Math.min(corner.elevation, 1)) * 0.25);
                }
        
                activeCorners.push(i);
                airMoisture += corner.moisture.air;
            }
    
            const result: AirMoistureResult = {
                corners: activeCorners,
                airMoisture: airMoisture
            };
    
            return result;
        }

        return undefined;
    }
    
    processAirMoisture(corners: number[]) {
        const activeCorners: number[] = [];

        let consumedMoisture = 0;
        if (this.topology) {
            for (const c of corners) {
                const corner = this.topology.corners[c];

                if (corner.moisture) {
                    let moistureChange = Math.max(0, Math.min(corner.moisture.air, corner.moisture.rate * (1 - corner.moisture.precipitation / corner.moisture.limit)));
                    corner.moisture.precipitation += moistureChange;
                    consumedMoisture += moistureChange;

                    const moistureLoss = corner.area * (corner.moisture.precipitation / corner.moisture.limit) * 0.02;
                    moistureChange = Math.min(corner.moisture.air, moistureChange + moistureLoss);
            
                    const remainingCornerAirMoisture = corner.moisture.air - moistureChange;
                    corner.moisture.air = 0;
            
                    for (let j = 0; j < corner.corners.length; j++) {
                        const adjacent = this.topology.corners[corner.corners[j]];
                        const outflow = corner.air.outflow[j];

                        if (adjacent.moisture && outflow > 0) {
                            adjacent.moisture.airInflow += remainingCornerAirMoisture * outflow;
                            activeCorners.push(corner.corners[j]);
                        }
                    }
                }
            }
        
            for (const c of activeCorners) {
                const corner = this.topology.corners[c];

                if (corner.moisture) {
                    corner.moisture.air = corner.moisture.airInflow;
                    corner.moisture.airInflow = 0;
                }
            }
        }
    
        return consumedMoisture;
    }
    
    calculateMoisture() {
        if (this.topology) {
            for (const corner of this.topology.corners) {
                if (corner.moisture) {
                    corner.humidity = corner.moisture.precipitation / corner.area / 0.5;
                }
                
                //corner.moisture = undefined;
            }
        
            for (let i = 0; i < this.topology.tiles.length; i++) {
                const tile = this.topology.tiles[i];
                tile.moisture = 0;

                for (const c of tile.corners) {
                    const corner = this.topology.corners[c];
                    tile.moisture += corner.humidity;
                }

                tile.moisture /= tile.corners.length;
            }
        }
    }
    
    generatePlanetBiomes() {
        const tiles = this.topology?.tiles;
        if (tiles) {
            for (let i = 0; i < tiles.length; i++) {
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
                    if (temperature > 0.4) {
                        if (moisture < 0.25) {
                            tile.biome = 'desert';
                        } else {
                            tile.biome = 'rainForest';
                        }
                    } else if (temperature > 0.3) {
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
    }
}

expose(new PlanetWorker());
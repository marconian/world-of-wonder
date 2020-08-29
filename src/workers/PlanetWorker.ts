import { MeshDescription } from '../models/MeshDescription';
import Corner from '../models/Corner';
import { expose } from 'comlink';
import Border from '../models/Border';
import { Vector3, Color } from 'three';
import Topology from '../models/Topology';
import Plate from '../models/Plate';
import XorShift128 from '../utils/XorShift128';
import { randomUnitVector } from '../utils';
import Whorl from '../models/Whorl';
import Tile from '../models/Tile';

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

export class PlanetWorker {
    mesh?: MeshDescription;
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
        if (this.mesh) {
            this.topology = new Topology(this.mesh, this.radius);
        }

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
            const tiles = topology.tiles();

            for (let i = 0; i < plateCount; i++) {
                let cornerIndex: number = 0;

                let adjacent = true;
                while (adjacent) {
                    cornerIndex = this.random.integerExclusive(0, topology.corners().length);
                    const cornerTiles = topology.tiles(topology.corners()[cornerIndex]);
                    adjacent = plates.filter(p => topology.tiles(topology.corners()[p.root])
                        .filter(t => cornerTiles.includes(t)).length > 0).length > 0;
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

            this.plates = plates;

            for (let plateIndex = 0; plateIndex < plates.length; plateIndex++) {
                const plate = plates[plateIndex];
                const corner = topology.corners()[plate.root];
                const cornerTiles = topology.tiles(corner);

                for (const tile of cornerTiles) {
                    const tileIndex = tiles.indexOf(tile);
                    plate.tiles.push(tileIndex);
                    tile.plate = plateIndex;
                }
            }

            let remaining = true;
            while (remaining) {
                const plateIndex = this.random.index(plates);
                if (plateIndex !== undefined) {
                    const plate = plates[plateIndex];
                    const unassigned = plate.tiles.map(t => topology.tiles()[t])
                        .map(t => topology.tiles(t).filter(st => st.plate === undefined))
                        .filter(a => a.length > 0)
                        .map(a => this.random.value(a) as Tile);

                    const tile = this.random.value(unassigned);
                    if (tile) {
                        const tileIndex = topology.tiles().indexOf(tile);
                        plate.tiles.push(tileIndex);
                        tile.plate = plateIndex;
                    }
                }

                remaining = tiles.filter(t => t.plate === undefined).length > 0;
            }
        
            this.calculateCornerDistancesToPlateRoot();
            this.identifyBoundaryBorders();

            for (const plate of plates) {
                plate.area = plate.tiles.map(t => topology.tiles()[t].area)
                    .reduce((a, b) => a + b);

                if (plate.boundaryBorders.length > 0) {
                    plate.circumference = plate.boundaryBorders.map(b => topology.borders()[b])
                        .map(b => topology.corners(b)[0].position.distanceTo(topology.corners(b)[1].position))
                        .reduce((a, b) => a + b);
                }
            }
        }
    }
    
    private calculateCornerDistancesToPlateRoot() {
        const topology = this.topology;
        const plates = this.plates;
        if (topology && plates) {
            interface CornerQueueItem { corner: Corner; distanceToPlateRoot: number };
    
            const distanceCornerQueue: CornerQueueItem[] = [];
            for (let i = 0; i < plates.length; i++) {
                const corner = topology.corners()[plates[i].root];
                const corners = topology.corners(corner);

                corner.distanceToPlateRoot = 0;
                for (let j = 0; j < corners.length; j++) {
                    const border = topology.borders(corner)[j];
                    
                    distanceCornerQueue.push({
                        corner: corners[j],
                        distanceToPlateRoot: topology.length(border)
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
                    const corners = topology.corners(corner);

                    corner.distanceToPlateRoot = distanceToPlateRoot;
                    for (let j = 0; j < corners.length; j++) {
                        const border = topology.borders(corner)[j];

                        distanceCornerQueue.push({
                            corner: corners[j],
                            distanceToPlateRoot: topology.length(border)
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
            for (let i = 0; i < this.topology.borders().length; i++) {
                const border = this.topology.borders()[i];
                const plate0 = this.topology.tiles(border)[0].plate;
                const plate1 = this.topology.tiles(border)[1].plate;

                if (plate0 && plate1 && plate0 !== plate1) {
                    border.betweenPlates = true;

                    this.topology.corners(border)[0].betweenPlates = true;
                    this.topology.corners(border)[1].betweenPlates = true;

                    this.plates[plate0].boundaryBorders.push(i);
                    this.plates[plate1].boundaryBorders.push(i);
                }
            }
        }
    }
    
    private collectBoundaryCorners() {
        const boundaryCorners: number[] = [];
        if (this.topology) {
            for (let j = 0; j < this.topology.corners().length; j++) {
                const corner = this.topology.corners()[j];
                const plate0 = this.topology.tiles(corner)[0].plate;
                const plate1 = this.topology.tiles(corner)[1].plate;
                const plate2 = this.topology.tiles(corner)[2].plate;

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
                const corner = this.topology.corners()[boundaryCorners[i]];
                const corners = this.topology.corners(corner);
                const borders = this.topology.borders(corner);
                const tiles = this.topology.tiles(corner);

                corner.distanceToPlateBoundary = 0;
        
                let innerBorder;
                let innerBorderIndex;
                for (let j = 0; j < borders.length; j++) {
                    const border = borders[j];
                    if (!border.betweenPlates) {
                        innerBorder = border;
                        innerBorderIndex = j;
                        break;
                    }
                }
        
                if (innerBorder && innerBorderIndex) {
                    boundaryCornerInnerBorderIndexes[i] = innerBorderIndex;
                    const outerBorder0 = borders[(innerBorderIndex + 1) % borders.length];
                    const outerBorder1 = borders[(innerBorderIndex + 2) % borders.length];
                    const farCorner0 = this.topology.opposite(corner, outerBorder0);
                    const farCorner1 = this.topology.opposite(corner, outerBorder1);
                    const plate0 = this.topology.tiles(innerBorder)[0].plate;
                    const plate1 = this.topology.tiles(outerBorder0)[0].plate !== plate0 ? this.topology.tiles(outerBorder0)[0].plate : this.topology.tiles(outerBorder0)[1].plate;
                    const boundaryVector = farCorner0.vectorTo(farCorner1);
                    const boundaryNormal = boundaryVector.clone().cross(corner.position);
                    if (plate0 && plate1) {
                        const stress = this.calculateStress(this.plates[plate0].calculateMovement(this.topology.corners(), corner.position), this.plates[plate1].calculateMovement(this.topology.corners(), corner.position), boundaryVector, boundaryNormal);
                        corner.pressure = stress.pressure;
                        corner.shear = stress.shear;
                    }
                } else {
                    boundaryCornerInnerBorderIndexes[i] = undefined;
                    const plate0 = tiles[0].plate;
                    const plate1 = tiles[1].plate;
                    const plate2 = tiles[2].plate;
                    const boundaryVector0 = corners[0].vectorTo(corner);
                    const boundaryVector1 = corners[1].vectorTo(corner);
                    const boundaryVector2 = corners[2].vectorTo(corner);
                    const boundaryNormal0 = boundaryVector0.clone().cross(corner.position);
                    const boundaryNormal1 = boundaryVector1.clone().cross(corner.position);
                    const boundaryNormal2 = boundaryVector2.clone().cross(corner.position);
    
                    if (plate0 && plate1 && plate2) {
                        const stress0 = this.calculateStress(this.plates[plate0].calculateMovement(this.topology.corners(), corner.position), this.plates[plate1].calculateMovement(this.topology.corners(), corner.position), boundaryVector0, boundaryNormal0);
                        const stress1 = this.calculateStress(this.plates[plate1].calculateMovement(this.topology.corners(), corner.position), this.plates[plate2].calculateMovement(this.topology.corners(), corner.position), boundaryVector1, boundaryNormal1);
                        const stress2 = this.calculateStress(this.plates[plate2].calculateMovement(this.topology.corners(), corner.position), this.plates[plate0].calculateMovement(this.topology.corners(), corner.position), boundaryVector2, boundaryNormal2);
            
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
                    const corner = this.topology.corners()[boundaryCorners[j]];

                    let averagePressure = 0;
                    let averageShear = 0;
                    let neighborCount = 0;
                    for (const neighbor of this.topology.corners(corner)) {
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
                    const corner = this.topology.corners()[boundaryCorners[j]];
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
                const corner = this.topology.corners()[boundaryCorners[i]];
        
                const innerBorderIndex = boundaryCornerInnerBorderIndexes[i];
                if (innerBorderIndex) {
                    const innerBorder = this.topology.borders(corner)[innerBorderIndex];
                    const outerBorder0 = this.topology.borders(corner)[(innerBorderIndex + 1) % this.topology.borders(corner).length];
                    const plateIndex0 = this.topology.tiles(innerBorder)[0].plate;
                    const plateIndex1 = this.topology.tiles(outerBorder0)[0].plate !== plateIndex0 ? this.topology.tiles(outerBorder0)[0].plate : this.topology.tiles(outerBorder0)[1].plate;
        
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
        
                        const nextCorner = this.topology.opposite(corner, innerBorder);
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
                                distanceToPlateBoundary: this.topology.corners(innerBorder)[0].position.distanceTo(this.topology.corners(innerBorder)[1].position),
                            });
                        }
                    }
                } else {
                    const plateIndex0 = this.topology.tiles(corner)[0].plate;
                    const plateIndex1 = this.topology.tiles(corner)[1].plate;
                    const plateIndex2 = this.topology.tiles(corner)[2].plate;
        
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
            
                        for (let j = 0; j < this.topology.borders(corner).length; j++) {
                            const border = this.topology.borders(corner)[j];
                            if (!border.betweenPlates) {
                                const corners = this.topology.corners(corner);

                                const nextCorner = corners[j];
                                const distanceToPlateBoundary = corner.distanceToPlateBoundary + (corners[0].position.distanceTo(corners[1].position));

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
            for (let i = 0; i < this.topology.tiles().length; i++) {
                const tile = this.topology.tiles()[i];
                const corners = this.topology.corners(tile);

                let elevation = 0;
                for (const corner of corners) {
                    elevation += corner.elevation;
                }
                tile.elevation = elevation / corners.length;
            }
        }
    }
    
    private generatePlanetWeather(heatLevel: number, moistureLevel: number) {
        if (this.topology) {
            
            const whorls: Whorl[] = this.generateAirCurrentWhorls();
            this.calculateAirCurrents(whorls);
            
            const oceanicWhorls: Whorl[] = this.generateOceanicCurrentWhorls();
            this.calculateOceanicCurrents(oceanicWhorls);
            
            this.initializeHeat(heatLevel);
            this.processHeat();
            this.calculateTemperature();

            this.initializeAirMoisture(moistureLevel);
            this.processAirMoisture();
            this.calculateHumidity();

            //let availableMoisture = this.initializeAirMoisture(moistureLevel);
            //this.processAirMoisture();
            // while (availableMoisture) {
            //     this.processAirMoisture();

            //     if (this.topology.corners().filter(c => c.moisture && c.moisture.precipitation < c.moisture.limit).length === 0) {
            //         break;
            //     }

            //     availableMoisture = this.topology.corners().map(c => c.moisture?.air || 0).reduce((a, b) => a + b) || 0;
            // }
            //this.calculateHumidity();
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
    
    private generateOceanicCurrentWhorls() {
        const whorls: Whorl[] = [];
        //const direction = this.random.integer(0, 1) ? 1 : -1;
        //const layerCount = this.random.integer(4, 7);
        //const circumference = Math.PI * 2 * this.radius;
        //const fullRevolution = Math.PI * 2;
        //const baseWhorlRadius = circumference / (2 * (layerCount - 1));

        const oceanicAreas: Vector3[] = [];
        if (this.topology) {
            const topology = this.topology;

            for (const plate of this.plates.filter(p => p.oceanic)) {
                // const center: Vector3 = new Vector3();
                // for (const tile of plate.tiles.map(t => topology.tiles()[t])) {
                //     center.add(tile.position);
                // }

                // center.divideScalar(plate.tiles.length);
                
                const center: Vector3 = topology.corners()[plate.root].position.clone();
                const radius = Math.sqrt(plate.area) * .5;

                whorls.push({
                    center: center,
                    strength: .1, //fullRevolution / 12 * direction,
                    radius: radius / 10
                });
                oceanicAreas.push(center);
            }
        }
    
        // whorls.push({
        //     center: this.random.value(oceanicAreas) || new Vector3(),
        //     strength: this.random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
        //     radius: this.random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        // });
    
        // for (let i = 1; i < layerCount - 1; i++) {
        //     direction = -direction;
        //     const baseTilt = i / (layerCount - 1) * fullRevolution / 2;
        //     const layerWhorlCount = Math.ceil((Math.sin(baseTilt) * this.radius * fullRevolution) / baseWhorlRadius);
        //     for (let j = 0; j < layerWhorlCount; j++) {
        //         whorls.push({
        //             center: this.random.value(oceanicAreas) || new Vector3(),
        //             strength: this.random.realInclusive(fullRevolution / 48, fullRevolution / 32) * direction,
        //             radius: this.random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        //         });
        //     }
        // }
    
        // direction = -direction;
        // whorls.push({
        //     center: this.random.value(oceanicAreas) || new Vector3(),
        //     strength: this.random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
        //     radius: this.random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        // });

        return whorls;
    }
    
    calculateAirCurrents(whorls: Whorl[]) {
        if (this.topology) {
            const corners = this.topology.corners();
            for(const corner of corners) {
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
                corner.air.outflow = [];

                if (isNaN(corner.air.speed)) {
                    corner.air.speed = 0;
                }

                const cornerCorners = this.topology.corners(corner);

                let outflowSum = 0;
                for (let j = 0; j < cornerCorners.length; j++) {
                    const adjacent = cornerCorners[j];
                    const vector = corner.vectorTo(adjacent).normalize();
                    const dot = vector.dot(corner.air.direction);

                    corner.air.outflow.push(dot > 0 ? dot : 0);
                    outflowSum += corner.air.outflow[j];
                }
        
                if (outflowSum > 0) {
                    for (let j = 0; j < corner.air.outflow.length; j++) {
                        corner.air.outflow[j] /= outflowSum;
                    }
                }
            }
        }
    }
    
    calculateOceanicCurrents(whorls: Whorl[]) {
        if (this.topology) {
            const topology = this.topology;

            for (const plate of this.plates.filter(p => p.oceanic && p.boundaryCorners.length > 0)) {
                const tiles = plate.tiles.map(t => topology.tiles()[t]);
                let corners = tiles.map(t => topology.corners(t)).reduce((a, b) => [...a, ...b]);
                corners = corners.filter((v, i) => corners.indexOf(v) === i && v.elevation <= 0);

                // const center: Vector3 = new Vector3();
                // for (const tile of plate.tiles.map(t => topology.tiles()[t])) {
                //     center.add(tile.position);
                // }

                // center.divideScalar(plate.tiles.length);
                
                const center: Vector3 = topology.corners()[plate.root].position.clone();
                const radius = plate.boundaryCorners.map(c => center.distanceTo(topology.corners()[c].position))
                    .reduce((a, b) => a + b) / plate.boundaryCorners.length;
                //const surfaceArea = Math.PI * 4 * Math.pow(this.radius, 2);
                const fullRevolution = Math.PI * 2;
                const circumference = fullRevolution * radius;

                const whorl: Whorl = {
                    center: center,
                    strength: (radius / circumference) * .2,
                    radius: 0
                };

                const boundaries = plate.boundaryBorders.map(b => topology.borders()[b])
                    .map(b => {
                        const e0 = topology.corners(b)[0];
                        const e1 = topology.corners(b)[1];

                        if (e0.elevation > 0 && e1.elevation > 0) {
                            return e0.position.clone().add(e1.position.clone().sub(e0.position).divideScalar(2));
                        } else if (e0.elevation > 0) {
                            return e0.position;
                        } else if (e1.elevation > 0) {
                            return e1.position;
                        }

                        return undefined;
                    })
                    .filter(b => b).map(b => b as Vector3);
                
                for (const corner of corners) {
                    const oceanicCurrent = new Vector3(0, 0, 0);

                    const boundary = boundaries
                        .sort((a, b) => corner.position.distanceTo(a) - corner.position.distanceTo(b))[0];

                    if (boundary) {
                        const maxDistance = whorl.center.distanceTo(boundary);
                        const boundaryDistance = boundary.distanceTo(corner.position) / maxDistance;
                        const centerDistance = whorl.center.distanceTo(corner.position) / maxDistance;

                        let whorlCurrent = boundary.clone().cross(corner.position).multiplyScalar(-1);
                        whorlCurrent.multiplyScalar((1 - boundaryDistance) * .1);
                        oceanicCurrent.add(whorlCurrent);
                
                        whorlCurrent = whorl.center.clone().cross(corner.position);
                        whorlCurrent.multiplyScalar(1 - centerDistance);
                        oceanicCurrent.add(whorlCurrent);
    
                        oceanicCurrent.normalize();
    
                        const angle = whorl.center.angleTo(corner.position);
                        const distance = angle * this.radius;
                        const normalizedDistance = distance / maxDistance;
                        const whorlStrength = this.radius * whorl.strength * normalizedDistance;
    
                        oceanicCurrent.multiplyScalar(whorlStrength);
                    }

                    corner.water.direction = oceanicCurrent.clone().normalize();
                    corner.water.speed = oceanicCurrent.length(); //kilometers per hour
                    corner.water.outflow = [];
                }

                
                for (const corner of corners) {
                    const adjacent = topology.corners(corner).filter(c => c.elevation <= 0);
                    for (const adj of adjacent) {
                        corner.water.direction.add(adj.water.direction);
                        corner.water.speed += adj.water.speed;
                    }

                    corner.water.direction.divideScalar(adjacent.length + 1);
                    corner.water.speed /= adjacent.length + 1;
                }

                for (const corner of corners) {
                    let outflowSum = 0;
                    for (let j = 0; j < this.topology.corners(corner).length; j++) {
                        const adjacent = this.topology.corners(corner)[j];
                        if (adjacent.elevation <= 0) {
                            const vector = corner.vectorTo(adjacent).normalize();
                            const dot = vector.dot(corner.water.direction);
        
                            corner.water.outflow.push(dot > 0 ? dot : 0);
                            outflowSum += corner.water.outflow[j];
                        } else {
                            corner.water.outflow.push(0);
                        }
                    }
            
                    if (outflowSum > 0) {
                        for (let j = 0; j < corner.water.outflow.length; j++) {
                            corner.water.outflow[j] /= outflowSum;
                        }
                    }
                }
            }
        }
    }
    
    initializeHeat(heatLevel: number) {
        if (this.topology) {
            const corners = this.topology.corners();

            for (let c = 0; c < corners.length; c++) {
                const corner = corners[c];

                const absorptionAir = corner.air.speed > 0 ? 0.1 * corner.area / corner.air.speed : 0;
                const absorptionWater = corner.water.speed > 0 ? 0.1 * corner.area / corner.water.speed : 0;
                const rate = (absorptionAir + absorptionWater);

                corner.heat = {
                    current: 0,
                    absorption: rate * .01,
                    limit: corner.area,
                    air: corner.area * heatLevel,
                    airInflow: 0
                };

                if (corner.elevation > 0) {
                    corner.heat.absorption *= 2;
                }
            }
        }

        return this.topology?.corners().map(c => c.heat?.air || 0).reduce((a, b) => a + b) || 0;
    }
    
    processHeat() {
        const activeCorners: Corner[] = [];

        if (this.topology) {
            const corners = this.topology.corners();
            for (const corner of corners.filter(c => c.heat?.air)) {
                if (corner.heat) {
                    const absorption = corner.heat.absorption * (1 + (1 - Math.max(0, Math.max(corner.humidity, 1))) * 0.1);
                    let change = Math.max(0, Math.min(corner.heat.air, absorption * (1 - corner.heat.current / corner.heat.limit)));
                    corner.heat.current += change;

                    const heatLoss = corner.area * (corner.heat.current / corner.heat.limit) * 0.002;
                    change = Math.min(corner.heat.air, change + heatLoss);
            
                    corner.heat.air -= change;
            
                    const cornerCorners = this.topology.corners(corner);
                    for (let j = 0; j < cornerCorners.length; j++) {
                        const adjacent = cornerCorners[j];
                        let outflow = corner.air.outflow[j];
                        if (corner.water?.speed) {
                            outflow += corner.water.outflow[j];
                        }
                        
                        if (adjacent.heat && outflow > 0) {
                            adjacent.heat.airInflow += corner.heat.air * outflow;
                            activeCorners.push(corner);
                        }
                    }
                }
            }
        
            for (const corner of activeCorners) {
                if (corner.heat) {
                    corner.heat.air = corner.heat.airInflow;
                    corner.heat.airInflow = 0;
                }
            }
        }
    }
    
    calculateTemperature() {
        if (this.topology) {
            const corners = this.topology.corners();
            for (let i = 0; i < corners.length; i++) {
                const corner = corners[i];

                if (corner.heat) {
                    const latitudeEffect = Math.sqrt(1 - Math.abs(corner.position.y) / this.radius);
                    const elevationEffect = 1 - Math.pow(Math.max(0, Math.min(corner.elevation * 0.8, 1)), 2);
                    const normalizedHeat = corner.heat.current / corner.area;

                    corner.temperature = (latitudeEffect * (elevationEffect * 0.7) + (normalizedHeat * 0.3)) * 5 / 3 - 2 / 3;
                    corner.temperature *= 2;
                }
            }
        
            const tiles = this.topology.tiles();
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];

                const tileCorners = this.topology.corners(tile);
                tile.temperature = 0;
                for (const c of tileCorners) {
                    tile.temperature += c.temperature;
                }
                tile.temperature /= tileCorners.length;
            }
        }

        return this.topology?.tiles().map(t => t.temperature);
    }
    
    initializeAirMoisture(moistureLevel: number) {
        if (this.topology) {
            const corners = this.topology.corners();
            for (const corner of corners) {
                // const diameter = Math.sqrt(corner.area);
                // const volume = Math.pow(diameter, 3);

                const absorptionAir = corner.air.speed > 0 ? 0.1 * corner.area / corner.air.speed : 0;
                const absorptionWater = corner.water.speed > 0 ? 0.1 * corner.area / corner.water.speed : 0;
                const rate = (absorptionAir + absorptionWater);

                corner.moisture = {
                    air: 0,
                    airInflow: 0,
                    airOutflow: 0,
                    precipitation: 0,
                    rate: rate * .01,
                    limit: corner.area * .25
                };
                
                if (corner.elevation > 0) {
                    corner.moisture.rate *= (1 + corner.elevation * 0.5);
                    corner.moisture.limit *= 1 + Math.max(0, Math.min(corner.elevation, 1)) * 0.25;
                } else {
                    corner.moisture.air = corner.area * moistureLevel * Math.max(0, Math.min(0.5 + corner.temperature * 0.5, 1));
                    //corner.moisture.precipitation = corner.moisture.limit;
                }
            }
        }

        return this.topology?.corners().map(c => c.moisture?.air || 0).reduce((a, b) => a + b) || 0;
    }
    
    processAirMoisture() {
        if (this.topology) {
            const corners = this.topology.corners();
            for (const corner of corners.filter(c => c.moisture?.air)) {

                if (corner.moisture) {

                    const rate = corner.moisture.rate * (1 + (1 - Math.max(0, Math.max(corner.temperature, 1))) * 0.1);
                    let moistureChange = Math.max(0, Math.min(corner.moisture.air, rate * (1 - corner.moisture.precipitation / corner.moisture.limit)));
                    
                    const moistureLoss = corner.area * (corner.moisture.precipitation / corner.moisture.limit) * 0.02;
                    moistureChange = Math.min(corner.moisture.air, moistureChange + moistureLoss);
            
                    corner.moisture.precipitation += moistureChange;
                    corner.moisture.air -= moistureChange;
            
                    const cornerCorners = this.topology.corners(corner);
                    for (let j = 0; j < cornerCorners.length; j++) {
                        const adjacent = cornerCorners[j];
                        const outflow = corner.air.outflow[j];
                        // if (corner.water) {
                        //     outflow += corner.water.outflow[j];
                        // }

                        if (adjacent.moisture && outflow > 0) {
                            adjacent.moisture.airInflow += corner.moisture.air * outflow;
                            //corner.moisture.airOutflow += corner.moisture.air * outflow;
                        }
                    }

                    corner.moisture.air = 0;
                }
            }
        
            for (const corner of corners.filter(c => c.moisture?.airInflow)) {
                if (corner.moisture) {
                    corner.moisture.air += corner.moisture.airInflow;
                    corner.moisture.airInflow = 0;
                    
                    // corner.moisture.air -= corner.moisture.airOutflow;
                    // corner.moisture.airOutflow = 0;
                }
            }
        }
    }
    
    calculateHumidity() {
        if (this.topology) {
            const corners = this.topology.corners();
            for (const corner of corners) {
                // const diameter = Math.sqrt(corner.area);
                // const volume = Math.pow(diameter, 3);

                if (corner.moisture) {
                    corner.humidity = corner.moisture.precipitation / corner.area;
                    corner.humidity *= 2;
                }
                
                //corner.moisture = undefined;
            }
        
            const tiles = this.topology.tiles();
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                tile.humidity = 0;

                const tileCorners = this.topology.corners(tile);
                for (const corner of tileCorners) {
                    tile.humidity += corner.humidity;
                }

                tile.humidity /= tileCorners.length;
            }
        }

        return this.topology?.tiles().map(t => t.humidity);
    }
    
    generatePlanetBiomes() {
        const tiles = this.topology?.tiles();
        if (tiles) {
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                const elevation = Math.max(0, tile.elevation);
                const temperature = tile.temperature;
                const moisture = tile.humidity;
        
                if (elevation <= 0) {
                    if (temperature > 0) {
                        tile.biome = 'ocean';
                    } else {
                        tile.biome = 'oceanGlacier';
                    }
                } else if (elevation < 0.6) {
                    if (temperature > 0.75) {
                        if (moisture < 0.51) {
                            tile.biome = 'desert';
                        } else {
                            tile.biome = 'rainForest';
                        }
                    } else if (temperature > 0.6) {
                        if (moisture < 0.51) {
                            tile.biome = 'rocky';
                        } else if (moisture < 0.6) {
                            tile.biome = 'plains';
                        } else {
                            tile.biome = 'swamp';
                        }
                    } else if (temperature > 0.3) {
                        if (moisture < 0.51) {
                            tile.biome = 'plains';
                        } else if (moisture < 0.60) {
                            tile.biome = 'grassland';
                        } else {
                            tile.biome = 'deciduousForest';
                        }
                    } else if (temperature > 0.2) {
                        if (moisture < 0.51) {
                            tile.biome = 'plains';
                        } else if (moisture < 0.60) {
                            tile.biome = 'grassland';
                        } else {
                            tile.biome = 'coniferForest';
                        }
                    } else {
                        if (moisture < 0.51) {
                            tile.biome = 'tundra';
                        } else {
                            tile.biome = 'landGlacier';
                        }
                    }
                } else if (elevation < 0.8) {
                    if (temperature > 0.2) {
                        if (moisture < 0.51) {
                            tile.biome = 'tundra';
                        } else {
                            tile.biome = 'coniferForest';
                        }
                    } else {
                        tile.biome = 'tundra';
                    }
                } else {
                    if (temperature > 0 || moisture < 0.51) {
                        tile.biome = 'mountain';
                    } else {
                        tile.biome = 'snowyMountain';
                    }
                }
            }
        }

        return this.topology?.tiles().map(t => t.biome);
    }
}

const obj = new PlanetWorker();
(globalThis as any).planet = obj;

expose(obj);
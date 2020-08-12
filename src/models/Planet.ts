/* eslint-disable no-throw-literal */
import Plate from './Plate';
import Topology from './Topology';
import SpatialPartition from './SpatialPartition';
import RenderData, { RenderSurface, RenderPlateBoundaries, RenderPlateMovement, RenderAirCurrents } from './RenderData';
import Statistics, { StatisticsItem } from './Statistics';
import { Color, Vector3, Sphere, Geometry, MeshLambertMaterial, Mesh, Face3, MeshBasicMaterial } from 'three';
import { MeshDescription } from './MeshDescription';
import XorShift128 from '../utils/XorShift128';
import Corner from './Corner';
import Border from './Border';
import Tile from './Tile';
import { randomUnitVector } from '../utils';
import Whorl from './Whorl';
import * as Comlink from 'comlink';
import { PlanetWorker } from '../workers/PlanetWorker';
// eslint-disable-next-line import/no-webpack-loader-syntax
import Worker from 'worker-loader!../workers/PlanetWorker';

export type PlanetMode = 'terrain' | 'plates' | 'elevation' | 'temperature' | 'moisture';

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

export class Planet {
    seed: number;
    topology?: Topology;
    partition?: SpatialPartition;
    renderData?: RenderData;
    statistics?: Statistics;
    plates: Plate[];
    radius: number;

    private _mode: PlanetMode = 'terrain';
    private _sunlight = true;
    private _plateBoundaries = true;
    private _plateMovements = true;
    private _airCurrents = true;
    private _mesh: MeshDescription;
    private _random: XorShift128;

    constructor(seed: number) {
        this.seed = seed;
        this.plates = [];
        this._random = new XorShift128(seed, 0, 0, 0);
        this._mesh = new MeshDescription(this._random);
        this.radius = this._random.integer(500, 2000);
    }

    async build(icosahedronSubdivision: number, topologyDistortionRate: number, plateCount: number, oceanicRate: number, heatLevel: number, moistureLevel: number) {
        this._mesh = await this._mesh.build(icosahedronSubdivision, topologyDistortionRate);
        this.topology = await this.generatePlanetTopology();
        this.partition = await this.generatePlanetPartition();

        await this.generatePlanetTerrain(plateCount, oceanicRate, heatLevel, moistureLevel);

        this.renderData = this.generatePlanetRenderData();
        this.statistics = this.generatePlanetStatistics();
    }

    dispose() {
        this.topology?.dispose();
        this.partition?.dispose();
        this.renderData = undefined;
        this.statistics = undefined;
        this.plates.splice(0, this.plates.length);
    }
    
    setSurface(mode: PlanetMode) {
        this._mode = mode;

        if (this.renderData?.surface) {
            let colors: Color[][];
            if (this._mode === 'terrain') colors = this.renderData.surface.terrainColors;
            else if (this._mode === 'plates') colors = this.renderData.surface.plateColors;
            else if (this._mode === 'elevation') colors = this.renderData.surface.elevationColors;
            else if (this._mode === 'temperature') colors = this.renderData.surface.temperatureColors;
            else if (this._mode === 'moisture') colors = this.renderData.surface.moistureColors;
            else return;

            const faces = this.renderData.surface.geometry.faces;
            for (let i = 0; i < faces.length; i++) {
                faces[i].vertexColors = colors[i];
            }
    
            this.renderData.surface.geometry.elementsNeedUpdate = true;
        }
    }

    toggleSunlight(show?: boolean) {
        if (typeof (show) === 'boolean') {
            this._sunlight = show;
        } else {
            this._sunlight = !this._sunlight;
        }
    
        if (this?.renderData?.surface) {
            const material = this.renderData.surface.material;
            if (this._sunlight) {
                material.color = new Color(0xFFFFFF);
            } else {
                material.color = new Color(0x000000);
            }

            material.needsUpdate = true;
        }
    }
    
    togglePlateBoundaries(show?: boolean) {
        if (typeof (show) === 'boolean') {
            this._plateBoundaries = show;
        } else {
            this._plateBoundaries = !this._plateBoundaries;
        }
    
        if (this?.renderData?.surface && this?.renderData.plateBoundaries) {
            if (this._plateBoundaries) {
                this.renderData.surface.renderObject.add(this.renderData.plateBoundaries.renderObject);
            } else {
                this.renderData.surface.renderObject.remove(this.renderData.plateBoundaries.renderObject);
            }
        }
    }
    
    togglePlateMovements(show?: boolean) {
        if (typeof (show) === 'boolean') {
            this._plateMovements = show;
        } else {
            this._plateMovements = !this._plateMovements;
        }
    
        if (this?.renderData?.surface && this?.renderData.plateMovements) {
            if (this._plateMovements) {
                this.renderData.surface.renderObject.add(this.renderData.plateMovements.renderObject);
            } else {
                this.renderData.surface.renderObject.remove(this.renderData.plateMovements.renderObject);
            }
        }
    }
    
    toggleAirCurrents(show?: boolean) {
        if (typeof show === 'boolean') {
            this._airCurrents = show;
        } else {
            this._airCurrents = !this._airCurrents;
        }
    
        if (this?.renderData?.surface && this?.renderData.airCurrents) {
            if (this._airCurrents) {
                this.renderData.surface.renderObject.add(this.renderData.airCurrents.renderObject);
            } else {
                this.renderData.surface.renderObject.remove(this.renderData.airCurrents.renderObject);
            }
        }
    }
    
    private async generatePlanetTopology() {
        //const corners = new Array<Corner>(this._mesh.faces.length);
        const borders = new Array<Border>(this._mesh.edges.length);
        const tiles = new Array<Tile>(this._mesh.nodes.length);

        const worker = new Worker();
        const obj = Comlink.wrap<PlanetWorker>(worker);
        const corners = await obj.corners(this._mesh);
        
        const tasks: Promise<void>[] = [];
        // for (let i = 0; i < this._mesh.faces.length; i++) {
        //     tasks.push(new Promise((resolve) => {
        //         const face = this._mesh.faces[i];
        //         if (face.centroid) {
        //             corners[i] = new Corner(i, face.centroid.clone(), face.e.length, face.e.length, face.n.length);
        //         }

        //         resolve();
        //     }));
        // }
        
        // await Promise.all(tasks);
        // tasks.splice(0, tasks.length);

        for (let i = 0; i < this._mesh.edges.length; i++) {
            tasks.push(new Promise((resolve) => {
                borders[i] = new Border(i, 2, 4, 2);

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        for (let i = 0; i < this._mesh.nodes.length; i++) {
            tasks.push(new Promise((resolve, reject) => {
                const node = this._mesh.nodes[i];
                tiles[i] = new Tile(i, node.p.clone().multiplyScalar(1000), node.f.length, node.e.length, node.e.length);
                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        for (let i = 0; i < corners.length; i++) {
            tasks.push(new Promise((resolve) => {
                const corner = corners[i];
                const face = this._mesh.faces[i];
                for (let j = 0; j < face.e.length; j++) {
                    corner.borders[j] = borders[face.e[j]];
                }
                for (let j = 0; j < face.n.length; j++) {
                    corner.tiles[j] = tiles[face.n[j]];
                }

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        for (let i = 0; i < borders.length; i++) {
            tasks.push(new Promise((resolve) => {
                const border = borders[i];
                const edge = this._mesh.edges[i];
                const averageCorner = new Vector3(0, 0, 0);
                let n = 0;
                for (let j = 0; j < edge.f.length; j++) {
                    const corner = corners[edge.f[j]];
                    averageCorner.add(corner.position);
                    border.corners[j] = corner;
                    for (let k = 0; k < corner.borders.length; k++) {
                        if (corner.borders[k] !== border) border.borders[n++] = corner.borders[k];
                    }
                }
                border.midpoint = averageCorner.multiplyScalar(1 / border.corners.length);
                for (let j = 0; j < edge.n.length; j++) {
                    border.tiles[j] = tiles[edge.n[j]];
                }

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        for (let i = 0; i < corners.length; i++) {
            tasks.push(new Promise((resolve) => {
                const corner = corners[i];
                for (let j = 0; j < corner.borders.length; j++) {
                    corner.corners[j] = corner.borders[j].oppositeCorner(corner);
                }

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        for (let i = 0; i < tiles.length; i++) {
            tasks.push(new Promise((resolve) => {
                const tile = tiles[i];
                tile.build(this._mesh.nodes[i], borders, corners);

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);
        
        for (let i = 0; i < corners.length; i++) {
            tasks.push(new Promise((resolve) => {
                const corner = corners[i];
                corner.area = 0;
                for (let j = 0; j < corner.tiles.length; j++) {
                    corner.area += corner.tiles[j].area / corner.tiles[j].corners.length;
                }

                resolve();
            }));
        }
        
        await Promise.all(tasks);
        tasks.splice(0, tasks.length);

        const topology = new Topology(corners, borders, tiles);
        return topology;
    }
    
    private async generatePlanetPartition() {
        const tiles = this.topology?.tiles;
        if (tiles) {
            const icosahedron = new MeshDescription().icosahedron();
            
            const tasks: Promise<void>[] = [];
            for (let i = 0; i < icosahedron.faces.length; i++) {
                tasks.push(new Promise((resolve) => {
                    const face = icosahedron.faces[i];
                    const p0 = icosahedron.nodes[face.n[0]].p.clone().multiplyScalar(1000);
                    const p1 = icosahedron.nodes[face.n[1]].p.clone().multiplyScalar(1000);
                    const p2 = icosahedron.nodes[face.n[2]].p.clone().multiplyScalar(1000);
    
                    const center = p0.clone().add(p1).add(p2).divideScalar(3);
                    const radius = Math.max(center.distanceTo(p0), center.distanceTo(p2), center.distanceTo(p2));
    
                    face.boundingSphere = new Sphere(center, radius);
                    face.children = [];
    
                    resolve();
                }));
            }
            
            await Promise.all(tasks);
            tasks.splice(0, tasks.length);
            
            const tasks2: Promise<number>[] = [];
            
            const unparentedTiles: Tile[] = [];
            for (let i = 0; i < tiles.length; i++) {
                tasks2.push(new Promise((resolve) => {
                    const tile = tiles[i];
                    if (tile.boundingSphere) {
    
                        let parentFound = false;
                        for (let j = 0; j < icosahedron.faces.length; j++) {
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
    
                        resolve(tile.boundingSphere.center.length() + tile.boundingSphere.radius);
                    } else {
                        resolve(0);
                    }
                }));
            }
            
            const distances = await Promise.all(tasks2);
            tasks2.splice(0, tasks2.length);
    
            const maxDistanceFromOrigin = distances.reduce((a, b) => a > b ? a : b);
        
            const rootPartition = new SpatialPartition(new Sphere(new Vector3(0, 0, 0), maxDistanceFromOrigin), [], unparentedTiles);
            for (let i = 0; i < icosahedron.faces.length; i++) {
                tasks.push(new Promise((resolve) => {
                    const face = icosahedron.faces[i];
                    if (face.boundingSphere) {
                        rootPartition.partitions.push(new SpatialPartition(face.boundingSphere, [], face.children));
                        face.release();
                    }
    
                    resolve();
                }));
            }
            
            await Promise.all(tasks);
            tasks.splice(0, tasks.length);
    
            return rootPartition;
        }

        return undefined;
    }
    
    private generatePlanetTerrain(plateCount: number, oceanicRate: number, heatLevel: number, moistureLevel: number) {
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
            const platelessTiles: Tile[] = [];
            const platelessTilePlates: Plate[] = [];
    
            let failedCount = 0;
            while (plates.length < plateCount && failedCount < 10000) {
                const corner = topology.corners[this._random.integerExclusive(0, topology.corners.length)];
                let adjacentToExistingPlate = false;
                for (let i = 0; i < corner.tiles.length; i++) {
                    if (corner.tiles[i].plate) {
                        adjacentToExistingPlate = true;
                        failedCount += 1;
                        break;
                    }
                }
                if (adjacentToExistingPlate) continue;
    
                failedCount = 0;
    
                const oceanic = (this._random.unit() < oceanicRate);
                const plate = new Plate(
                    new Color(this._random.integer(0, 0xFFFFFF)),
                    randomUnitVector(this._random),
                    this._random.realInclusive(-Math.PI / 30, Math.PI / 30),
                    this._random.realInclusive(-Math.PI / 30, Math.PI / 30),
                    oceanic ? this._random.realInclusive(-0.8, -0.3) : this._random.realInclusive(0.1, 0.5),
                    oceanic,
                    corner);
    
                plates.push(plate);
    
                for (let i = 0; i < corner.tiles.length; i++) {
                    corner.tiles[i].plate = plate;
                    plate.tiles.push(corner.tiles[i]);
                }
    
                for (let i = 0; i < corner.tiles.length; i++) {
                    const tile = corner.tiles[i];
                    for (let j = 0; j < tile.tiles.length; j++) {
                        const adjacentTile = tile.tiles[j];
                        if (!adjacentTile?.plate) {
                            if (adjacentTile) {
                                platelessTiles.push(adjacentTile);
                            }
                            platelessTilePlates.push(plate);
                        }
                    }
                }
            }
        
            while (platelessTiles.length > 0) {
                const tileIndex = Math.floor(Math.pow(this._random.unit(), 2) * platelessTiles.length);
                const tile = platelessTiles[tileIndex];
                const plate = platelessTilePlates[tileIndex];
                platelessTiles.splice(tileIndex, 1);
                platelessTilePlates.splice(tileIndex, 1);
    
                if (!tile.plate) {
                    tile.plate = plate;
                    plate.tiles.push(tile);
                    for (let j = 0; j < tile.tiles.length; j++) {
                        const adjacentTile = tile.tiles[j];
                        if (!adjacentTile?.plate) {
                            if (adjacentTile) {
                                platelessTiles.push(adjacentTile);
                            }
                            platelessTilePlates.push(plate);
                        }
                    }
                }
            }

            this.plates.splice(0, this.plates.length);
            this.plates.push(...plates);
        
            this.calculateCornerDistancesToPlateRoot();
        }
    }
    
    private calculateCornerDistancesToPlateRoot() {
        const plates = this.plates;
        if (plates) {
            interface CornerQueueItem { corner: Corner; distanceToPlateRoot: number };
    
            const distanceCornerQueue: CornerQueueItem[] = [];
            for (let i = 0; i < plates.length; i++) {
                const corner = plates[i].root;
                corner.distanceToPlateRoot = 0;
    
                for (let j = 0; j < corner.corners.length; j++) {
                    distanceCornerQueue.push({
                        corner: corner.corners[j],
                        distanceToPlateRoot: corner.borders[j].length()
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
                            corner: corner.corners[j],
                            distanceToPlateRoot: distanceToPlateRoot + corner.borders[j].length()
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
            this.identifyBoundaryBorders(this.topology.borders);
    
            const boundaryCorners: Corner[] = this.collectBoundaryCorners(this.topology.corners);
            const boundaryCornerInnerBorderIndexes = this.calculatePlateBoundaryStress(boundaryCorners);
    
            this.blurPlateBoundaryStress(boundaryCorners, 3, 0.4);
            const elevationBorderQueue = this.populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes);
    
            this.processElevationBorderQueue(elevationBorderQueue);
            this.calculateTileAverageElevations(this.topology.tiles);
        }
    }
    
    private identifyBoundaryBorders(borders: Border[]) {
        for (let i = 0; i < borders.length; i++) {
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
    
    private collectBoundaryCorners(corners: Corner[]) {
        const boundaryCorners = [];
        for (let j = 0; j < corners.length; j++) {
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

        return boundaryCorners;
    }
    
    private calculatePlateBoundaryStress(boundaryCorners: Corner[]) {
        const boundaryCornerInnerBorderIndexes = new Array<number | undefined>(boundaryCorners.length);
        for (let i = 0; i < boundaryCorners.length; i++) {
            const corner = boundaryCorners[i];
            corner.distanceToPlateBoundary = 0;
    
            let innerBorder;
            let innerBorderIndex;
            for (let j = 0; j < corner.borders.length; j++) {
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
    
    private blurPlateBoundaryStress(boundaryCorners: Corner[], stressBlurIterations: number, stressBlurCenterWeighting: number) {
        const newCornerPressure = new Array(boundaryCorners.length);
        const newCornerShear = new Array(boundaryCorners.length);
        for (let i = 0; i < stressBlurIterations; i++) {
            for (let j = 0; j < boundaryCorners.length; j++) {
                const corner = boundaryCorners[j];
                let averagePressure = 0;
                let averageShear = 0;
                let neighborCount = 0;
                for (let k = 0; k < corner.corners.length; k++) {
                    const neighbor = corner.corners[k];
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
                const corner = boundaryCorners[j];
                if (corner.betweenPlates) {
                    corner.pressure = newCornerPressure[j];
                    corner.shear = newCornerShear[j];
                }
            }
        }
    }
    
    private populateElevationBorderQueue(boundaryCorners: Corner[], boundaryCornerInnerBorderIndexes: (number | undefined)[]) {
        const elevationBorderQueue: ElevationBorderQueueItem[] = [];
        for (let i = 0; i < boundaryCorners.length; i++) {
            const corner = boundaryCorners[i];
    
            const innerBorderIndex = boundaryCornerInnerBorderIndexes[i];
            if (innerBorderIndex) {
                const innerBorder = corner.borders[innerBorderIndex];
                const outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
                const plate0 = innerBorder.tiles[0].plate;
                const plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;
    
                let calculateElevation: (distanceToPlateBoundary: number, distanceToPlateRoot: number, boundaryElevation: number, plateElevation: number, pressure: number, shear: number) => number;
    
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
    
                //corner.elevation = 0;

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
                        const border = corner.borders[j];
                        if (!border.betweenPlates) {
                            const nextCorner = corner.corners[j];
                            const distanceToPlateBoundary = corner.distanceToPlateBoundary + border.length();
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
    
    private calculateTileAverageElevations(tiles: Tile[]) {
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            let elevation = 0;
            for (let j = 0; j < tile.corners.length; j++) {
                elevation += tile.corners[j].elevation;
            }
            tile.elevation = elevation / tile.corners.length;
        }
    }
    
    private generatePlanetWeather(heatLevel: number, moistureLevel: number) {
        if (this.topology) {
            let activeCorners: Corner[] = [];
            let remainingHeat = 0;
            let consumedHeat = 0;
            let remainingMoisture = 0;
            let consumedMoisture = 0;
            
            const whorls: Whorl[] = this.generateAirCurrentWhorls();
            this.calculateAirCurrents(whorls);
            
            const airHeatResult = this.initializeAirHeat(heatLevel);
            if (airHeatResult) {
                activeCorners.push(...airHeatResult.corners);
                remainingHeat = airHeatResult.airHeat;
        
                while (remainingHeat > 0 && consumedHeat >= 0.0001) {
                    consumedHeat = this.processAirHeat(activeCorners);
                    remainingHeat -= consumedHeat;
                }
            }
            
            this.calculateTemperature();

            const airMoistureResult = this.initializeAirMoisture(moistureLevel);
            if (airMoistureResult) {
                activeCorners = airMoistureResult.corners;
                remainingMoisture = airMoistureResult.airMoisture;
        
                while (remainingMoisture > 0 && consumedMoisture >= 0.0001) {
                    consumedMoisture = this.processAirMoisture(activeCorners);
                    remainingMoisture -= consumedMoisture;
                }
            }
    
            this.calculateMoisture();
        }
    }
    
    private generateAirCurrentWhorls() {
        const whorls: Whorl[] = [];
        let direction = this._random.integer(0, 1) ? 1 : -1;
        const layerCount = this._random.integer(4, 7);
        const circumference = Math.PI * 2 * this.radius;
        const fullRevolution = Math.PI * 2;
        const baseWhorlRadius = circumference / (2 * (layerCount - 1));
    
        whorls.push({
            center: new Vector3(0, this.radius, 0)
                .applyAxisAngle(new Vector3(1, 0, 0), this._random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                .applyAxisAngle(new Vector3(0, 1, 0), this._random.real(0, fullRevolution)),
            strength: this._random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
            radius: this._random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        });
    
        for (let i = 1; i < layerCount - 1; i++) {
            direction = -direction;
            const baseTilt = i / (layerCount - 1) * fullRevolution / 2;
            const layerWhorlCount = Math.ceil((Math.sin(baseTilt) * this.radius * fullRevolution) / baseWhorlRadius);
            for (let j = 0; j < layerWhorlCount; j++) {
                whorls.push({
                    center: new Vector3(0, this.radius, 0)
                        .applyAxisAngle(new Vector3(1, 0, 0), this._random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                        .applyAxisAngle(new Vector3(0, 1, 0), this._random.real(0, fullRevolution))
                        .applyAxisAngle(new Vector3(1, 0, 0), baseTilt)
                        .applyAxisAngle(new Vector3(0, 1, 0), fullRevolution * (j + (i % 2) / 2) / layerWhorlCount),
                    strength: this._random.realInclusive(fullRevolution / 48, fullRevolution / 32) * direction,
                    radius: this._random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
                });
            }
        }
    
        direction = -direction;
        whorls.push({
            center: new Vector3(0, this.radius, 0)
                .applyAxisAngle(new Vector3(1, 0, 0), this._random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
                .applyAxisAngle(new Vector3(0, 1, 0), this._random.real(0, fullRevolution))
                .applyAxisAngle(new Vector3(1, 0, 0), fullRevolution / 2),
            strength: this._random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
            radius: this._random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
        });

        return whorls;
    }
    
    calculateAirCurrents(whorls: Whorl[]) {
        const corners = this.topology?.corners;
        if (corners) {
            for(let i = 0; i < corners.length; i++) {
                const corner = corners[i];
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
                corner.airCurrent = airCurrent;
                corner.airCurrentSpeed = airCurrent.length(); //kilometers per hour
        
                corner.airCurrentOutflows = new Array(corner.borders.length);
                const airCurrentDirection = airCurrent.clone().normalize();
                let outflowSum = 0;
                for (let j = 0; j < corner.corners.length; j++) {
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
                    for (let j = 0; j < corner.borders.length; j++) {
                        corner.airCurrentOutflows[j] /= outflowSum;
                    }
                }
            }
        }
    }
    
    initializeAirHeat(heatLevel: number) {
        const corners = this.topology?.corners;
        if (corners) {
            const activeCorners = [];
            let airHeat = 0;
            for (let i = 0; i < corners.length; i++) {
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
    
            const result: AirHeatResult = {
                corners: activeCorners,
                airHeat: airHeat
            };
            
            return result;
        }

        return undefined;
    }
    
    processAirHeat(activeCorners: Corner[]) {
        let consumedHeat = 0;
        const activeCornerCount = activeCorners.length;
        for (let i = 0; i < activeCornerCount; i++) {
            const corner = activeCorners[i];
            if (corner.airHeat === 0) continue;
    
            let heatChange = Math.max(0, Math.min(corner.airHeat, corner.heatAbsorption * (1 - corner.heat / corner.maxHeat)));
            corner.heat += heatChange;
            consumedHeat += heatChange;
            const heatLoss = corner.area * (corner.heat / corner.maxHeat) * 0.02;
            heatChange = Math.min(corner.airHeat, heatChange + heatLoss);
    
            const remainingCornerAirHeat = corner.airHeat - heatChange;
            corner.airHeat = 0;
    
            for (let j = 0; j < corner.corners.length; j++) {
                if (corner.airCurrentOutflows && corner.airCurrentOutflows[j] > 0) {
                    const outflow = corner.airCurrentOutflows[j];
                    corner.corners[j].newAirHeat += remainingCornerAirHeat * outflow;
                    activeCorners.push(corner.corners[j]);
                }
            }
        }
    
        activeCorners.splice(0, activeCornerCount);
    
        for (let i = 0; i < activeCorners.length; i++) {
            const corner = activeCorners[i];
            corner.airHeat = corner.newAirHeat;
        }
        for (let i = 0; i < activeCorners.length; i++) {
            activeCorners[i].newAirHeat = 0;
        }
    
        return consumedHeat;
    }
    
    calculateTemperature() {
        const corners = this.topology?.corners;
        const tiles = this.topology?.tiles;

        if (corners && tiles) {
            for (let i = 0; i < corners.length; i++) {
                const corner = corners[i];
                const latitudeEffect = Math.sqrt(1 - Math.abs(corner.position.y) / this.radius);
                const elevationEffect = 1 - Math.pow(Math.max(0, Math.min(corner.elevation * 0.8, 1)), 2);
                const normalizedHeat = corner.heat / corner.area;
                corner.temperature = (latitudeEffect * elevationEffect * 0.7 + normalizedHeat * 0.3) * 5 / 3 - 2 / 3;
                delete corner.airHeat;
                delete corner.newAirHeat;
                delete corner.heat;
                delete corner.maxHeat;
                delete corner.heatAbsorption;
            }
        
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                tile.temperature = 0;
                for (let j = 0; j < tile.corners.length; j++) {
                    tile.temperature += tile.corners[j].temperature;
                }
                tile.temperature /= tile.corners.length;
            }
        }
    }
    
    initializeAirMoisture(moistureLevel: number) {
        const corners = this.topology?.corners;
        if (corners) {
            const activeCorners = [];
            let airMoisture = 0;
    
            for (let i = 0; i < corners.length; i++) {
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
    
            const result: AirMoistureResult = {
                corners: activeCorners,
                airMoisture: airMoisture
            };
    
            return result;
        }

        return undefined;
    }
    
    processAirMoisture(activeCorners: Corner[]) {
        let consumedMoisture = 0;
        const activeCornerCount = activeCorners.length;
        for (let i = 0; i < activeCornerCount; i++) {
            const corner = activeCorners[i];
            if (corner.airMoisture && corner.precipitationRate && corner.precipitation && corner.maxPrecipitation && corner.airCurrentOutflows) {
                let moistureChange = Math.max(0, Math.min(corner.airMoisture, corner.precipitationRate * (1 - corner.precipitation / corner.maxPrecipitation)));
                corner.precipitation += moistureChange;
                consumedMoisture += moistureChange;
                const moistureLoss = corner.area * (corner.precipitation / corner.maxPrecipitation) * 0.02;
                moistureChange = Math.min(corner.airMoisture, moistureChange + moistureLoss);
        
                const remainingCornerAirMoisture = corner.airMoisture - moistureChange;
                corner.airMoisture = 0;
        
                for (let j = 0; j < corner.corners.length; j++) {
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
    
        for (let i = 0; i < activeCorners.length; i++) {
            const corner = activeCorners[i];
            corner.airMoisture = corner.newAirMoisture;
        }
        for (let i = 0; i < activeCorners.length; i++) {
            activeCorners[i].newAirMoisture = 0;
        }
    
        return consumedMoisture;
    }
    
    calculateMoisture() {
        const corners = this.topology?.corners;
        const tiles = this.topology?.tiles;
        if (corners && tiles) {
            for (let i = 0; i < corners.length; i++) {
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
        
            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                tile.moisture = 0;
                for (let j = 0; j < tile.corners.length; j++) {
                    tile.moisture += tile.corners[j].moisture;
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
    }
    
    generatePlanetRenderData() {
        const renderData: RenderData = {};
        renderData.surface = this.buildSurfaceRenderObject();
        renderData.plateBoundaries = this.buildPlateBoundariesRenderObject();
        renderData.plateMovements = this.buildPlateMovementsRenderObject();
        renderData.airCurrents = this.buildAirCurrentsRenderObject();
    
        return renderData;
    }
    
    buildSurfaceRenderObject() {
        const tiles = this.topology?.tiles;
        if (tiles) {
            const planetGeometry = new Geometry();
            const terrainColors: Color[][] = [];
            const plateColors: Color[][] = [];
            const elevationColors: Color[][] = [];
            const temperatureColors: Color[][] = [];
            const moistureColors: Color[][] = [];
        
            for(let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
        
                const colorDeviance = new Color(this._random.unit(), this._random.unit(), this._random.unit());
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
                    for (let j = 0; j < tile.corners.length; j++) {
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
    
                        for (let k = planetGeometry.faces.length - 3; k < planetGeometry.faces.length; k++) {
                            planetGeometry.faces[k].vertexColors = terrainColors[k];
                        }
                    }
                }
            }
        
            //planetGeometry.dynamic = true;
            planetGeometry.computeBoundingSphere();
            const planetMaterial = new MeshLambertMaterial({
                color: new Color(0x000000),
                //ambient: new Color(0xFFFFFF),
                vertexColors: true
            });
            const planetRenderObject = new Mesh(planetGeometry, planetMaterial);
            planetRenderObject.name = 'planet';
    
            const surface: RenderSurface = {
                geometry: planetGeometry,
                terrainColors: terrainColors,
                plateColors: plateColors,
                elevationColors: elevationColors,
                temperatureColors: temperatureColors,
                moistureColors: moistureColors,
                material: planetMaterial,
                renderObject: planetRenderObject,
            };
    
            return surface;
        }

        return undefined;
    }
    
    buildPlateBoundariesRenderObject() {
        const borders = this.topology?.borders;
        if (borders) {
            const geometry = new Geometry();
        
            for(let i = 0; i < borders.length; i++) {
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
            }
        
            geometry.computeBoundingSphere();
            const material = new MeshBasicMaterial({
                vertexColors: true
            });
            const renderObject = new Mesh(geometry, material);
    
            const boundaries: RenderPlateBoundaries = {
                geometry: geometry,
                material: material,
                renderObject: renderObject,
            };
    
            return boundaries;
        }

        return undefined;
    }
    
    buildPlateMovementsRenderObject() {
        const tiles = this.topology?.tiles;
        if (tiles) {
            const geometry = new Geometry();
        
            for(let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                const plate = tile.plate;
                if (plate) {
                    const movement = plate.calculateMovement(tile.position);
                    const plateMovementColor = new Color(1 - plate.color.r, 1 - plate.color.g, 1 - plate.color.b);
            
                    this.buildArrow(geometry, 
                        tile.position.clone().multiplyScalar(1.002), 
                        movement.clone().multiplyScalar(0.5), 
                        Math.min(movement.length(), 4), 
                        plateMovementColor);
            
                    tile.plateMovement = movement;
                }
            }
        
            geometry.computeBoundingSphere();
            const material = new MeshBasicMaterial({
                vertexColors: true,
            });
            const renderObject = new Mesh(geometry, material);
    
            const movement: RenderPlateMovement = {
                geometry: geometry,
                material: material,
                renderObject: renderObject
            };
    
            return movement;
        }

        return undefined;
    }
    
    buildAirCurrentsRenderObject() {
        const corners = this.topology?.corners;
        if (corners) {
            const geometry = new Geometry();
        
            for(let i = 0; i < corners.length; i++) {
                const corner = corners[i];
                if (corner.airCurrent) {
                    this.buildArrow(geometry, 
                        corner.position.clone().multiplyScalar(1.002), 
                        corner.airCurrent.clone().multiplyScalar(0.5), 
                        Math.min(corner.airCurrent.length(), 4),
                        new Color(0xff0000)
                    );
                }
            }
    
            geometry.computeBoundingSphere();
            const material = new MeshBasicMaterial({
                color: new Color(0xFFFFFF),
            });
            const renderObject = new Mesh(geometry, material);
    
            const airCurrents: RenderAirCurrents = {
                geometry: geometry,
                material: material,
                renderObject: renderObject,
            };
            
            return airCurrents;
        }

        return undefined;
    }
    
    private buildArrow(geometry: Geometry, position: Vector3, direction: Vector3, width: number, color: Color = new Color(0xffffff)) {
        if (direction.lengthSq() > 0) {
            const baseIndex = geometry.vertices.length;

            const normal = position.clone().multiplyScalar(-1).normalize();
            const offsetX = direction.clone().cross(normal).setLength(width / 2);
            const offsetY = direction.clone().multiplyScalar(.5);

            geometry.vertices.push(
                position.clone().add(offsetX).sub(offsetY), 
                position.clone().add(offsetY), 
                position.clone().sub(offsetX).sub(offsetY)
            );
            geometry.faces.push(
                new Face3(baseIndex, baseIndex + 2, baseIndex + 1, normal, color));
        }
    }
    
    private buildTileWedge(f: Face3[], b: number, s: number, t: number, n: Vector3) {
        f.push(
            new Face3(b + s + 2, b + t + 2, b, n),
            new Face3(b + s + 1, b + t + 1, b + t + 2, n),
            new Face3(b + s + 1, b + t + 2, b + s + 2, n)
        );
    }
    
    private buildTileWedgeColors(f: Color[][], c: Color, bc: Color) {
        f.push([c, c, c]);
        f.push([bc, bc, c]);
        f.push([bc, c, c]);
    }
    
    private generatePlanetStatistics() {
        const topology = this.topology;
        const plates = this.plates;
        
        if (topology && plates) {
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
        
            for (let i = 0; i < topology.corners.length; i++) {
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
        
            for (let i = 0; i < topology.borders.length; i++) {
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
        
            for (let i = 0; i < topology.tiles.length; i++) {
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
        
            for (let i = 0; i < plates.length; i++) {
                const plate = plates[i];
                updateMinMaxAvg(statistics.plates.tileCount, plate.tiles.length);
                plate.area = 0;
                for (let j = 0; j < plate.tiles.length; j++) {
                    const tile = plate.tiles[j];
                    plate.area += tile.area;
                }
                updateMinMaxAvg(statistics.plates.area, plate.area);
                let elevation = 0;
                for (let j = 0; j < plate.boundaryCorners.length; j++) {
                    const corner = plate.boundaryCorners[j];
                    elevation += corner.elevation;
                }
                updateMinMaxAvg(statistics.plates.boundaryElevation, elevation / plate.boundaryCorners.length);
                updateMinMaxAvg(statistics.plates.boundaryBorders, plate.boundaryBorders.length);
                plate.circumference = 0;
                for (let j = 0; j < plate.boundaryBorders.length; j++) {
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
        
            return statistics;
        }

        return undefined;
    }
    
    serialize(prefix: string, suffix: string) {
        const stringPieces = [];
    
        stringPieces.push(prefix, '{nodes:[');
        for (let i = 0; i < this._mesh.nodes.length; i++) {
            const node = this._mesh.nodes[i];
            stringPieces.push(i !== 0 ? ',\n{p:new Vector3(' : '\n{p:new Vector3(', node.p.x.toString(), ',', node.p.y.toString(), ',', node.p.z.toString(), '),e:[', node.e[0].toFixed(0));
            for (let j = 1; j < node.e.length; j++) stringPieces.push(',', node.e[j].toFixed(0));
            stringPieces.push('],f:[', node.f[0].toFixed(0));
            for (let j = 1; j < node.f.length; j++) stringPieces.push(',', node.f[j].toFixed(0));
            stringPieces.push(']}');
        }
        stringPieces.push('\n],edges:[');
        for (let i = 0; i < this._mesh.edges.length; i++) {
            const edge = this._mesh.edges[i];
            stringPieces.push(i !== 0 ? ',\n{n:[' : '\n{n:[', edge.n[0].toFixed(0), ',', edge.n[1].toFixed(0), '],f:[', edge.f[0].toFixed(0), ',', edge.f[1].toFixed(0), ']}');
        }
        stringPieces.push('\n],faces:[');
        for (let i = 0; i < this._mesh.faces.length; i++) {
            const face = this._mesh.faces[i];
            stringPieces.push(i !== 0 ? ',\n{n:[' : '\n{n:[', face.n[0].toFixed(0), ',', face.n[1].toFixed(0), ',', face.n[2].toFixed(0), '],e:[', face.e[0].toFixed(0), ',', face.e[1].toFixed(0), ',', face.e[2].toFixed(0), ']}');
        }
        stringPieces.push('\n]}', suffix);
    
        return stringPieces.join('');
    }
}

export default Planet;
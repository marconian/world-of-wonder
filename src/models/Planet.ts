/* eslint-disable no-throw-literal */
import Plate from './Plate';
import Topology from './Topology';
import RenderData, { RenderSurface, RenderPlateBoundaries, RenderPlateMovement, RenderAirCurrents } from './RenderData';
import Statistics from './Statistics';
import { Color, Vector3, Geometry, MeshLambertMaterial, Mesh, Face3, MeshBasicMaterial } from 'three';
import { MeshDescription } from './MeshDescription';
import XorShift128 from '../utils/XorShift128';
import { PlanetWorker } from '../workers/PlanetWorker';
import { wrap, releaseProxy, Remote } from 'comlink';
import Tile from './Tile';

export type PlanetMode = 'terrain' | 'plates' | 'elevation' | 'temperature' | 'moisture';

export class Planet {
    seed: number;
    topology?: Topology;
    renderData?: RenderData;
    statistics?: Statistics;
    plates: Plate[];
    radius: number;

    private _mode: PlanetMode = 'terrain';
    private _sunlight = true;
    private _plateBoundaries = true;
    private _plateMovements = true;
    private _airCurrents = true;
    private _oceanicCurrents = true;
    private _mesh: MeshDescription;
    private _random: XorShift128;
    private _worker?: Worker;
    private _tools?: Remote<PlanetWorker>;

    constructor(seed: number, mesh: MeshDescription) {
        this.seed = seed;
        this.plates = [];
        this._random = new XorShift128(seed, seed, seed, seed);
        this.radius = this._random.integer(500, 1500);
        this._mesh = mesh;
    }

    async build(plateCount: number, oceanicRate: number, heatLevel: number, moistureLevel: number) {
        this._worker = new Worker('../workers/PlanetWorker', { type: 'module' });
        this._tools = wrap<PlanetWorker>(this._worker);

        await this._tools.init(this._mesh, this.radius, this.seed);
        await this._tools.generateTopology();
        await this._tools.generateTerrain(plateCount, oceanicRate, heatLevel, moistureLevel);

        this.topology = await this._tools.topology;
        if (this.topology) await Topology.revive(this.topology);

        this.plates = await this._tools.plates;
        if (this.plates) await Plate.revive(this.plates);

        this.renderData = this.generatePlanetRenderData();
        //this.statistics = this.generatePlanetStatistics();

        (window as any).planet = this;
        (window as any).topology = this.topology;
        (window as any).plates = this.plates;
    }

    dispose() {
        if (this._tools) {
            this._tools[releaseProxy]();
        }
        if (this._worker) {
            this._worker.terminate();
        }
        
        this.topology?.dispose();
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
    
    toggleOceanicCurrents(show?: boolean) {
        if (typeof show === 'boolean') {
            this._oceanicCurrents = show;
        } else {
            this._oceanicCurrents = !this._oceanicCurrents;
        }
    
        if (this?.renderData?.surface && this?.renderData.oceanicCurrents) {
            if (this._oceanicCurrents) {
                this.renderData.surface.renderObject.add(this.renderData.oceanicCurrents.renderObject);
            } else {
                this.renderData.surface.renderObject.remove(this.renderData.oceanicCurrents.renderObject);
            }
        }
    }
    
    generatePlanetRenderData() {
        const renderData: RenderData = {
            surface: this.buildSurfaceRenderObject(),
            plateBoundaries: this.buildPlateBoundariesRenderObject(),
            plateMovements: this.buildPlateMovementsRenderObject(),
            airCurrents: this.buildAirCurrentsRenderObject(),
            oceanicCurrents: this.buildOceanicCurrentsRenderObject()
        };
    
        return renderData;
    }

    getColor(primary: string | number | Color, secondary?: string | number | Color, offset?: number, alpha?: number) {
        let color = new Color(primary);
        if (secondary !== undefined) { color = color.lerp(new Color(secondary), offset !== undefined ? offset : 1); }
        if (alpha !== undefined) {
            const deviance = new Color(this._random.unit(), this._random.unit(), this._random.unit());
            color = color.lerp(deviance, alpha);
        }

        return color;
    }

    getBiomeColor(tile: Tile) {
        let normalizedElevation: number | undefined;
        if (tile.elevation <= 0) {
            normalizedElevation = Math.min(-tile.elevation, 1);
        } else if (tile.elevation < .6) {
            normalizedElevation = tile.elevation / 0.6;
        } else if (tile.elevation < .8) {
            normalizedElevation = (tile.elevation - 0.6) / 0.2;
        } else {
            normalizedElevation = Math.min((tile.elevation - 0.8) / 0.5, 1);
        }

        switch(tile.biome) {
        case 'ocean':
            return this.getColor(0x0066FF, 0x0044BB, Math.min(-tile.elevation, 1), 0);//), .1);
        case 'oceanGlacier':
            return this.getColor(0xDDEEFF, undefined, undefined, 0);//), .1);
        case 'landGlacier':
            return this.getColor(0xDDEEFF, undefined, undefined, 0);//), .1);
        case 'desert':
            return this.getColor(0xDDDD77, 0xBBBB55, normalizedElevation, 0);//), .1);
        case 'rainForest':
            return this.getColor(0x0B4001, 0x083000, normalizedElevation, 0);//), .1);
        case 'rocky':
            return this.getColor(0xAA9977, 0x887755, normalizedElevation, 0);//), .1);
        case 'plains':
            return this.getColor(0x77CC44, 0x667722, normalizedElevation, 0);//), .1);
        case 'grassland':
            return this.getColor(0x77CC44, 0x448822, normalizedElevation, 0);//), .1);
        case 'swamp':
            return this.getColor(0x0B4001, 0x00e7f7, normalizedElevation, 0);//), .1);
        case 'coniferForest':
            return this.getColor(0x004a35, 0x002917, normalizedElevation, 0);//), .1);
        case 'deciduousForest':
            return this.getColor(0x005426, 0x007516, normalizedElevation, 0);//), .1);
        case 'tundra':
            return this.getColor(tile.elevation < .6 ? 0x9999AA : 0x777788, tile.elevation < .6 ? 0x777788 : 0x666677, normalizedElevation, 0);
        case 'snow':
            return this.getColor(0xEEEEEE, 0xDDDDDD, normalizedElevation, 0);
        case 'mountain':
            return this.getColor(tile.elevation < .8 ? 0x555544 : 0x444433, tile.elevation < .8 ? 0x444433 : 0x333322, normalizedElevation, 0);
        case 'snowyMountain':
            return this.getColor(0xDDDDDD, 0xFFFFFF, normalizedElevation, 0);
        default:
            return this.getColor(0xFF00FF);
        }
    }

    getElevationColor(tile: Tile) {
        if (tile.elevation <= 0) return this.getColor(0x224488, 0xAADDFF, Math.max(0, Math.min((tile.elevation + 3 / 4) / (3 / 4), 1)));
        else if (tile.elevation < 0.75) return this.getColor(0x997755, 0x553311, Math.max(0, Math.min((tile.elevation) / (3 / 4), 1)));
        else return this.getColor(0x553311, 0x222222, Math.max(0, Math.min((tile.elevation - 3 / 4) / (1 / 2), 1)));
    }

    getTemperatureColor(tile: Tile) {
        if (tile.temperature <= 0) return this.getColor(0x0000FF, 0xBBDDFF, Math.max(0, Math.min((tile.temperature + 2 / 3) / (2 / 3), 1)));
        else return this.getColor(0xFFFF00, 0xFF0000, Math.max(0, Math.min((tile.temperature) / (3 / 3), 1)));
    }

    getMoistureColor(tile: Tile) {
        return this.getColor(0xFFCC00, 0x0066FF, Math.max(0, Math.min(tile.humidity, 1)));
    }

    async update() {
        if (this.topology && this.renderData?.surface) {

            const terrainColors: Color[][] = [];
            const temperatureColors: Color[][] = [];
            const moistureColors: Color[][] = [];

            if (this._tools) {
                await Promise.all([
                    this._tools.processHeat(),
                    this._tools.processAirMoisture()
                ]);
                const results = await Promise.all([
                    this._tools.calculateTemperature(),
                    this._tools.calculateHumidity()
                ]);

                const temperature = results[0];
                const humidity = results[1];
                const biomes = await this._tools.generatePlanetBiomes();

                if (temperature && humidity && biomes) {
                    let updateBiomes = false;
                    let updateTemperature = false;
                    let updateHumidity = false;

                    for (let i = 0; i < this.topology.tiles().length; i++) {
                        const tile = this.topology.tiles()[i];
                        if (tile.biome !== biomes[i]) {
                            tile.biome = biomes[i];
                            updateBiomes = true;
                        }
                        if (tile.temperature !== temperature[i]) {
                            tile.temperature = temperature[i];
                            updateTemperature = true;
                        }
                        if (tile.humidity !== humidity[i]) {
                            tile.humidity = humidity[i];
                            updateHumidity = true;
                        }
                    }

                    if (updateBiomes) {
                        for (const tile of this.topology.tiles()) {
                            const terrainColor = this.getBiomeColor(tile);
                            for (let j = 0; j < this.topology.corners(tile).length; j++) {
                                this.buildTileWedgeColors(terrainColors, terrainColor, terrainColor.clone().multiplyScalar(0.5));
                            }
                            this.renderData.surface.terrainColors = terrainColors;
                        }
                    }
                    if (updateTemperature) {
                        for (const tile of this.topology.tiles()) {
                            const temperatureColor = this.getTemperatureColor(tile);
                            for (let j = 0; j < this.topology.corners(tile).length; j++) {
                                this.buildTileWedgeColors(temperatureColors, temperatureColor, temperatureColor.clone().multiplyScalar(0.5));
                            }
                            this.renderData.surface.temperatureColors = temperatureColors;
                        }
                    }
                    if (updateHumidity) {
                        for (const tile of this.topology.tiles()) {
                            const moistureColor = this.getMoistureColor(tile);
                            for (let j = 0; j < this.topology.corners(tile).length; j++) {
                                this.buildTileWedgeColors(moistureColors, moistureColor, moistureColor.clone().multiplyScalar(0.5));
                            }
                            this.renderData.surface.moistureColors = moistureColors;
                        }
                    }
                }
            }
            
            const faces = this.renderData.surface.geometry.faces;
            if (this._mode === 'terrain') {
                for (let i = 0; i < faces.length; i++) {
                    faces[i].vertexColors = this.renderData.surface.terrainColors[i];
                }
        
                this.renderData.surface.geometry.elementsNeedUpdate = true;
            } else if (this._mode === 'temperature') {
                for (let i = 0; i < faces.length; i++) {
                    faces[i].vertexColors = this.renderData.surface.temperatureColors[i];
                }
        
                this.renderData.surface.geometry.elementsNeedUpdate = true;
            } else if (this._mode === 'moisture') {
                for (let i = 0; i < faces.length; i++) {
                    faces[i].vertexColors = this.renderData.surface.moistureColors[i];
                }
        
                this.renderData.surface.geometry.elementsNeedUpdate = true;
            }
        }
    }
    
    buildSurfaceRenderObject() {
        if (this.topology) {

            const planetGeometry = new Geometry();
            const terrainColors: Color[][] = [];
            const plateColors: Color[][] = [];
            const elevationColors: Color[][] = [];
            const temperatureColors: Color[][] = [];
            const moistureColors: Color[][] = [];
        
            for(let i = 0; i < this.topology.tiles().length; i++) {
                const tile = this.topology.tiles()[i];
        
                const terrainColor = this.getBiomeColor(tile);
                const plateColor = tile.plate ? this.plates[tile.plate].color.clone() : new Color(0xff0000);
                const elevationColor = this.getElevationColor(tile);
                const temperatureColor = this.getTemperatureColor(tile);
                const moistureColor = this.getMoistureColor(tile);
        
                const baseIndex = planetGeometry.vertices.length;
                planetGeometry.vertices.push(tile.position);
                for (let j = 0; j < this.topology.corners(tile).length; j++) {
                    const corner = this.topology.corners(tile)[j];
                    //const elevation = corner.position.clone().normalize().multiplyScalar(corner.elevation * 10);
                    planetGeometry.vertices.push(corner.position.clone());
                    planetGeometry.vertices.push(tile.position.clone().sub(corner.position).multiplyScalar(0.1).add(corner.position));
        
                    const i0 = j * 2;
                    const i1 = ((j + 1) % this.topology.corners(tile).length) * 2;
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
        if (this.topology) {
            const geometry = new Geometry();
        
            for(let i = 0; i < this.topology.borders().length; i++) {
                const border = this.topology.borders()[i];
                if (border.betweenPlates && border.midpoint) {
                    const normal = border.midpoint.clone().normalize();
                    const offset = normal.clone().multiplyScalar(1);
        
                    const borderPoint0 = this.topology.corners(border)[0].position;
                    const borderPoint1 = this.topology.corners(border)[1].position;
                    const tilePoint0 = this.topology.tiles(border)[0].position;
                    const tilePoint1 = this.topology.tiles(border)[1].position;
    
                    if (tilePoint0 && tilePoint1) {
                        const baseIndex = geometry.vertices.length;
                        geometry.vertices.push(borderPoint0.clone().add(offset));
                        geometry.vertices.push(borderPoint1.clone().add(offset));
                        geometry.vertices.push(tilePoint0.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
                        geometry.vertices.push(tilePoint0.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));
                        geometry.vertices.push(tilePoint1.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
                        geometry.vertices.push(tilePoint1.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));
            
                        const pressure = Math.max(-1, Math.min((this.topology.corners(border)[0].pressure + this.topology.corners(border)[1].pressure) / 2, 1));
                        const shear = Math.max(0, Math.min((this.topology.corners(border)[0].shear + this.topology.corners(border)[1].shear) / 2, 1));
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
        if (this.topology) {
            const geometry = new Geometry();
        
            for(let i = 0; i < this.topology.tiles().length; i++) {
                const tile = this.topology.tiles()[i];
                if (tile.plate) {
                    const plate = this.plates[tile.plate];
                    const movement = plate.calculateMovement(this.topology.corners(), tile.position);
                    const plateMovementColor = new Color(1 - plate.color.r, 1 - plate.color.g, 1 - plate.color.b);
            
                    this.buildArrow(geometry, 
                        tile.position.clone().multiplyScalar(1.002), 
                        movement.clone().multiplyScalar(0.5), 
                        1,
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
        const corners = this.topology?.corners();
        if (corners) {
            const geometry = new Geometry();
        
            for(const corner of corners) {
                if (corner.air.speed) {
                    this.buildArrow(geometry, 
                        corner.position.clone().multiplyScalar(1.002), 
                        corner.air.direction, 
                        corner.air.speed,
                        Math.min(corner.air.speed, 4),
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
    
    buildOceanicCurrentsRenderObject() {
        const corners = this.topology?.corners();
        if (corners) {
            const geometry = new Geometry();
        
            for(const corner of corners) {
                const color = this.getColor(0x002561, 0xff5e00, corner.position.y > 0 ? corner.water.direction.y : corner.water.direction.y * -1);

                if (corner.water.speed) {
                    this.buildArrow(geometry, 
                        corner.position.clone().multiplyScalar(1.002), 
                        corner.water.direction, 
                        corner.water.speed,
                        Math.min(corner.water.speed, 4),
                        color
                    );
                }
            }
    
            geometry.computeBoundingSphere();
            const material = new MeshBasicMaterial({
                vertexColors: true,
            });
            const renderObject = new Mesh(geometry, material);
    
            const oceanicCurrents: RenderAirCurrents = {
                geometry: geometry,
                material: material,
                renderObject: renderObject,
            };
            
            return oceanicCurrents;
        }

        return undefined;
    }
    
    private buildArrow(geometry: Geometry, position: Vector3, direction: Vector3, strength: number, width: number, color: Color = new Color(0xffffff)) {
        if (direction.lengthSq() > 0) {
            const baseIndex = geometry.vertices.length;

            const normal = position.clone().multiplyScalar(-1).normalize();
            const offsetX = direction.clone().cross(normal).setLength(width / 2);
            const offsetY = direction.clone().multiplyScalar(strength).multiplyScalar(.5);

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
    
    private buildTileWedgeColors(f: Color[][], c: Color, bc: Color, index?: number) {
        if (index === undefined) {
            f.push([c, c, c]);
            f.push([bc, bc, c]);
            f.push([bc, c, c]);
        } else {
            f[index] = [c, c, c];
            f[index + 1] = [bc, bc, c];
            f[index + 2] = [bc, c, c];
        }
    }
    
    // private generatePlanetStatistics() {
    //     const topology = this.topology;
    //     const plates = this.plates;
        
    //     if (topology && plates) {
    //         const statistics: Statistics = {};
        
    //         const updateMinMaxAvg = (stats: StatisticsItem, value: number) => {
    //             stats.min = Math.min(stats.min, value);
    //             stats.max = Math.max(stats.max, value);
    //             stats.avg += value;
    //         };
        
    //         statistics.corners = {
    //             count: topology.corners().length,
    //             airCurrent: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             elevation: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             temperature: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             moisture: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             distanceToPlateBoundary: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             distanceToPlateRoot: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             pressure: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             shear: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             doublePlateBoundaryCount: 0,
    //             triplePlateBoundaryCount: 0,
    //             innerLandBoundaryCount: 0,
    //             outerLandBoundaryCount: 0,
    //         };
        
    //         for (let i = 0; i < topology.corners().length; i++) {
    //             const corner = topology.corners[i];
    //             if (corner.airCurrent) {
    //                 updateMinMaxAvg(statistics.corners.airCurrent, corner.airCurrent.length());
    //             }
    //             updateMinMaxAvg(statistics.corners.elevation, corner.elevation);
    //             updateMinMaxAvg(statistics.corners.temperature, corner.temperature);
    //             updateMinMaxAvg(statistics.corners.moisture, corner.moisture);
    //             if (corner.distanceToPlateBoundary) {
    //                 updateMinMaxAvg(statistics.corners.distanceToPlateBoundary, corner.distanceToPlateBoundary);
    //             }
    //             if (corner.distanceToPlateRoot) {
    //                 updateMinMaxAvg(statistics.corners.distanceToPlateRoot, corner.distanceToPlateRoot);
    //             }
    //             if (corner.betweenPlates) {
    //                 updateMinMaxAvg(statistics.corners.pressure, corner.pressure);
    //                 updateMinMaxAvg(statistics.corners.shear, corner.shear);
    //                 if (!topology.borders[corner.borders[0]].betweenPlates || !topology.borders[corner.borders[1]].betweenPlates || !topology.borders[corner.borders[2]].betweenPlates) {
    //                     statistics.corners.doublePlateBoundaryCount += 1;
    //                 } else {
    //                     statistics.corners.triplePlateBoundaryCount += 1;
    //                 }
    //             }
    //             const landCount = ((topology.tiles[corner.tiles[0]].elevation > 0) ? 1 : 0) + ((topology.tiles[corner.tiles[1]].elevation > 0) ? 1 : 0) + ((topology.tiles[corner.tiles[2]].elevation > 0) ? 1 : 0);
    //             if (landCount === 2) {
    //                 statistics.corners.innerLandBoundaryCount += 1;
    //             } else if (landCount === 1) {
    //                 statistics.corners.outerLandBoundaryCount += 1;
    //             }
    //             if (corner.corners.length !== 3) throw 'Corner has as invalid number of neighboring corners.';
    //             if (corner.borders.length !== 3) throw 'Corner has as invalid number of borders.';
    //             if (corner.tiles.length !== 3) throw 'Corner has as invalid number of tiles.';
    //         }
        
    //         statistics.corners.airCurrent.avg /= statistics.corners.count;
    //         statistics.corners.elevation.avg /= statistics.corners.count;
    //         statistics.corners.temperature.avg /= statistics.corners.count;
    //         statistics.corners.moisture.avg /= statistics.corners.count;
    //         statistics.corners.distanceToPlateBoundary.avg /= statistics.corners.count;
    //         statistics.corners.distanceToPlateRoot.avg /= statistics.corners.count;
    //         statistics.corners.pressure.avg /= (statistics.corners.doublePlateBoundaryCount + statistics.corners.triplePlateBoundaryCount);
    //         statistics.corners.shear.avg /= (statistics.corners.doublePlateBoundaryCount + statistics.corners.triplePlateBoundaryCount);
        
    //         statistics.borders = {
    //             count: topology.borders().length,
    //             length: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             plateBoundaryCount: 0,
    //             plateBoundaryPercentage: 0,
    //             landBoundaryCount: 0,
    //             landBoundaryPercentage: 0,
    //         };
        
    //         for (let i = 0; i < topology.borders().length; i++) {
    //             const border = topology.borders[i];
    //             const length = border.length(topology.corners);
    //             updateMinMaxAvg(statistics.borders.length, length);
    //             if (border.betweenPlates) {
    //                 statistics.borders.plateBoundaryCount += 1;
    //                 statistics.borders.plateBoundaryPercentage += length;
    //             }
    //             if (border.isLandBoundary(topology.tiles)) {
    //                 statistics.borders.landBoundaryCount += 1;
    //                 statistics.borders.landBoundaryPercentage += length;
    //             }
    //             if (border.corners.length !== 2) throw 'Border has as invalid number of corners.';
    //             if (border.borders.length !== 4) throw 'Border has as invalid number of neighboring borders.';
    //             if (border.tiles.length !== 2) throw 'Border has as invalid number of tiles.';
    //         }
        
    //         statistics.borders.plateBoundaryPercentage /= statistics.borders.length.avg;
    //         statistics.borders.landBoundaryPercentage /= statistics.borders.length.avg;
    //         statistics.borders.length.avg /= statistics.borders.count;
        
    //         statistics.tiles = {
    //             count: topology.tiles().length,
    //             totalArea: 0,
    //             area: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             elevation: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             temperature: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             moisture: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             plateMovement: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             biomeCounts: {},
    //             biomeAreas: {},
    //             pentagonCount: 0,
    //             hexagonCount: 0,
    //             heptagonCount: 0,
    //         };
        
    //         for (let i = 0; i < topology.tiles().length; i++) {
    //             const tile = topology.tiles[i];
    //             updateMinMaxAvg(statistics.tiles.area, tile.area);
    //             updateMinMaxAvg(statistics.tiles.elevation, tile.elevation);
    //             updateMinMaxAvg(statistics.tiles.temperature, tile.temperature);
    //             updateMinMaxAvg(statistics.tiles.moisture, tile.moisture);
    //             if (tile.plateMovement) {
    //                 updateMinMaxAvg(statistics.tiles.plateMovement, tile.plateMovement.length());
    //             }
    //             if (tile.biome) {
    //                 if (!statistics.tiles.biomeCounts[tile.biome]) statistics.tiles.biomeCounts[tile.biome] = 0;
    //                 statistics.tiles.biomeCounts[tile.biome] += 1;
    //                 if (!statistics.tiles.biomeAreas[tile.biome]) statistics.tiles.biomeAreas[tile.biome] = 0;
    //                 statistics.tiles.biomeAreas[tile.biome] += tile.area;
    //             }
    //             if (tile.tiles.length === 5) statistics.tiles.pentagonCount += 1;
    //             else if (tile.tiles.length === 6) statistics.tiles.hexagonCount += 1;
    //             else if (tile.tiles.length === 7) statistics.tiles.heptagonCount += 1;
    //             else throw 'Tile has an invalid number of neighboring tiles.';
    //             if (tile.tiles.length !== tile.borders.length) throw 'Tile has a neighbor and border count that do not match.';
    //             if (tile.tiles.length !== tile.corners.length) throw 'Tile has a neighbor and corner count that do not match.';
    //         }
        
    //         statistics.tiles.totalArea = statistics.tiles.area.avg;
    //         statistics.tiles.area.avg /= statistics.tiles.count;
    //         statistics.tiles.elevation.avg /= statistics.tiles.count;
    //         statistics.tiles.temperature.avg /= statistics.tiles.count;
    //         statistics.tiles.moisture.avg /= statistics.tiles.count;
    //         statistics.tiles.plateMovement.avg /= statistics.tiles.count;
        
    //         statistics.plates = {
    //             count: plates.length,
    //             tileCount: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             area: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             boundaryElevation: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             boundaryBorders: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //             circumference: {
    //                 min: Number.POSITIVE_INFINITY,
    //                 max: Number.NEGATIVE_INFINITY,
    //                 avg: 0
    //             },
    //         };
        
    //         for (let i = 0; i < plates.length; i++) {
    //             const plate = plates[i];
    //             updateMinMaxAvg(statistics.plates.tileCount, plate.tiles.length);
    //             plate.area = 0;
    //             for (let j = 0; j < plate.tiles.length; j++) {
    //                 const tile = topology.tiles[plate.tiles[j]];
    //                 plate.area += tile.area;
    //             }
    //             updateMinMaxAvg(statistics.plates.area, plate.area);
    //             let elevation = 0;
    //             for (let j = 0; j < plate.boundaryCorners.length; j++) {
    //                 const corner = topology.corners[plate.boundaryCorners[j]];
    //                 elevation += corner.elevation;
    //             }
    //             updateMinMaxAvg(statistics.plates.boundaryElevation, elevation / plate.boundaryCorners.length);
    //             updateMinMaxAvg(statistics.plates.boundaryBorders, plate.boundaryBorders.length);
    //             plate.circumference = 0;
    //             for (let j = 0; j < plate.boundaryBorders.length; j++) {
    //                 const border = topology.borders[plate.boundaryBorders[j]];
    //                 plate.circumference += border.length(topology.corners);
    //             }
    //             updateMinMaxAvg(statistics.plates.circumference, plate.circumference);
    //         }
        
    //         statistics.plates.tileCount.avg /= statistics.plates.count;
    //         statistics.plates.area.avg /= statistics.plates.count;
    //         statistics.plates.boundaryElevation.avg /= statistics.plates.count;
    //         statistics.plates.boundaryBorders.avg /= statistics.plates.count;
    //         statistics.plates.circumference.avg /= statistics.plates.count;
        
    //         return statistics;
    //     }

    //     return undefined;
    // }
    
    serialize(prefix: string, suffix: string) {
        const stringPieces = [];
    
        if (this._mesh) {
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
        }
    
        return stringPieces.join('');
    }
}

export default Planet;
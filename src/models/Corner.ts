import { Vector3 } from 'three';
import Border from './Border';
import Tile from './Tile';

class Corner {
    id: number;
    position: Vector3;
    corners: Corner[];
    borders: Border[];
    tiles: Tile[];
    distanceToPlateRoot?: number;
    distanceToPlateBoundary?: number;
    betweenPlates: boolean;
    elevation: number;
    pressure: number;
    temperature: number;
    area: number;
    shear: number;
    airHeat: number;
    moisture: number;
    newAirHeat: number;
    heat: number;
    maxHeat: number;
    heatAbsorption: number;
    airCurrent?: Vector3;
    airCurrentSpeed: number;
    airCurrentOutflows?: number[];
    airMoisture?: number;
    newAirMoisture?: number;
    precipitation?: number;
    precipitationRate?: number;
    maxPrecipitation?: number;
    
    constructor(id: number, position: Vector3, cornerCount: number, borderCount: number, tileCount: number) {
        this.id = id;
        this.position = position;
        this.corners = new Array(cornerCount);
        this.borders = new Array(borderCount);
        this.tiles = new Array(tileCount);
        this.betweenPlates = false;
        this.pressure = 0;
        this.temperature = 0;
        this.elevation = 0;
        this.area = 0;
        this.shear = 0;
        this.airHeat = 0;
        this.moisture = 0;
        this.newAirHeat = 0;
        this.heat = 0;
        this.maxHeat = 0;
        this.heatAbsorption = 0;
        this.airCurrentSpeed = 0;
    }

    vectorTo(corner: Corner) {
        return corner.position.clone().sub(this.position);
    }

    toString() {
        return `Corner ${this.id.toFixed(0)} < ${this.position.x.toFixed(0)}, ${this.position.y.toFixed(0)}, ${this.position.z.toFixed(0)} >`;
    }
}

export default Corner;
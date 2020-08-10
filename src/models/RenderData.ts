import { Geometry, Color, Mesh, MeshLambertMaterial, MeshBasicMaterial } from 'three';

export interface RenderData {
    surface?: RenderSurface;
    plateBoundaries?: RenderPlateBoundaries;
    plateMovements?: RenderPlateMovement;
    airCurrents?: RenderAirCurrents;
}

export interface RenderSurface {
    geometry: Geometry;
    terrainColors: Color[][];
    plateColors: Color[][];
    elevationColors: Color[][];
    temperatureColors: Color[][];
    moistureColors: Color[][];
    material: MeshLambertMaterial;
    renderObject: Mesh;
}

export interface RenderPlateBoundaries {
    renderObject: Mesh;
    geometry: Geometry;
    material: MeshBasicMaterial;
}

export interface RenderPlateMovement {
    renderObject: Mesh;
    geometry: Geometry;
    material: MeshBasicMaterial;
}

export interface RenderAirCurrents {
    renderObject: Mesh;
    geometry: Geometry;
    material: MeshBasicMaterial;
}

export default RenderData;
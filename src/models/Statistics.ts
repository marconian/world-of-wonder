export interface Statistics {
    corners?: CornerInfo;
    borders?: BorderInfo;
    tiles?: TileInfo,
    plates?: PlateInfo
}

export interface StatisticsItem {
    min: number;
    max: number;
    avg: number;
}

export interface CornerInfo {
    count: number;
    airCurrent: StatisticsItem;
    elevation: StatisticsItem;
    temperature: StatisticsItem;
    moisture: StatisticsItem;
    distanceToPlateBoundary: StatisticsItem;
    distanceToPlateRoot: StatisticsItem;
    pressure: StatisticsItem;
    shear: StatisticsItem;
    doublePlateBoundaryCount: number;
    triplePlateBoundaryCount: number;
    innerLandBoundaryCount: number;
    outerLandBoundaryCount: number;
}

export interface BorderInfo {
    count: number;
    length: StatisticsItem;
    plateBoundaryCount: number;
    plateBoundaryPercentage: number;
    landBoundaryCount: number;
    landBoundaryPercentage: number;
}

export interface TileInfo {
    count: number;
    totalArea: number;
    area: StatisticsItem;
    elevation: StatisticsItem;
    temperature: StatisticsItem;
    moisture: StatisticsItem;
    plateMovement: StatisticsItem;
    biomeCounts: Record<string, number>;
    biomeAreas: Record<string, number>;
    pentagonCount: number;
    hexagonCount: number;
    heptagonCount: number;
}

export interface PlateInfo {
    count: number;
    tileCount: StatisticsItem;
    area: StatisticsItem;
    boundaryElevation: StatisticsItem;
    boundaryBorders: StatisticsItem;
    circumference: StatisticsItem;
}

export default Statistics;
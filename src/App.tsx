/* eslint-disable jsx-a11y/anchor-is-valid */
/* eslint-disable no-throw-literal */
import React, { Component } from 'react';
import { Scene, PerspectiveCamera, Mesh, WebGLRenderer, AmbientLight, DirectionalLight, Vector3, Color, Geometry, Face3, MeshLambertMaterial, Matrix4, Euler, Raycaster, Vector2 } from 'three';
import { Planet, PlanetMode } from './models/Planet';
import './App.scss';
import Tile from './models/Tile';
import { adjustRange, hashString } from './utils';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWind, faPlanetMoon, faWalking, faSunCloud, faSpinnerThird, faRaindrops, faMountains, faThermometerHalf, faVectorSquare, faSeedling } from '@fortawesome/pro-light-svg-icons';
import { MeshDescription } from './models/MeshDescription';
import { MeshWorker } from './workers/MeshWorker';
import { wrap, releaseProxy } from 'comlink';

interface AppState {
    planet?: Planet;
    subdivisions: number;
    distortionLevel: number;
    plateCount: number;
    oceanicRate: number;
    heatLevel: number;
    moistureLevel: number;
    seed?: number | string;
    surfaceRenderMode: PlanetMode;
    renderSunlight: boolean;
    renderPlateBoundaries: boolean;
    renderPlateMovements: boolean;
    renderAirCurrents: boolean;
    selection?: TileSelection
    loading: boolean;
}

interface TileSelection {
    tile: Tile;
    renderObject: Mesh;
}

const KEY: Record<string, number> = {};
for (let k = 0; k < 10; k++) KEY[String.fromCharCode(k + 48)] = k + 48;
for (let k = 0; k < 26; k++) KEY[String.fromCharCode(k + 65)] = k + 65;

// const KEY_ENTER = 13;
// const KEY_SHIFT = 16;
// const KEY_ESCAPE = 27;
const KEY_SPACE = 32;
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
    appNode?: HTMLDivElement | null;
    sceneNode?: HTMLCanvasElement | null;
    renderer?: WebGLRenderer
    scene: Scene;
    camera: PerspectiveCamera;
    directionalLight: DirectionalLight;
    
    meshes: Record<number, MeshDescription>;
    
    zoom = 1.0;
    zoomAnimationStartTime?: number;
    zoomAnimationDuration?: number;
    zoomAnimationStartValue?: number;
    zoomAnimationEndValue?: number;
    lastRenderFrameTime?: number;
    cameraLatitude = 0;
    cameraLongitude = 0;
    sunTimeOffset = 0;
    pressedKeys: Record<string, boolean> = {};
    disableKeys = false;

    get planet() { return this.state.planet; }

    constructor(props: {}) {
        super(props);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 10000);
        (window as any).camera = this.camera;

        this.directionalLight = new DirectionalLight(0xFFFFFF);
        this.directionalLight.position.set(-3, 3, 7).normalize();

        this.meshes = {};

        this.state = {
            subdivisions: 30,
            distortionLevel: 1,
            plateCount: 20,
            oceanicRate: .7,
            heatLevel: 1,
            moistureLevel: .3,
            surfaceRenderMode: 'terrain',
            renderAirCurrents: false,
            renderPlateBoundaries: false,
            renderPlateMovements: false,
            renderSunlight: true,
            loading: false
        };

        this.keyUpHandler = this.keyUpHandler.bind(this);
        this.keyDownHandler = this.keyDownHandler.bind(this);
        this.resizeHandler = this.resizeHandler.bind(this);
        this.clickHandler = this.clickHandler.bind(this);
    }

    componentDidMount(): void {
        //this.camera.position.z = 5;
        
        if (this.sceneNode) {
            this.renderer = new WebGLRenderer({
                canvas: this.sceneNode,
                antialias: true,
                alpha: true,
            });

            this.renderer.setClearColor(0x001224, 1.0);
        
            this.scene.add(new AmbientLight(0xFFFFFF));
            this.scene.add(this.directionalLight);

            this.animate();

            this.resetCamera();
            this.updateCamera();

            this.generatePlanetAsync();
            // this.generatePlanetAsync().then(async () =>
            //     await this.generateMeshes());
        }
            
        window.addEventListener('keyup', this.keyUpHandler, false);
        window.addEventListener('keydown', this.keyDownHandler, false);
        window.addEventListener('resize', this.resizeHandler, false);
    }

    componentDidUpdate(prevProps: Readonly<{}>, prevState: Readonly<AppState>): void {
        if (this.state.surfaceRenderMode !== prevState.surfaceRenderMode) {
            this.planet?.setSurface(this.state.surfaceRenderMode);
        }
        if (this.state.renderAirCurrents !== prevState.renderAirCurrents) {
            this.planet?.toggleAirCurrents(this.state.renderAirCurrents);
        }
        if (this.state.renderPlateBoundaries !== prevState.renderPlateBoundaries) {
            this.planet?.togglePlateBoundaries(this.state.renderPlateBoundaries);
        }
        if (this.state.renderPlateMovements !== prevState.renderPlateMovements) {
            this.planet?.togglePlateMovements(this.state.renderPlateMovements);
        }
        if (this.state.renderSunlight !== prevState.renderSunlight) {
            this.planet?.toggleSunlight(this.state.renderSunlight);
        }
        if (this.state.subdivisions !== prevState.subdivisions || 
            this.state.distortionLevel !== prevState.distortionLevel ||
            (!this.state.planet && prevState.planet)) {

            this.generatePlanetAsync();
        } else if (this.state.planet !== prevState.planet) {
            const old = this.scene.getObjectByName('planet');
            if (old) {
                this.setState({ selection: undefined });
                this.scene.remove(old);
            }

            if (prevState.planet) {
                prevState.planet.dispose();
            }

            if (this.state.planet) {
                this.displayPlanet();
            }
        }
        if (this.state.selection !== prevState.selection) {
            if (prevState.selection) {
                this.planet?.renderData?.surface?.renderObject.remove(prevState.selection.renderObject);
            }
            if (this.state.selection) {
                this.planet?.renderData?.surface?.renderObject.add(this.state.selection.renderObject);
            }
        }
    }

    componentWillUnmount(): void {
        window.removeEventListener('keyup', this.keyUpHandler, false);
        window.removeEventListener('keydown', this.keyDownHandler, false);
        window.removeEventListener('resize', this.resizeHandler, false);

        this.renderer?.dispose();
        this.renderer = undefined;

        this.scene.remove(...this.scene.children);
        
        this.resetCamera();

    }

    render(): JSX.Element {
        const selection = this.state.selection?.tile;

        return (
            <div className="app" ref={(node) => this.appNode = node}>
                <canvas className="scene" width={window.innerWidth} height={window.innerHeight} ref={(node) => this.sceneNode = node}
                    onClick={this.clickHandler} />
                <div className="menu">
                    <div className="d-flex flex-column">
                        <button type="button" className={`btn ${this.state.renderSunlight ? 'btn-primary' : 'btn-light'} mt-3 mx-3`}
                            onClick={() => this.setState({ renderSunlight: !this.state.renderSunlight})}>

                            <FontAwesomeIcon icon={faSunCloud} />
                        </button>
                        <button type="button" className={`btn ${this.state.renderAirCurrents ? 'btn-primary' : 'btn-light'} mt-3 mx-3`}
                            onClick={() => this.setState({ renderAirCurrents: !this.state.renderAirCurrents})}>

                            <FontAwesomeIcon icon={faWind} />
                        </button>
                        <button type="button" className={`btn ${this.state.renderPlateBoundaries ? 'btn-primary' : 'btn-light'} mt-3 mx-3`}
                            onClick={() => this.setState({ renderPlateBoundaries: !this.state.renderPlateBoundaries})}>

                            <FontAwesomeIcon icon={faPlanetMoon} />
                        </button>
                        <button type="button" className={`btn ${this.state.renderPlateMovements ? 'btn-primary' : 'btn-light'} mt-3 mx-3`}
                            onClick={() => this.setState({ renderPlateMovements: !this.state.renderPlateMovements})}>

                            <FontAwesomeIcon icon={faWalking} />
                        </button>
                        <div className="btn-group mt-3 mx-3">
                            <button type="button" className="btn btn-light text-truncate">

                                {this.state.surfaceRenderMode}
                            </button>
                            <button type="button" className="btn btn-light dropdown-toggle dropdown-toggle-split" 
                                data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">

                                <span className="sr-only">Toggle Dropdown</span>
                            </button>
                            <div className="dropdown-menu">
                                <a className="dropdown-item" onClick={() => this.setState({ surfaceRenderMode: 'terrain' })}>terrain</a>
                                <a className="dropdown-item" onClick={() => this.setState({ surfaceRenderMode: 'elevation' })}>elevation</a>
                                <a className="dropdown-item" onClick={() => this.setState({ surfaceRenderMode: 'moisture' })}>moisture</a>
                                <a className="dropdown-item" onClick={() => this.setState({ surfaceRenderMode: 'plates' })}>plates</a>
                                <a className="dropdown-item" onClick={() => this.setState({ surfaceRenderMode: 'temperature' })}>temperature</a>
                            </div>
                        </div>
                        <div className="btn-group mt-3 mx-3">
                            <button type="button" className="btn btn-light text-truncate" disabled={this.state.loading}
                                onClick={() => this.setState({ planet: undefined })}>

                                {this.state.subdivisions}
                            </button>
                            <button type="button" className="btn btn-light dropdown-toggle dropdown-toggle-split" disabled={this.state.loading}
                                data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">

                                <span className="sr-only">Toggle Dropdown</span>
                            </button>
                            <div className="dropdown-menu">
                                <a className="dropdown-item" onClick={() => this.setState({ subdivisions: 10 })}>10</a>
                                <a className="dropdown-item" onClick={() => this.setState({ subdivisions: 20 })}>20</a>
                                <a className="dropdown-item" onClick={() => this.setState({ subdivisions: 30 })}>30</a>
                                <a className="dropdown-item" onClick={() => this.setState({ subdivisions: 40 })}>40</a>
                                <a className="dropdown-item" onClick={() => this.setState({ subdivisions: 50 })}>50</a>
                                <a className="dropdown-item" onClick={() => this.setState({ subdivisions: 60 })}>60</a>
                            </div>
                        </div>
                        <div className="mt-3 mx-3 text-truncate">
                            <input type="number" className="form-control" disabled={this.state.loading} min={0} max={1} step={.1}
                                value={this.state.oceanicRate} onChange={(e) => this.setState({ oceanicRate: e.currentTarget.valueAsNumber })} />
                        </div>
                        <div className="mt-3 mx-3 text-truncate">
                            <input type="number" className="form-control" disabled={this.state.loading} min={0} max={1} step={.1}
                                value={this.state.moistureLevel} onChange={(e) => this.setState({ moistureLevel: e.currentTarget.valueAsNumber })} />
                        </div>
                        <div className="mt-3 mx-3 text-truncate">
                            <input type="number" className="form-control" disabled={this.state.loading} min={0} max={1} step={.1}
                                value={this.state.heatLevel} onChange={(e) => this.setState({ heatLevel: e.currentTarget.valueAsNumber })} />
                        </div>
                        <button type="button" className="btn btn-light mt-3 mx-3 text-truncate" disabled={this.state.loading}
                            onClick={() => this.setState({ planet: undefined })}>

                            Apply
                        </button>
                    </div>
                </div>
                {selection ? (
                    <div className="card selection-info text-light">
                        <div className="card-body">
                            <FontAwesomeIcon icon={faSeedling} /> {selection.biome} <br />
                            <FontAwesomeIcon icon={faVectorSquare} /> {selection.area.toPrecision(2)} <br />
                            <FontAwesomeIcon icon={faMountains} /> {selection.elevation.toPrecision(2)} <br />
                            <FontAwesomeIcon icon={faThermometerHalf} /> {selection.temperature.toPrecision(2)} <br />
                            <FontAwesomeIcon icon={faRaindrops} /> {selection.moisture.toPrecision(2)} <br />
                        </div>
                    </div>
                ) : undefined}
                <div className={`loader text-light ${!this.state.loading ? 'd-none' : ''}`}>
                    <FontAwesomeIcon icon={faSpinnerThird} size="lg" spin />
                </div>
            </div>
        );
    }
    
    updateCamera() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
    
        const transformation = new Matrix4()
            .makeRotationFromEuler(new Euler(this.cameraLatitude, this.cameraLongitude, 0, 'YXZ'));

        this.camera.position.set(0, -50, 3050);
        this.camera.position.lerp(new Vector3(0, 0, 2000), Math.pow(this.zoom, 2.0));
        this.camera.position.applyMatrix4(transformation);

        this.camera.up.set(0, 1, 0);
        this.camera.up.applyMatrix4(transformation);

        this.camera.lookAt(new Vector3(0, 0, 1)
            .applyMatrix4(transformation));

        this.camera.updateProjectionMatrix();
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

    async getMesh(subdivisions: number) {
        if (!Object.keys(this.meshes).includes(subdivisions.toString())) {
            const meshWorker = new Worker('./workers/MeshWorker', { type: 'module' });
            const meshTools = wrap<MeshWorker>(meshWorker);

            const seed: number = Date.now();
            await meshTools.init(seed);
            
            let distortionRate: number;
            if (this.state.distortionLevel < 0.25) {
                distortionRate = adjustRange(this.state.distortionLevel, 0.00, 0.25, 0.000, 0.040);
            } else if (this.state.distortionLevel < 0.50) {
                distortionRate = adjustRange(this.state.distortionLevel, 0.25, 0.50, 0.040, 0.050);
            } else if (this.state.distortionLevel < 0.75) {
                distortionRate = adjustRange(this.state.distortionLevel, 0.50, 0.75, 0.050, 0.075);
            } else {
                distortionRate = adjustRange(this.state.distortionLevel, 0.75, 1.00, 0.075, 0.150);
            }

            this.meshes[subdivisions] = await meshTools.build(subdivisions, distortionRate);
            await MeshDescription.revive(this.meshes[subdivisions]);
    
            meshTools[releaseProxy]();
            meshWorker.terminate();
        }

        return this.meshes[subdivisions];
    }

    async generateMeshes() {
        this.setState({ loading: true });

        const tasks: Promise<MeshDescription>[] = [];
        for (let s = 10; s <= 60; s += 10) {
            tasks.push(this.getMesh(s));
        }

        await Promise.all(tasks);
        
        this.setState({ loading: false });
    }

    async generatePlanetAsync() {
        this.setState({ loading: true });
    
        let seed: number = Date.now();
        if (this.state.seed) {
            if (typeof this.state.seed === 'number') {
                seed = this.state.seed;
            } else if (typeof this.state.seed === 'string') {
                seed = hashString(this.state.seed);
            }
        }

        const mesh = await this.getMesh(this.state.subdivisions);

        const planet = new Planet(seed, mesh);
        await planet.build(
            this.state.plateCount, 
            this.state.oceanicRate, 
            this.state.heatLevel, 
            this.state.moistureLevel
        );

        this.setState({
            planet: planet,
            loading: false
        });
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
    
    selectTile(tile?: Tile) {
        const topology = this.state.planet?.topology;
        if (topology && tile?.averagePosition) {
            console.log(tile);
    
            const outerColor = new Color(0x000000);
            const innerColor = new Color(0xFFFFFF);
        
            const geometry = new Geometry();
        
            geometry.vertices.push(tile.averagePosition);
            for (let i = 0; i < tile.corners.length; i++) {
                geometry.vertices.push(topology.corners[tile.corners[i]].position);
                geometry.faces.push(new Face3(i + 1, (i + 1) % tile.corners.length + 1, 0, tile.normal, [outerColor, outerColor, innerColor]));
            }
        
            geometry.computeBoundingSphere();
        
            const material = new MeshLambertMaterial({
                vertexColors: true
            });
            material.transparent = true;
            material.opacity = 0.5;
            material.polygonOffset = true;
            material.polygonOffsetFactor = -2;
            material.polygonOffsetUnits = -2;

            const renderObject = new Mesh(geometry, material);

            this.setState({ selection: {
                tile: tile,
                renderObject: renderObject
            }});
        } else {
            this.setState({ selection: undefined });
        }
    }
    
    clickHandler(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        const tiles = this.planet?.topology?.tiles;
        if (this.renderer && tiles) {
            const mouse = new Vector2(
                (event.clientX / window.innerWidth) * 2 - 1,
                -(event.clientY / window.innerHeight) * 2 + 1
            );

            const raycaster = new Raycaster();
            raycaster.setFromCamera(mouse, this.camera);

            const intersects = raycaster.intersectObjects(this.scene.children
                .filter(v => v instanceof Mesh));

            for (const intersect of intersects) {
                if (intersect.face && intersect.object instanceof Mesh) {
                    const obj: Mesh<Geometry, MeshLambertMaterial> = intersect.object;

                    const vertices = [
                        obj.geometry.vertices[intersect.face.a],
                        obj.geometry.vertices[intersect.face.b],
                        obj.geometry.vertices[intersect.face.c]
                    ];
                    
                    if (this.planet?.topology?.tiles) {
                        const tiles = this.planet.topology.tiles.filter(t => {
                            const p = t.averagePosition;
                            return p && vertices.filter(v => v.equals(p)).length > 0;
                        });

                        if (tiles.length > 0) {
                            this.selectTile(tiles[0]);
                        }
                    }
                }
            }
        }
    }
    
    keyDownHandler(event: KeyboardEvent) {
        if (this.disableKeys === true) return;
    
        switch (event.keyCode) {
        case KEY.W:
        case KEY.A:
        case KEY.S:
        case KEY.D:
        case KEY.Z:
        case KEY.Q:
        case KEY_LEFTARROW:
        case KEY_RIGHTARROW:
        case KEY_UPARROW:
        case KEY_DOWNARROW:
        case KEY_PAGEUP:
        case KEY_PAGEDOWN:
        case KEY_NUMPAD_PLUS:
        case KEY_NUMPAD_MINUS:
            this.pressedKeys[event.keyCode] = true;
            event.preventDefault();
            break;
        }
    }
    
    keyUpHandler(event: KeyboardEvent) {
        if (this.disableKeys) return;
    
        switch (event.keyCode) {
        case KEY.W:
        case KEY.A:
        case KEY.S:
        case KEY.D:
        case KEY.Z:
        case KEY.Q:
        case KEY_LEFTARROW:
        case KEY_RIGHTARROW:
        case KEY_UPARROW:
        case KEY_DOWNARROW:
        case KEY_PAGEUP:
        case KEY_PAGEDOWN:
        case KEY_NUMPAD_PLUS:
        case KEY_NUMPAD_MINUS:
            this.pressedKeys[event.keyCode] = false;
            event.preventDefault();
            break;
        case KEY_SPACE:
            this.generatePlanetAsync();
            event.preventDefault();
            break;
        case KEY['1']:
            this.setState({ subdivisions: 20 });
            event.preventDefault();
            break;
        case KEY['2']:
            this.setState({ subdivisions: 40 });
            event.preventDefault();
            break;
        case KEY['3']:
            this.setState({ subdivisions: 60 });
            event.preventDefault();
            break;
        case KEY['5']:
            this.setState({ surfaceRenderMode: 'terrain' });
            event.preventDefault();
            break;
        case KEY['6']:
            this.setState({ surfaceRenderMode: 'plates' });
            event.preventDefault();
            break;
        case KEY['7']:
            this.setState({ surfaceRenderMode: 'elevation' });
            event.preventDefault();
            break;
        case KEY['8']:
            this.setState({ surfaceRenderMode: 'temperature' });
            event.preventDefault();
            break;
        case KEY['9']:
            this.setState({ surfaceRenderMode: 'moisture' });
            event.preventDefault();
            break;
        case KEY.U:
            this.setState({ renderSunlight: !this.state.renderSunlight });
            event.preventDefault();
            break;
        case KEY.I:
            this.setState({ renderPlateBoundaries: !this.state.renderPlateBoundaries });
            event.preventDefault();
            break;
        case KEY.O:
            this.setState({ renderPlateMovements: !this.state.renderPlateMovements });
            event.preventDefault();
            break;
        case KEY.P:
            this.setState({ renderAirCurrents: !this.state.renderAirCurrents });
            event.preventDefault();
            break;
        }
    }
    
    displayPlanet() {
        if (this.planet) {
            this.sunTimeOffset = Math.PI * 2 * (1 / 12 - Date.now() / 60000);
        
            if (this.planet.renderData?.surface) {
                this.scene.add(this.planet.renderData.surface.renderObject);
            }
        
            this.planet?.setSurface(this.state.surfaceRenderMode);
            this.planet?.toggleAirCurrents(this.state.renderAirCurrents);
            this.planet?.togglePlateBoundaries(this.state.renderPlateBoundaries);
            this.planet?.togglePlateMovements(this.state.renderPlateMovements);
            this.planet?.toggleSunlight(this.state.renderSunlight);
        
            this.updateCamera();
        
            console.log('Raw Seed', this.planet.seed);
            console.log('Planet Radius', this.planet.radius);
            console.log('Statistics', this.planet.statistics || '-');
        } else {
            console.log('No planet to render...');
        }
    }
}

export default App;

import { Scene, PerspectiveCamera, Vector2, OctahedronBufferGeometry, RawShaderMaterial, AdditiveBlending, WebGLRenderer, Clock, Vector3, IUniform, Points } from 'three';
import { PhysicsRenderer } from '../../utils/PhysicsRenderer';
import React, { Component } from 'react';
import fsPhysicsRendererAcceleration from '../../shaders/fsPhysicsRendererAcceleration.glsl';
import fsPhysicsRendererVelocity from '../../shaders/fsPhysicsRendererVelocity.glsl';
//import fsPhysicsRendererVelocityInit from '../../shaders/fsPhysicsRendererVelocityInit.glsl';
import fsPoints from '../../shaders/fsPoints.glsl';
import vsPhysicsRenderer from '../../shaders/vsPhysicsRenderer.glsl';
import vsPoints from '../../shaders/vsPoints.glsl';

interface PointsComponentProps {
    width: number;
    height: number;
}

export class PointsComponent extends Component<PointsComponentProps>  {
    renderer?: WebGLRenderer;
    uniforms: Record<string, IUniform>;
    physicsRenderer?: PhysicsRenderer;
    vectorTouchMove: Vector2;
    vectorTouchMoveDiff: Vector2;
    obj?: Points;
    canvas?: HTMLCanvasElement;
    scene: Scene;
    camera: PerspectiveCamera;
    clock: Clock;
    vectorTouchStart: Vector2;
    vectorTouchEnd: Vector2;
    isDrag: boolean;

    constructor(props: PointsComponentProps) {
        super(props);

        this.uniforms = {
            time: {
                //type: 'f',
                value: 0
            },
            velocity: {
                //type: 't',
                value: null
            },
            acceleration: {
                //type: 't',
                value: null
            }
        };
        this.vectorTouchMove = new Vector2(0, 0);
        this.vectorTouchMoveDiff = new Vector2(0, 0);
        this.vectorTouchStart = new Vector2(0, 0);
        this.vectorTouchEnd = new Vector2(0, 0);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(45, this.props.width / this.props.height, 1, 10000);
        this.clock = new Clock();
        
        this.vectorTouchStart = new Vector2();
        this.vectorTouchMove = new Vector2();
        this.vectorTouchEnd = new Vector2();
        this.isDrag = false;
    }

    componentDidMount() {
        if (this.canvas) {
            this.renderer = new WebGLRenderer({
                antialias: false,
                canvas: this.canvas,
            });
            
            this.obj = this.createObj(this.renderer);

            //this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setClearColor(0x111111, 1.0);
            this.camera.position.set(0, 0, 1000);
            this.camera.aspect = this.props.width / this.props.height;
            this.camera.lookAt(new Vector3());
            this.scene.add(this.obj);
        
            this.on();
            this.onResizeWindow();

            this.animate();
        }
    }

    render() {
        return <canvas className="p-canvas-webgl" width={this.props.width} height={this.props.height} ref={(node) => this.canvas = node || undefined} />;
    }

    createObj(renderer: WebGLRenderer) {
        const detail = (window.innerWidth > 768) ? 7 : 6;
        const geometry = new OctahedronBufferGeometry(400, detail);
        const verticesBase = geometry.attributes.position.array;
        const vertices = [];
        for (let i = 0; i < verticesBase.length; i += 3) {
            vertices[i + 0] = verticesBase[i + 0] + (Math.random() * 2 - 1) * 400;
            vertices[i + 1] = verticesBase[i + 1] + (Math.random() * 2 - 1) * 400;
            vertices[i + 2] = verticesBase[i + 2] + (Math.random() * 2 - 1) * 400;
        }
        this.physicsRenderer = new PhysicsRenderer(
            vsPhysicsRenderer,
            fsPhysicsRendererAcceleration,
            vsPhysicsRenderer,
            fsPhysicsRendererVelocity,
        );
        this.physicsRenderer.init(renderer, vertices);
        this.physicsRenderer.mergeAUniforms({
            vTouchMove: {
                //type: 'v2',
                value: this.vectorTouchMoveDiff
            }
        });
        this.uniforms.velocity.value = this.physicsRenderer.getCurrentVelocity();
        this.uniforms.acceleration.value = this.physicsRenderer.getCurrentAcceleration();
        geometry.addAttribute('uvVelocity', this.physicsRenderer.getBufferAttributeUv());
        return new Points(
            geometry,
            new RawShaderMaterial({
                uniforms: this.uniforms,
                vertexShader: vsPoints,
                fragmentShader: fsPoints,
                transparent: true,
                depthWrite: false,
                blending: AdditiveBlending,
            })
        );
    }
    
    touchStart(v: Vector2) {
        this.vectorTouchMove.copy(v);
    }
    touchMove(v: Vector2) {
        this.vectorTouchMoveDiff.set(
            v.x - this.vectorTouchMove.x,
            v.y - this.vectorTouchMove.y
        );
        this.vectorTouchMove.copy(v);
    }
    touchEnd() {
        this.vectorTouchMove.set(0, 0);
        this.vectorTouchMoveDiff.set(0, 0);
    }
    
    onResizeWindow() {
        // this.canvas.width = window.innerWidth;
        // this.canvas.height = window.innerHeight;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        //this.renderer?.setSize(window.innerWidth, window.innerHeight);
    }
    animate() {
        if (this.renderer) {
            const time = this.clock.getDelta();
    
            this.physicsRenderer?.render(this.renderer, time);
            this.uniforms.time.value += time;
    
            this.renderer.render(this.scene, this.camera);
    
            requestAnimationFrame(() => this.animate());
        }
    }
    onTouchStart() {
        this.isDrag = true;
        this.touchStart(this.vectorTouchStart);
    }
    onTouchMove() {
        if (this.isDrag) this.touchMove(this.vectorTouchMove);
    }
    onTouchEnd() {
        this.isDrag = false;
        this.touchEnd();
    }
    onMouseOut() {
        this.isDrag = false;
        this.touchEnd();
    }
    on() {
        window.addEventListener('resize', debounce(() => {
            this.onResizeWindow();
        }, 1000));
        this.canvas?.addEventListener('mousedown', (event) => {
            event.preventDefault();
            this.vectorTouchStart.set(event.clientX, event.clientY);
            normalizeVector2(this.vectorTouchStart);
            this.onTouchStart();
        });
        this.canvas?.addEventListener('mousemove', (event) => {
            event.preventDefault();
            this.vectorTouchMove.set(event.clientX, event.clientY);
            normalizeVector2(this.vectorTouchMove);
            this.onTouchMove();
        });
        this.canvas?.addEventListener('mouseup', (event) => {
            event.preventDefault();
            this.vectorTouchEnd.set(event.clientX, event.clientY);
            normalizeVector2(this.vectorTouchEnd);
            this.onTouchEnd();
        });
        this.canvas?.addEventListener('touchstart', (event) => {
            event.preventDefault();
            this.vectorTouchStart.set(event.touches[0].clientX, event.touches[0].clientY);
            normalizeVector2(this.vectorTouchStart);
            this.onTouchStart();
        });
        this.canvas?.addEventListener('touchmove', (event) => {
            event.preventDefault();
            this.vectorTouchMove.set(event.touches[0].clientX, event.touches[0].clientY);
            normalizeVector2(this.vectorTouchMove);
            this.onTouchMove();
        });
        this.canvas?.addEventListener('touchend', (event) => {
            event.preventDefault();
            normalizeVector2(this.vectorTouchEnd);
            this.vectorTouchEnd.set(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
            this.onTouchEnd();
        });
        this.canvas?.addEventListener('mouseout', (event) => {
            event.preventDefault();
            this.vectorTouchEnd.set(0, 0);
            this.onMouseOut();
        });
    }
}

function normalizeVector2(vector: Vector2) {
    vector.x = (vector.x / window.innerWidth) * 2 - 1;
    vector.y = - (vector.y / window.innerHeight) * 2 + 1;
};

function debounce(callback: (event: any) => void, duration: number) {
    let timer: NodeJS.Timeout | undefined;
    return (event: any) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => callback(event), duration);
    };
}
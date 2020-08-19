import { Scene, PerspectiveCamera, WebGLRenderTarget, IUniform, Mesh, PlaneBufferGeometry, ShaderMaterial, FloatType, LinearFilter, NearestFilter, Vector2, WebGLRenderer, DataTexture, RGBFormat, Renderer, BufferAttribute } from 'three';

export class PhysicsRenderer {
    length: number;
    aScene: Scene;
    vScene: Scene;
    camera: PerspectiveCamera;
    option: any;
    acceleration: WebGLRenderTarget[];
    velocity: WebGLRenderTarget[];
    aUniforms: Record<string, IUniform>;
    vUniforms: Record<string, IUniform>;
    accelerationMesh: Mesh<PlaneBufferGeometry, ShaderMaterial>;
    velocityMesh: Mesh<PlaneBufferGeometry, ShaderMaterial>;
    uvs: number[];
    targetIndex: number;

    constructor(aVertexShader: string, aFragmentShader: string, vVertexShader: string, vFragmentShader: string) {
        this.length = 0;
        this.aScene = new Scene();
        this.vScene = new Scene();
        this.camera = new PerspectiveCamera(45, 1, 1, 1000);
        this.option = {
            type: FloatType,
            minFilter: LinearFilter,
            magFilter: NearestFilter
        };
        this.acceleration = [
            new WebGLRenderTarget(this.length, this.length, this.option),
            new WebGLRenderTarget(this.length, this.length, this.option),
        ];
        this.velocity = [
            new WebGLRenderTarget(this.length, this.length, this.option),
            new WebGLRenderTarget(this.length, this.length, this.option),
        ];
        this.aUniforms = {
            resolution: {
                //type: 'v2',
                value: new Vector2(window.innerWidth, window.innerHeight),
            },
            velocity: {
                //type: 't',
                value: undefined,
            },
            acceleration: {
                //type: 't',
                value: undefined,
            },
            time: {
                //type: 'f',
                value: 0
            }
        };
        this.vUniforms = {
            resolution: {
                //type: 'v2',
                value: new Vector2(window.innerWidth, window.innerHeight),
            },
            velocity: {
                //type: 't',
                value: undefined,
            },
            acceleration: {
                //type: 't',
                value: undefined,
            },
            time: {
                //type: 'f',
                value: 0
            }
        };
        this.accelerationMesh = this.createMesh(
            this.aUniforms,
            aVertexShader,
            aFragmentShader
        );
        this.velocityMesh = this.createMesh(
            this.vUniforms,
            vVertexShader,
            vFragmentShader
        );
        this.uvs = [];
        this.targetIndex = 0;
    }

    init(renderer: WebGLRenderer, velocityArrayBase: (number | undefined)[]) {
        this.length = Math.ceil(Math.sqrt(velocityArrayBase.length / 3));
        const velocityArray: number[] = [];
        for (let i = 0; i < Math.pow(this.length, 2) * 3; i += 3) {
            if (velocityArrayBase[i] !== undefined) {
                velocityArray[i + 0] = velocityArrayBase[i + 0] as number;
                velocityArray[i + 1] = velocityArrayBase[i + 1] as number;
                velocityArray[i + 2] = velocityArrayBase[i + 2] as number;
                this.uvs[i / 3 * 2 + 0] = (i / 3) % this.length / (this.length - 1);
                this.uvs[i / 3 * 2 + 1] = Math.floor((i / 3) / this.length) / (this.length - 1);
            } else {
                velocityArray[i + 0] = 0;
                velocityArray[i + 1] = 0;
                velocityArray[i + 2] = 0;
            }
        }
        const velocityInitTex = new DataTexture(new Float32Array(velocityArray), this.length, this.length, RGBFormat, FloatType);
        velocityInitTex.needsUpdate = true;
        const velocityInitMesh = new Mesh(
            new PlaneBufferGeometry(2, 2),
            new ShaderMaterial({
                uniforms: {
                    velocity: {
                        //type: 't', 
                        value: velocityInitTex,
                    },
                },
                vertexShader: document.getElementById('vs-physics-renderer')?.textContent || undefined,
                fragmentShader: document.getElementById('fs-physics-renderer-velocity-init')?.textContent || undefined,
            })
        );
        for (let i = 0; i < 2; i++) {
            this.acceleration[i].setSize(this.length, this.length);
            this.velocity[i].setSize(this.length, this.length);
        }
        this.vScene.add(this.camera);
        this.vScene.add(velocityInitMesh);
        renderer.render(this.vScene, this.camera); //, this.velocity[0]);
        renderer.render(this.vScene, this.camera); //, this.velocity[1]);
        this.vScene.remove(velocityInitMesh);
        this.vScene.add(this.velocityMesh);
        this.aScene.add(this.accelerationMesh);
    }
    createMesh(uniforms: Record<string, IUniform>, vs: string, fs: string) {
        return new Mesh(
            new PlaneBufferGeometry(2, 2),
            new ShaderMaterial({
                uniforms: uniforms,
                vertexShader: vs,
                fragmentShader: fs,
            })
        );
    }
    render(renderer: Renderer, time: number) {
        const prevIndex = Math.abs(this.targetIndex - 1);
        const nextIndex = this.targetIndex;
        this.aUniforms.acceleration.value = this.acceleration[prevIndex].texture;
        this.aUniforms.velocity.value = this.velocity[nextIndex].texture;
        renderer.render(this.aScene, this.camera);//, this.acceleration[nextIndex]);
        this.vUniforms.acceleration.value = this.acceleration[nextIndex].texture;
        this.vUniforms.velocity.value = this.velocity[nextIndex].texture;
        renderer.render(this.vScene, this.camera);//, this.velocity[prevIndex]);
        this.targetIndex = prevIndex;
        this.aUniforms.time.value += time;
        this.vUniforms.time.value += time;
    }
    getBufferAttributeUv() {
        return new BufferAttribute(new Float32Array(this.uvs), 2);
    }
    getCurrentVelocity() {
        return this.velocity[Math.abs(this.targetIndex - 1)].texture;
    }
    getCurrentAcceleration() {
        return this.acceleration[Math.abs(this.targetIndex - 1)].texture;
    }
    mergeAUniforms(obj: Record<string, IUniform>) {
        this.aUniforms = Object.assign(this.aUniforms, obj);
    }
    mergeVUniforms(obj: Record<string, IUniform>) {
        this.vUniforms = Object.assign(this.vUniforms, obj);
    }
    resize(length: number) {
        this.length = length;
        this.velocity[0].setSize(length, length);
        this.velocity[1].setSize(length, length);
        this.acceleration[0].setSize(length, length);
        this.acceleration[1].setSize(length, length);
    }
}

export default PhysicsRenderer;
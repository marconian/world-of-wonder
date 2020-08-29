import { Vector3, Quaternion, Ray, Sphere } from 'three';
import XorShift128 from './XorShift128';

export function slerp(p0: Vector3, p1: Vector3, t: number) {
    const omega = Math.acos(p0.dot(p1));
    return p0.clone().multiplyScalar(Math.sin((1 - t) * omega)).add(p1.clone().multiplyScalar(Math.sin(t * omega))).divideScalar(Math.sin(omega));
}

export function randomUnitVector(random: XorShift128) {
    const theta = random.real(0, Math.PI * 2);
    const phi = Math.acos(random.realInclusive(-1, 1));
    const sinPhi = Math.sin(phi);
    return new Vector3(
        Math.cos(theta) * sinPhi,
        Math.sin(theta) * sinPhi,
        Math.cos(phi));
}

export function randomQuaternion(random: XorShift128) {
    const theta = random.real(0, Math.PI * 2);
    const phi = Math.acos(random.realInclusive(-1, 1));
    const sinPhi = Math.sin(phi);
    const gamma = random.real(0, Math.PI * 2);
    const sinGamma = Math.sin(gamma);
    return new Quaternion(
        Math.cos(theta) * sinPhi * sinGamma,
        Math.sin(theta) * sinPhi * sinGamma,
        Math.cos(phi) * sinGamma,
        Math.cos(gamma));
}

export function intersectRayWithSphere(ray: Ray, sphere: Sphere) {
    const v1 = sphere.center.clone().sub(ray.origin);
    const v2 = v1.clone().projectOnVector(ray.direction);
    const d = v1.distanceTo(v2);
    return (d <= sphere.radius);
}

export function calculateTriangleArea(p1: Vector3, p2: Vector3, p3: Vector3) {
    const points = [p1.clone(), p2.clone(), p3.clone()]
        .sort((a, b) => a.distanceTo(b));

    const b = points[0].distanceTo(points[1]);
    const c = points[2].distanceTo(points[1]);
    const angle = Math.atan2(b, c);

    const area = b * c * .5 * Math.sin(angle);

    return area;
}

export function accumulateArray<T>(array: T[], state: number, accumulator: (a: number, b: T) => number) {
    let s = state;
    for (let i = 0; i < array.length; ++i) {
        s = accumulator(s, array[i]);
    }
    return s;
}

export function adjustRange(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number) {
    return (value - oldMin) / (oldMax - oldMin) * (newMax - newMin) + newMin;
}

//Adapted from http://stackoverflow.com/a/7616484/3874364
export function hashString(s: string) {
    let hash = 0;
    const length = s.length;
    if (length === 0) return hash;
    for (let i = 0; i < length; ++i) {
        const character = s.charCodeAt(1);
        hash = ((hash << 5) - hash) + character;
        hash |= 0;
    }
    return hash;
}
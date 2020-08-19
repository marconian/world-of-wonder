// function saveToFileSystem(content) {
//     const requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;

import { Vector3, Quaternion, Ray, Sphere, Plane } from 'three';
import XorShift128 from './XorShift128';

//     requestFileSystem(window.TEMPORARY, content.length,
//         function (fs) {
//             fs.root.getFile('planetMesh.js', {
//                     create: true
//                 },
//                 function (fileEntry) {
//                     fileEntry.createWriter(
//                         function (fileWriter) {
//                             fileWriter.addEventListener('writeend',
//                                 function () {
//                                     $('body').append('<a href="' + fileEntry.toURL() + '" download="planetMesh.js" target="_blank">Mesh Data</a>');
//                                     $('body>a').focus();
//                                 }, false);

//                             fileWriter.write(new Blob([content]));
//                         },
//                         function (error) {});
//                 },
//                 function (error) {});
//         },
//         function (error) {});
// }

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

export function calculateTriangleArea(pa: Vector3, pb: Vector3, pc: Vector3) {
    const vab = new Vector3().subVectors(pb, pa);
    const vac = new Vector3().subVectors(pc, pa);
    const faceNormal = new Vector3().crossVectors(vab, vac);
    const vabNormal = new Vector3().crossVectors(faceNormal, vab).normalize();
    const plane = new Plane().setFromNormalAndCoplanarPoint(vabNormal, pa);
    const height = plane.distanceToPoint(pc);
    const width = vab.length();
    const area = width * height * 0.5;
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
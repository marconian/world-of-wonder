import * as Comlink from 'comlink';
import { MeshDescription } from '../models/MeshDescription';
import Corner from '../models/Corner';

export class PlanetWorker {
    corners(mesh: MeshDescription) {
        const corners = new Array<Corner>(mesh.faces.length);

        for (let i = 0; i < mesh.faces.length; i++) {
            const face = mesh.faces[i];
            if (face.centroid) {
                corners[i] = new Corner(i, face.centroid.clone(), face.e.length, face.e.length, face.n.length);
            }
        }

        return corners;
    }
};

Comlink.expose(PlanetWorker);
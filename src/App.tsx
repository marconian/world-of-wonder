import React, { Component } from 'react';
import * as THREE from 'three';
import './App.scss';

class App extends Component {
    sceneNode?: HTMLDivElement | null;

    componentDidMount(): void {
        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

        var geometry = new THREE.BoxGeometry();
        var material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
        var cube = new THREE.Mesh( geometry, material );
        scene.add( cube );

        camera.position.z = 5;

        var renderer = new THREE.WebGLRenderer();
        renderer.setSize( window.innerWidth, window.innerHeight );
        this.sceneNode?.appendChild( renderer.domElement );
    }

    render(): JSX.Element {
        return (
            <div className="app">
                <div className="scene" ref={(node) => this.sceneNode = node}></div>

            </div>
        );
    }
}

export default App;

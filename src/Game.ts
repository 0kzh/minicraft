import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World } from './World';
import { createUI } from './GUI';

export default class Game {
	private renderer!: THREE.WebGLRenderer;
	private scene!: THREE.Scene;
	private camera!: THREE.PerspectiveCamera;

	private lightAmbient!: THREE.AmbientLight;

	private controls!: OrbitControls;
	private stats!: any;

	constructor() {
		this.initScene();
		this.initStats();
		this.initListeners();
	}

	initStats() {
		this.stats = new (Stats as any)();
		document.body.appendChild(this.stats.dom);
	}

	initScene() {
		this.scene = new THREE.Scene();

		this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight);
		this.camera.position.set(-32, 16, -32);

		this.renderer = new THREE.WebGLRenderer();
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setClearColor(0x80abfe);

		document.body.appendChild(this.renderer.domElement);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.target.set(16, 0, 16);
		this.controls.update();

		const light1 = new THREE.DirectionalLight();
		light1.position.set(1, 1, 1);
		this.scene.add(light1);

		const light2 = new THREE.DirectionalLight();
		light2.position.set(-1, 1, -0.5);
		this.scene.add(light2);

		this.lightAmbient = new THREE.AmbientLight();
		this.lightAmbient.intensity = 0.1;
		this.scene.add(this.lightAmbient);

		const world = new World();
		world.generate();
		this.scene.add(world);

		createUI(world);

		this.draw();
	}

	initListeners() {
		window.addEventListener('resize', this.onWindowResize.bind(this), false);

		window.addEventListener('keydown', (event) => {
			const { key } = event;

			switch (key) {
				case 'e':
					const win = window.open('', 'Canvas Image');

					const { domElement } = this.renderer;

					// Makse sure scene is rendered.
					this.renderer.render(this.scene, this.camera);

					const src = domElement.toDataURL();

					if (!win) return;

					win.document.write(`<img src='${src}' width='${domElement.width}' height='${domElement.height}'>`);
					break;

				default:
					break;
			}
		});
	}

	onWindowResize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	draw() {
		requestAnimationFrame(() => {
			this.draw();
		});

		if (this.controls) {
			this.controls.autoRotate = true;
			this.controls.autoRotateSpeed = 2.0;
		}

		if (this.stats) this.stats.update();

		if (this.controls) this.controls.update();

		this.renderer.render(this.scene, this.camera);
	}
}

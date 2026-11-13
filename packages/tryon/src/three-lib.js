/**
 * three-lib.js
 *
 * The only three.js entry point the try-on engine loads (via
 * three-runtime.js). Re-exporting just the classes the scenes use, by name,
 * lets the bundler tree-shake the rest of three.js; `import('three')` as a
 * namespace kept all of it.
 *
 * The scenes still write THREE.X: THREE is this module's namespace. Using a
 * class that is not listed here fails loudly (`THREE.X is not a constructor`),
 * so add it below.
 */
export {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  BufferAttribute,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

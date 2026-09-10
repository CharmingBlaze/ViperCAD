import {
  Color,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';

/** Neutral slate values used by the professional modelling canvas. */
export const VIEWPORT_ZENITH = 0x22262b;
export const VIEWPORT_HORIZON = 0x1b1d20;
export const VIEWPORT_GROUND = 0x15171a;
export const VIEWPORT_SUN = 0xc8cdd3;
export const VIEWPORT_CLEAR = VIEWPORT_HORIZON;
export const VIEWPORT_FOG = 0x1b1d20;
export const VIEWPORT_SUN_DIR = new Vector3(0.42, 0.78, 0.46).normalize();

const _viewProjInv = new Matrix4();

/**
 * Full-screen game-engine sky. Sky fills a typical 3/4 modelling shot;
 * the ground only appears in the lower third so the view reads like Unity.
 */
export class ViewportWorld extends Mesh<PlaneGeometry, ShaderMaterial> {
  constructor() {
    const material = new ShaderMaterial({
      name: 'ViewportWorld',
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      uniforms: {
        zenith: { value: new Color(VIEWPORT_ZENITH) },
        horizon: { value: new Color(VIEWPORT_HORIZON) },
        ground: { value: new Color(VIEWPORT_GROUND) },
        sunColor: { value: new Color(VIEWPORT_SUN) },
        sunDirection: { value: VIEWPORT_SUN_DIR.clone() },
        viewProjInverse: { value: new Matrix4() },
      },
      vertexShader: /* glsl */ `
        uniform mat4 viewProjInverse;
        varying vec3 vWorldFar;
        void main() {
          gl_Position = vec4(position.xy, 1.0, 1.0);
          vec4 worldFar = viewProjInverse * vec4(position.xy, 1.0, 1.0);
          vWorldFar = worldFar.xyz / max(worldFar.w, 1e-8);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 ground;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vWorldFar;
        void main() {
          vec3 dir = normalize(vWorldFar - cameraPosition);
          float h = dir.y;
          // Lift the sky into a 3/4 camera so it is not clipped to a grey strip.
          float skyT = pow(clamp(h * 0.9 + 0.38, 0.0, 1.0), 0.55);
          vec3 sky = mix(horizon, zenith, skyT);
          float groundMix = smoothstep(-0.08, -0.62, h);
          vec3 col = mix(sky, ground, groundMix);
          float haze = exp(-abs(h + 0.04) * 4.0);
          col = mix(col, horizon, haze * 0.35);

          vec3 sunDir = normalize(sunDirection);
          float mu = max(dot(dir, sunDir), 0.0);
          col += sunColor * pow(mu, 180.0) * 1.1;
          col += sunColor * pow(mu, 10.0) * 0.16;
          col += sunColor * pow(mu, 3.0) * 0.04;

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    super(new PlaneGeometry(2, 2), material);
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.matrixAutoUpdate = false;
    this.name = 'ViewportWorld';
    this.raycast = () => undefined;
  }

  sync(camera: Camera): void {
    camera.updateMatrixWorld(true);
    _viewProjInv.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this.material.uniforms.viewProjInverse.value.copy(_viewProjInv);
  }
}

export function createViewportWorld(): ViewportWorld {
  return new ViewportWorld();
}

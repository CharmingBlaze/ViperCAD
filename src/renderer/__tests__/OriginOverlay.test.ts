import { describe, it, expect } from "vitest";
import { OriginOverlay } from "@/renderer/OriginOverlay";
import { PerspectiveCamera, OrthographicCamera } from "three";

describe("OriginOverlay (Visual Origin / Pivot Representation)", () => {
  it("initializes hidden", () => {
    const overlay = new OriginOverlay();
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.root.visible).toBe(false);
  });

  it("becomes visible only when show is true", () => {
    const overlay = new OriginOverlay();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);

    // Sync with show = false
    overlay.sync({ x: 0, y: 0, z: 0 }, camera, 600, false);
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.root.visible).toBe(false);

    // Sync with show = true
    overlay.sync({ x: 2, y: 3, z: 4 }, camera, 600, true);
    expect(overlay.isVisible()).toBe(true);
    expect(overlay.root.visible).toBe(true);
    expect(overlay.root.position.x).toBeCloseTo(2);
    expect(overlay.root.position.y).toBeCloseTo(3);
    expect(overlay.root.position.z).toBeCloseTo(4);
  });

  it("scales screen-stably in Perspective and Orthographic cameras", () => {
    const overlay = new OriginOverlay();
    const persp = new PerspectiveCamera(60, 1, 0.1, 100);
    persp.position.set(0, 0, 10);
    overlay.sync({ x: 0, y: 0, z: 0 }, persp, 600, true);
    const scale10 = overlay.root.scale.x;

    persp.position.set(0, 0, 20);
    overlay.sync({ x: 0, y: 0, z: 0 }, persp, 600, true);
    const scale20 = overlay.root.scale.x;

    // At double distance, world scale should double to stay constant pixel size
    expect(scale20).toBeCloseTo(scale10 * 2, 2);

    const ortho = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    overlay.sync({ x: 0, y: 0, z: 0 }, ortho, 600, true);
    expect(overlay.root.scale.x).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { createEmptyDocument, commitMeshObject } from "@/core/document/ModelDocument";
import { buildBox } from "@/core/mesh/builders/BoxBuilder";
import { transformPoint } from "@/core/math/Transform";
import { getObjectWorldTransform } from "@/core/editor/Hierarchy";
import {
  getObjectOrigin,
  setObjectOrigin,
  centerObjectOrigin,
  setObjectOriginToBase,
  setObjectOriginToTop,
  setObjectOriginToScene,
  getObjectWorldBounds,
  captureOriginSnapshot,
  restoreOriginSnapshot,
} from "@/core/editor/OriginTools";
import { v3 } from "@/core/math/Vec3";

describe("OriginTools (Blockbench-style pivot / origin controls)", () => {
  it("gets and sets object origin while keeping world geometry stationary", () => {
    const doc = createEmptyDocument("Test");
    const mesh = buildBox({ width: 2, height: 2, depth: 2, name: "Cube", centered: true });
    const { objectId } = commitMeshObject(doc, mesh, { name: "CubeObj" });
    const object = doc.objects.get(objectId)!;
    object.transform.position = { x: 5, y: 10, z: -4 };

    // Initial origin
    const initialOrigin = getObjectOrigin(doc, objectId);
    expect(initialOrigin.x).toBeCloseTo(5);
    expect(initialOrigin.y).toBeCloseTo(10);
    expect(initialOrigin.z).toBeCloseTo(-4);

    // Record world positions of all vertices before origin move
    const xformBefore = getObjectWorldTransform(doc, objectId);
    const worldVertsBefore = [...mesh.vertices.values()].map((v) =>
      transformPoint(v.position, xformBefore),
    );

    // Move origin to new position (e.g. at corner {x: 6, y: 11, z: -3})
    const newOrigin = v3(6, 11, -3);
    setObjectOrigin(doc, objectId, newOrigin);

    // Origin must now be at new position
    const originAfter = getObjectOrigin(doc, objectId);
    expect(originAfter.x).toBeCloseTo(6);
    expect(originAfter.y).toBeCloseTo(11);
    expect(originAfter.z).toBeCloseTo(-3);

    // World positions of all vertices must remain 100% identical!
    const xformAfter = getObjectWorldTransform(doc, objectId);
    const worldVertsAfter = [...mesh.vertices.values()].map((v) =>
      transformPoint(v.position, xformAfter),
    );

    expect(worldVertsAfter.length).toBe(worldVertsBefore.length);
    for (let i = 0; i < worldVertsBefore.length; i++) {
      expect(worldVertsAfter[i]!.x).toBeCloseTo(worldVertsBefore[i]!.x, 5);
      expect(worldVertsAfter[i]!.y).toBeCloseTo(worldVertsBefore[i]!.y, 5);
      expect(worldVertsAfter[i]!.z).toBeCloseTo(worldVertsBefore[i]!.z, 5);
    }
  });

  it("calculates geometry bounds and centers origin", () => {
    const doc = createEmptyDocument("Test");
    const mesh = buildBox({ width: 4, height: 6, depth: 8, name: "Box", centered: true });
    const { objectId } = commitMeshObject(doc, mesh, { name: "BoxObj" });
    const object = doc.objects.get(objectId)!;
    object.transform.position = { x: 10, y: 20, z: 30 };

    const bounds = getObjectWorldBounds(doc, objectId);
    expect(bounds).not.toBeNull();
    expect(bounds!.center.x).toBeCloseTo(10);
    expect(bounds!.center.y).toBeCloseTo(20);
    expect(bounds!.center.z).toBeCloseTo(30);
    expect(bounds!.size.x).toBeCloseTo(4);
    expect(bounds!.size.y).toBeCloseTo(6);
    expect(bounds!.size.z).toBeCloseTo(8);

    // Center origin should place origin at bounds.center
    centerObjectOrigin(doc, objectId);
    const origin = getObjectOrigin(doc, objectId);
    expect(origin.x).toBeCloseTo(10);
    expect(origin.y).toBeCloseTo(20);
    expect(origin.z).toBeCloseTo(30);
  });

  it("sets origin to base (floor / min Y) and top (max Y)", () => {
    const doc = createEmptyDocument("Test");
    const mesh = buildBox({ width: 2, height: 4, depth: 2, name: "Pillar", centered: true });
    const { objectId } = commitMeshObject(doc, mesh, { name: "PillarObj" });
    const object = doc.objects.get(objectId)!;
    object.transform.position = { x: 0, y: 5, z: 0 }; // bounds Y: [3, 7]

    // Set origin to base
    setObjectOriginToBase(doc, objectId);
    const baseOrigin = getObjectOrigin(doc, objectId);
    expect(baseOrigin.x).toBeCloseTo(0);
    expect(baseOrigin.y).toBeCloseTo(3); // min Y
    expect(baseOrigin.z).toBeCloseTo(0);

    // Set origin to top
    setObjectOriginToTop(doc, objectId);
    const topOrigin = getObjectOrigin(doc, objectId);
    expect(topOrigin.x).toBeCloseTo(0);
    expect(topOrigin.y).toBeCloseTo(7); // max Y
    expect(topOrigin.z).toBeCloseTo(0);

    // Set origin to scene
    setObjectOriginToScene(doc, objectId);
    const sceneOrigin = getObjectOrigin(doc, objectId);
    expect(sceneOrigin.x).toBeCloseTo(0);
    expect(sceneOrigin.y).toBeCloseTo(0);
    expect(sceneOrigin.z).toBeCloseTo(0);
  });

  it("captures and restores origin snapshot", () => {
    const doc = createEmptyDocument("Test");
    const mesh = buildBox({ width: 2, height: 2, depth: 2, name: "Cube", centered: true });
    const { objectId } = commitMeshObject(doc, mesh, { name: "CubeObj" });
    const object = doc.objects.get(objectId)!;
    object.transform.position = { x: 3, y: 4, z: 5 };

    const snapshot = captureOriginSnapshot(doc, objectId);
    expect(snapshot).not.toBeNull();

    // Modify origin
    setObjectOrigin(doc, objectId, v3(10, 20, 30));
    expect(getObjectOrigin(doc, objectId).x).toBeCloseTo(10);

    // Restore snapshot
    restoreOriginSnapshot(doc, snapshot!);
    expect(getObjectOrigin(doc, objectId).x).toBeCloseTo(3);
    expect(getObjectOrigin(doc, objectId).y).toBeCloseTo(4);
    expect(getObjectOrigin(doc, objectId).z).toBeCloseTo(5);
  });
});

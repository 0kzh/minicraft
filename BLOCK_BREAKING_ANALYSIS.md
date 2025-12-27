# Block Breaking Logic Analysis - Minicraft

## Overview

This document provides a comprehensive analysis of all logic related to breaking blocks in the Minicraft codebase, including input handling, rendering updates, calculations, and performance considerations.

---

## Table of Contents

1. [Input Handling](#1-input-handling)
2. [Block Selection via Raycasting](#2-block-selection-via-raycasting)
3. [World-Level Block Removal](#3-world-level-block-removal)
4. [Chunk-Level Block Removal](#4-chunk-level-block-removal)
5. [Mesh Instance Deletion](#5-mesh-instance-deletion)
6. [Adjacent Block Revealing](#6-adjacent-block-revealing)
7. [Obscurity Detection](#7-obscurity-detection)
8. [Audio System](#8-audio-system)
9. [Calculations & Rerenders](#9-calculations--rerenders)
10. [Flow Diagram](#10-flow-diagram)

---

## 1. Input Handling

**File:** `src/Game.ts`

**Lines:** 214-222

```typescript
onMouseDown(event: MouseEvent) {
  if (this.player.controls.isLocked) {
    if (event.button === 0 && this.player.selectedCoords) {
      // Left click
      this.world.removeBlock(
        Math.ceil(this.player.selectedCoords.x - 0.5),
        Math.ceil(this.player.selectedCoords.y - 0.5),
        Math.ceil(this.player.selectedCoords.z - 0.5)
      );
```

**Triggers:**
- Left mouse button (event.button === 0)
- Pointer lock controls must be active
- Player must have a block selected (`selectedCoords` is not null)

**Coordinate Transformation:**
- Uses `Math.ceil(coord - 0.5)` to convert from block center coordinates to integer block coordinates

---

## 2. Block Selection via Raycasting

**File:** `src/Player.ts`

**Lines:** 225-273

### Raycaster Setup

```typescript
raycaster = new THREE.Raycaster(
  new THREE.Vector3(),
  new THREE.Vector3(),
  0,
  5  // Maximum distance of 5 blocks
);
```

### Selection Process

```typescript
updateRaycaster(world: World) {
  this.raycaster.setFromCamera(CENTER_SCREEN, this.camera);
  const intersections = this.raycaster.intersectObjects(world.children, true);

  if (intersections.length > 0) {
    const intersection = intersections[0];

    // Get the chunk associated with the selected block
    const chunk = intersection.object.parent;

    if (intersection.instanceId == null || !chunk) {
      this.selectionHelper.visible = false;
      return;
    }

    // Get the transformation matrix for the selected block
    const blockMatrix = new THREE.Matrix4();
    (intersection.object as THREE.InstancedMesh).getMatrixAt(
      intersection.instanceId,
      blockMatrix
    );

    // Undo rotation from block matrix
    const rotationMatrix = new THREE.Matrix4().extractRotation(blockMatrix);
    const inverseRotationMatrix = rotationMatrix.invert();
    blockMatrix.multiply(inverseRotationMatrix);

    // Set the selected coordinates to origin of chunk
    // Then apply transformation matrix of block to get block coords
    this.selectedCoords = chunk.position.clone();
    this.selectedCoords.applyMatrix4(blockMatrix);

    // Get the bounding box of the selected block
    const boundingBox = new THREE.Box3().setFromObject(intersection.object);
    this.selectedBlockSize = boundingBox.getSize(new THREE.Vector3());

    if (this.activeBlockId !== BlockID.Air && intersection.normal) {
      // Update block placement coords to be 1 block over in the direction of the normal
      this.blockPlacementCoords = this.selectedCoords
        .clone()
        .add(intersection.normal);
    }

    this.selectionHelper.position.copy(this.selectedCoords);
    this.selectionHelper.visible = true;
  } else {
    this.selectedCoords = null;
    this.selectionHelper.visible = false;
  }
}
```

**Process:**
1. Casts ray from center of screen (0, 0) into world
2. Intersects with instanced meshes (world chunks)
3. Retrieves instance ID of intersected block
4. Extracts transformation matrix from the instance
5. Removes rotation to get position only
6. Converts chunk-relative position to world coordinates
7. Updates visual selection helper (black wireframe cube)
8. Called every frame in `Player.update()`

**Visual Feedback:**
- `selectionHelper`: A Line2 object rendering a black wireframe cube around the selected block

---

## 3. World-Level Block Removal

**File:** `src/World.ts`

**Lines:** 324-363

```typescript
removeBlock(x: number, y: number, z: number) {
  const coords = this.worldToChunkCoords(x, y, z);
  const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
  const blockToRemove = this.getBlock(x, y, z);

  if (blockToRemove?.block === BlockID.Bedrock) {
    return;
  }

  if (chunk && chunk.loaded) {
    // console.log(`Removing block at ${x}, ${y}, ${z} for chunk ${chunk.uuid}`);

    chunk.removeBlock(coords.block.x, coords.block.y, coords.block.z);
    if (this.pointLights.has(this.getBlockKey(x, y, z))) {
      const light = this.pointLights.get(this.getBlockKey(x, y, z));
      if (light) {
        this.scene.remove(light);
        this.pointLights.delete(this.getBlockKey(x, y, z));
      }
    }

    // Reveal any adjacent blocks that may have been exposed after the block at (x,y,z) was removed
    this.revealBlock(x - 1, y, z);
    this.revealBlock(x + 1, y, z);
    this.revealBlock(x, y - 1, z);
    this.revealBlock(x, y + 1, z);
    this.revealBlock(x, y, z - 1);
    this.revealBlock(x, y, z + 1);

    // if above block is passthrough, remove it as well
    const aboveBlock = this.getBlock(x, y + 1, z);
    if (
      aboveBlock &&
      BlockFactory.getBlock(aboveBlock.block).canPassThrough &&
      aboveBlock.block !== BlockID.Air
    ) {
      this.removeBlock(x, y + 1, z);
    }
  }
}
```

### Key Operations:

#### 3.1 Bedrock Protection
```typescript
if (blockToRemove?.block === BlockID.Bedrock) {
  return;
}
```
Prevents players from breaking bedrock blocks (world boundaries).

#### 3.2 Light Source Removal
```typescript
if (this.pointLights.has(this.getBlockKey(x, y, z))) {
  const light = this.pointLights.get(this.getBlockKey(x, y, z));
  if (light) {
    this.scene.remove(light);
    this.pointLights.delete(this.getBlockKey(x, y, z));
  }
}
```
- Checks if the broken block was a light source (e.g., RedstoneLamp)
- Removes THREE.PointLight from scene
- Cleans up from pointLights map

#### 3.3 Adjacent Block Revealing
```typescript
this.revealBlock(x - 1, y, z);  // Left
this.revealBlock(x + 1, y, z);  // Right
this.revealBlock(x, y - 1, z);  // Down
this.revealBlock(x, y + 1, z);  // Up
this.revealBlock(x, y, z - 1);  // Back
this.revealBlock(x, y, z + 1);  // Front
```
Makes previously hidden adjacent blocks visible (6 directions).

#### 3.4 Passthrough Cascade
```typescript
const aboveBlock = this.getBlock(x, y + 1, z);
if (
  aboveBlock &&
  BlockFactory.getBlock(aboveBlock.block).canPassThrough &&
  aboveBlock.block !== BlockID.Air
) {
  this.removeBlock(x, y + 1, z);
}
```
- Recursively removes passthrough blocks (flowers, grass) sitting on top of broken blocks
- Prevents floating vegetation

**Passthrough Blocks:**
- TallGrass
- FlowerDandelion
- FlowerRose

---

## 4. Chunk-Level Block Removal

**File:** `src/WorldChunk.ts`

**Lines:** 270-286

```typescript
removeBlock(x: number, y: number, z: number) {
  // console.log(`Removing block at ${x}, ${y}, ${z}`);
  const block = this.getBlock(x, y, z);
  if (block && block.block !== BlockID.Air) {
    this.playBlockSound(block.block);
    this.deleteBlockInstance(x, y, z);
    this.setBlockId(x, y, z, BlockID.Air);
    this.dataStore.set(
      this.position.x,
      this.position.z,
      x,
      y,
      z,
      BlockID.Air
    );
  }
}
```

### Operations:

1. **Sound Playback** - `playBlockSound()`: Plays appropriate breaking sound based on block type
2. **Instance Deletion** - `deleteBlockInstance()`: Removes mesh instance from rendering
3. **Block Data Update** - `setBlockId()`: Changes block type to Air in chunk data
4. **Persistence** - `dataStore.set()`: Saves the change to DataStore for world persistence

### Coordinate System:
- `x, y, z`: Chunk-relative coordinates (0-15 for x/z, 0-31 for y)
- `this.position.x, this.position.z`: Chunk world position

---

## 5. Mesh Instance Deletion

**File:** `src/WorldChunk.ts`

**Lines:** 361-402

```typescript
deleteBlockInstance(x: number, y: number, z: number) {
  const block = this.getBlock(x, y, z);

  if (block?.block === BlockID.Air || !block?.instanceIds.length) {
    return;
  }

  // Get the mesh of the block
  const mesh = this.children.find(
    (instanceMesh) =>
      instanceMesh.name ===
      BlockFactory.getBlock(block.block).constructor.name
  ) as THREE.InstancedMesh;

  // We can't remove instances directly, so we need to swap each with the last instance and decrement count by 1
  block.instanceIds.forEach((instanceId) => {
    const lastMatrix = new THREE.Matrix4();
    mesh.getMatrixAt(mesh.count - 1, lastMatrix);

    // Also need to get block coords of instance to update instance id of the block
    const lastBlockCoords = new THREE.Vector3();
    lastBlockCoords.setFromMatrixPosition(lastMatrix);
    this.setBlockInstanceIds(
      Math.floor(lastBlockCoords.x),
      Math.floor(lastBlockCoords.y),
      Math.floor(lastBlockCoords.z),
      [instanceId]
    );

    // Swap transformation matrices
    mesh.setMatrixAt(instanceId, lastMatrix);

    // Decrement instance count
    mesh.count--;

    // Notify the instanced mesh we updated the instance matrix
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  this.setBlockInstanceIds(x, y, z, []);
}
```

### Why This Is Complex

THREE.js `InstancedMesh` doesn't support direct instance removal. The workaround:

1. **Get Last Instance Matrix**: Retrieve the transformation matrix of the last instance in the mesh
2. **Extract Position**: Get world coordinates from the last instance's matrix
3. **Update References**: Update the block data of the last instance to point to the removed instance's ID
4. **Swap Matrices**: Overwrite the removed instance's matrix with the last instance's matrix
5. **Decrement Count**: Reduce mesh instance count by 1 (hides the last instance)
6. **GPU Update**: Mark `instanceMatrix.needsUpdate = true` to update GPU buffers
7. **Recalculate Bounds**: Call `computeBoundingSphere()` to maintain accurate raycasting

### Instance ID Management

Blocks can have multiple instance IDs:
- **Cube blocks**: 1 instance ID (solid cubes)
- **Cross blocks**: 2 instance IDs (two intersecting planes for plants/flowers)

```typescript
// From generateMeshes() in WorldChunk.ts
if (blockClass.geometry == RenderGeometry.Cube) {
  const instanceId = mesh.count++;
  this.setBlockInstanceIds(x, y, z, [instanceId]);
} else if (blockClass.geometry == RenderGeometry.Cross) {
  const instanceId1 = mesh.count++;
  const instanceId2 = mesh.count++;
  this.setBlockInstanceIds(x, y, z, [instanceId1, instanceId2]);
}
```

---

## 6. Adjacent Block Revealing

**File:** `src/World.ts` and `src/WorldChunk.ts`

### World.revealBlock()

**Lines:** 414-422 in `src/World.ts`

```typescript
revealBlock(x: number, y: number, z: number) {
  // console.log(`Revealing block at ${x}, ${y}, ${z}`);
  const coords = this.worldToChunkCoords(x, y, z);
  const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);

  if (chunk && chunk.loaded) {
    chunk.addBlockInstance(coords.block.x, coords.block.y, coords.block.z);
  }
}
```

### WorldChunk.addBlockInstance()

**Lines:** 310-356 in `src/WorldChunk.ts`

```typescript
addBlockInstance(x: number, y: number, z: number) {
  const block = this.getBlock(x, y, z);

  // If the block is not air and doesn't have an instance id, create a new instance
  if (
    block &&
    block.block !== BlockID.Air &&
    block.instanceIds.length === 0
  ) {
    const blockClass = BlockFactory.getBlock(block.block);
    const mesh = this.children.find(
      (instanceMesh) => instanceMesh.name === blockClass.constructor.name
    ) as THREE.InstancedMesh;

    if (mesh) {
      this.playBlockSound(block.block);
      if (blockClass.geometry == RenderGeometry.Cube) {
        const instanceId = mesh.count++;
        this.setBlockInstanceIds(x, y, z, [instanceId]);

        // Update the appropriate instanced mesh and re-compute the bounding sphere so raycasting works
        const matrix = new THREE.Matrix4();
        matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(instanceId, matrix);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      } else if (blockClass.geometry == RenderGeometry.Cross) {
        const instanceId1 = mesh.count++;
        const instanceId2 = mesh.count++;
        this.setBlockInstanceIds(x, y, z, [instanceId1, instanceId2]);

        const matrix1 = new THREE.Matrix4();
        matrix1.makeRotationY(Math.PI / 4);
        matrix1.setPosition(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(instanceId1, matrix1);

        const matrix2 = new THREE.Matrix4();
        matrix2.makeRotationY(-Math.PI / 4);
        matrix2.setPosition(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(instanceId2, matrix2);

        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }
}
```

### Purpose

This system reveals blocks that were previously hidden because they were completely surrounded. When a block is broken, adjacent blocks may now be visible and need to be rendered.

### Optimization Context

Blocks that are completely surrounded by opaque blocks are not rendered (no mesh instances created). This is checked during initial chunk generation via `isBlockObscured()`. When blocks are broken, this optimization needs to be undone for exposed faces.

---

## 7. Obscurity Detection

**File:** `src/WorldChunk.ts`

**Lines:** 427-456

```typescript
isBlockObscured(x: number, y: number, z: number): boolean {
  const up = this.getBlock(x, y + 1, z);
  const down = this.getBlock(x, y - 1, z);
  const left = this.getBlock(x - 1, y, z);
  const right = this.getBlock(x + 1, y, z);
  const front = this.getBlock(x, y, z + 1);
  const back = this.getBlock(x, y, z - 1);

  const getBlockClass = (blockId: BlockID) => BlockFactory.getBlock(blockId);

  // If any of the block's sides are exposed, it's not obscured
  if (
    !up ||
    !down ||
    !left ||
    !right ||
    !front ||
    !back ||
    getBlockClass(up.block).transparent ||
    getBlockClass(down.block).transparent ||
    getBlockClass(left.block).transparent ||
    getBlockClass(right.block).transparent ||
    getBlockClass(front.block).transparent ||
    getBlockClass(back.block).transparent
  ) {
    return false;
  }

  return true;
}
```

### Logic:

A block is considered **obscured** (and not rendered) if:
- All 6 adjacent blocks exist
- All 6 adjacent blocks are opaque (not transparent)

A block is **visible** (and rendered) if:
- Any adjacent position is empty/null
- Any adjacent block is transparent (leaves, glass, etc.)

### Related: Block Hiding on Placement

**File:** `src/World.ts`, Lines: 314-321

```typescript
// Hide any blocks that may be totally obscured
this.hideBlockIfNeeded(x - 1, y, z);
this.hideBlockIfNeeded(x + 1, y, z);
this.hideBlockIfNeeded(x, y - 1, z);
this.hideBlockIfNeeded(x, y + 1, z);
this.hideBlockIfNeeded(x, y, z - 1);
this.hideBlockIfNeeded(x, y, z + 1);
```

When a block is placed, adjacent blocks may become fully obscured and can be hidden to save rendering.

**Lines:** 427-439 in `src/World.ts`

```typescript
hideBlockIfNeeded(x: number, y: number, z: number) {
  const coords = this.worldToChunkCoords(x, y, z);
  const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);

  if (
    chunk &&
    chunk.loaded &&
    chunk.isBlockObscured(coords.block.x, coords.block.y, coords.block.z)
  ) {
    // console.log(`Hiding block at ${x}, ${y}, ${z}`);
    chunk.deleteBlockInstance(coords.block.x, coords.block.y, coords.block.z);
  }
}
```

---

## 8. Audio System

**File:** `src/WorldChunk.ts`

**Lines:** 288-305

```typescript
async playBlockSound(blockId: BlockID) {
  switch (blockId) {
    case BlockID.Grass:
    case BlockID.Dirt:
    case BlockID.Leaves:
    case BlockID.TallGrass:
    case BlockID.FlowerDandelion:
    case BlockID.FlowerRose:
      audioManager.play("dig.grass");
      break;
    case BlockID.OakLog:
      audioManager.play("dig.wood");
      break;
    default:
      audioManager.play("dig.stone");
      break;
  }
}
```

### Sound Categories:

1. **dig.grass** - Organic/soft blocks
   - Grass
   - Dirt
   - Leaves
   - TallGrass
   - Flowers (Dandelion, Rose)

2. **dig.wood** - Wood blocks
   - OakLog

3. **dig.stone** - Hard blocks (default)
   - Stone
   - StoneBrick
   - Coal Ore
   - Iron Ore
   - Bedrock
   - RedstoneLamp

### Audio Implementation

The audio system uses Howler.js with sprite sheets for efficient sound management.

**Files:**
- `src/audio/AudioManager.ts` - Audio manager singleton
- `src/audio/sprite.json` - Audio sprite definitions
- `public/audio/sprite.mp3` / `sprite.webm` - Audio sprite files

---

## 9. Calculations & Rerenders

### 9.1 Per-Block-Break Operations

#### Matrix Operations
- **1× Matrix Retrieval**: `mesh.getMatrixAt(mesh.count - 1, lastMatrix)` for the swap
- **1× Position Extraction**: `lastBlockCoords.setFromMatrixPosition(lastMatrix)`
- **1× Matrix Set**: `mesh.setMatrixAt(instanceId, lastMatrix)` to perform the swap

#### GPU Updates (Critical Performance)
- **1× Instance Matrix Update**: `mesh.instanceMatrix.needsUpdate = true`
  - Triggers GPU buffer reupload
  - Updates vertex shader instance buffer
- **1× Bounding Sphere Recalculation**: `mesh.computeBoundingSphere()`
  - Required for accurate raycasting
  - Recalculates spatial bounds of the mesh

#### Data Structure Updates
- **Block ID Update**: Set block type to `BlockID.Air`
- **Instance ID Clear**: Empty the `instanceIds` array
- **DataStore Write**: Persist change to in-memory world state

### 9.2 Adjacent Block Operations (×6 per break)

For each of the 6 adjacent blocks (up, down, left, right, front, back):

```typescript
this.revealBlock(x ± 1, y, z);  // or y ± 1, or z ± 1
```

Each `revealBlock()` call potentially adds a block instance:
- **1× Block Data Check**: Verify block exists and has no instance
- **1× Mesh Lookup**: Find appropriate instanced mesh
- **1-2× Matrix Creation**: Create transformation matrix (1 for cubes, 2 for cross geometry)
- **1-2× Matrix Set**: `mesh.setMatrixAt(instanceId, matrix)`
- **1× GPU Update**: `mesh.instanceMatrix.needsUpdate = true`
- **1× Bounding Sphere**: `mesh.computeBoundingSphere()`
- **1× Sound Playback**: Optional, plays when revealing

**Best Case**: 0 adjacent blocks revealed (all were already visible)
**Worst Case**: 6 adjacent blocks revealed with 6 GPU updates and 6 bounding sphere recalculations

### 9.3 Cascading Operations

#### Passthrough Block Removal (Recursive)
If the block above is a passthrough block (grass, flowers):
- Recursive call to `removeBlock(x, y + 1, z)`
- All operations repeat for that block
- Can cascade upward (e.g., breaking dirt under a flower removes the flower)

#### Light Source Cleanup
If the broken block was a light source:
- **1× Point Light Removal**: `this.scene.remove(light)`
- **1× Map Deletion**: `this.pointLights.delete(key)`
- Affects scene lighting calculations

### 9.4 Total Computational Cost

**Minimum (breaking an already-exposed block):**
- 1 block removal
- 1 mesh instance deletion (swap + GPU update)
- 0-6 adjacent reveals (checking only, no creation)
- 1 sound playback
- 1 DataStore write

**Maximum (breaking a fully-buried block with passthrough above):**
- 2+ block removals (original + cascade)
- 2+ mesh instance deletions
- 6 adjacent reveals with mesh instance additions
- 12 GPU buffer updates (6 deletions + 6 additions)
- 12 bounding sphere recalculations
- 2+ sound playbacks
- 2+ DataStore writes
- Possible light removal

### 9.5 Performance Characteristics

#### Strengths:
- **Instanced Rendering**: All blocks of same type share one mesh, reducing draw calls
- **Culling Optimization**: Only renders visible blocks (non-obscured)
- **Efficient Raycasting**: Uses THREE.js InstancedMesh raycasting with bounding spheres

#### Bottlenecks:
- **GPU Buffer Updates**: `instanceMatrix.needsUpdate` triggers full buffer reupload
- **Bounding Sphere Recalculation**: O(n) operation where n = instance count
- **Per-Frame Raycasting**: Raycaster runs every frame for block selection

#### Optimization Opportunities:
- **Batch Updates**: Multiple block breaks could batch GPU updates
- **Dirty Bounding Sphere**: Only recalculate when necessary (currently done every time)
- **Spatial Partitioning**: Could optimize raycasting with octree/BVH
- **Deferred Updates**: Could defer non-critical updates to idle time

---

## 10. Flow Diagram

### Complete Block Break Flow

```
┌─────────────────────────────────────┐
│  Player Left-Clicks (Mouse Button 0) │
└────────────┬────────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │ Game.onMouseDown() │
    └────────┬───────────┘
             │
             ▼
    ┌─────────────────────────────┐
    │ Check Controls Locked?       │
    │ Check selectedCoords exists? │
    └────────┬────────────────────┘
             │ Yes
             ▼
    ┌─────────────────────────┐
    │ World.removeBlock()      │
    │ (x, y, z world coords)   │
    └────────┬────────────────┘
             │
             ▼
    ┌─────────────────────────┐
    │ Convert to Chunk Coords  │
    │ worldToChunkCoords()     │
    └────────┬────────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ Is Block Bedrock?     │
    └────┬─────────────┬───┘
         │ Yes         │ No
         ▼             ▼
    ┌────────┐   ┌──────────────────────┐
    │ ABORT  │   │ WorldChunk.          │
    │        │   │ removeBlock()         │
    └────────┘   └─────────┬────────────┘
                           │
                           ▼
                 ┌──────────────────────────┐
                 │ 1. Play Block Sound       │
                 │    - dig.grass            │
                 │    - dig.wood             │
                 │    - dig.stone            │
                 └─────────┬────────────────┘
                           │
                           ▼
                 ┌──────────────────────────┐
                 │ 2. deleteBlockInstance()  │
                 │    ┌──────────────────┐   │
                 │    │ - Swap with last │   │
                 │    │ - Update refs    │   │
                 │    │ - Decrement count│   │
                 │    │ - GPU update     │   │
                 │    │ - Recompute bounds│  │
                 │    └──────────────────┘   │
                 └─────────┬────────────────┘
                           │
                           ▼
                 ┌──────────────────────────┐
                 │ 3. Set Block to Air       │
                 │    setBlockId()           │
                 └─────────┬────────────────┘
                           │
                           ▼
                 ┌──────────────────────────┐
                 │ 4. Save to DataStore      │
                 │    (persist change)       │
                 └─────────┬────────────────┘
                           │
                           ▼
            ┌──────────────────────────────────┐
            │ Back to World.removeBlock()       │
            │ Post-processing:                  │
            └───────┬──────────────────────────┘
                    │
                    ├──────────────────────────┐
                    │                          │
                    ▼                          ▼
         ┌────────────────────┐    ┌─────────────────────┐
         │ Is Light Source?    │    │ Reveal Adjacent (×6)│
         └──┬──────────┬──────┘    │ ┌─────────────────┐ │
            │ Yes      │ No         │ │ Left   (x-1)    │ │
            ▼          │            │ │ Right  (x+1)    │ │
    ┌──────────────┐  │            │ │ Down   (y-1)    │ │
    │ Remove Point │  │            │ │ Up     (y+1)    │ │
    │ Light        │  │            │ │ Back   (z-1)    │ │
    │ - scene.remove│ │            │ │ Front  (z+1)    │ │
    │ - delete from│  │            │ └─────────┬───────┘ │
    │   map        │  │            └───────────┼─────────┘
    └──────┬───────┘  │                        │
           │          │            ┌───────────▼─────────┐
           └──────────┘            │ addBlockInstance()  │
                    │              │ (for each adjacent) │
                    │              │ ┌─────────────────┐ │
                    │              │ │ If not visible: │ │
                    │              │ │ - Add instance  │ │
                    │              │ │ - Create matrix │ │
                    │              │ │ - GPU update    │ │
                    │              │ │ - Recompute     │ │
                    │              │ │   bounds        │ │
                    │              │ └─────────────────┘ │
                    │              └─────────────────────┘
                    │
                    ▼
         ┌────────────────────────────┐
         │ Check Block Above           │
         │ (y + 1)                     │
         └──────────┬─────────────────┘
                    │
                    ▼
         ┌────────────────────────────┐
         │ Is Passthrough Block?       │
         │ (TallGrass, Flowers)        │
         └──┬──────────────────┬──────┘
            │ Yes              │ No
            ▼                  ▼
    ┌──────────────────┐  ┌────────┐
    │ RECURSIVE CALL    │  │ Done   │
    │ removeBlock()     │  └────────┘
    │ (x, y+1, z)       │
    │                   │
    │ Cascades upward   │
    └───────────────────┘
```

### Performance Flow (GPU Operations)

```
Block Break Event
    │
    ├─► [1] Instance Deletion
    │       └─► GPU Buffer Update
    │       └─► Bounding Sphere Recalc
    │
    ├─► [2-7] Adjacent Reveals (0-6 blocks)
    │       └─► GPU Buffer Update (each)
    │       └─► Bounding Sphere Recalc (each)
    │
    ├─► [8] Light Removal (if applicable)
    │       └─► Scene Lighting Update
    │
    └─► [9] Cascade Break (if passthrough above)
            └─► Repeat entire flow recursively

Total GPU Updates: 1-14+ per break
Total Bounding Sphere: 1-14+ per break
```

---

## Summary

The block breaking system in Minicraft is a sophisticated pipeline that:

1. **Uses raycasting** to select blocks from the player's perspective
2. **Employs instanced rendering** for performance, requiring complex swap operations for deletion
3. **Maintains spatial coherence** by revealing and hiding adjacent blocks based on visibility
4. **Cascades removals** for passthrough blocks (vegetation)
5. **Manages dynamic lighting** by removing point lights when light source blocks are broken
6. **Provides audio feedback** with material-appropriate sounds
7. **Persists changes** to an in-memory DataStore for world saving

### Key Technical Points:

- **No particle effects or animations** - immediate visual feedback only
- **Instanced mesh architecture** - optimized for large voxel worlds
- **GPU-bound operations** - buffer updates and bounding sphere recalculations
- **Recursive behavior** - passthrough blocks cascade upward
- **Spatial optimization** - obscured blocks aren't rendered

### Performance Considerations:

- Each block break triggers **1-14+ GPU buffer updates**
- **Bounding sphere recalculation** is O(n) where n = mesh instance count
- **Adjacent block processing** can reveal up to 6 new instances
- **Cascading breaks** multiply the cost recursively

The system prioritizes visual correctness and spatial optimization over break animations or particle effects, making it efficient for a browser-based voxel engine.

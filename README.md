<div align="center">
  <a href="https://github.com/othneildrew/Best-README-Template">
    <img src="https://github.com/0kzh/minicraft/assets/9621004/7bcb67eb-2491-4dc5-8649-c6f7035aaf97" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Minicraft</h3>

  <p align="center">
    A web-based Minecraft clone using THREE.js
    <br />
    <a href="https://minecraft.kelvinzhang.ca"><strong>Demo »</strong></a>
    <br />
    <br />
    <a href="https://github.com/othneildrew/Best-README-Template/issues">Report Bug</a>
    ·
    <a href="https://github.com/othneildrew/Best-README-Template/issues">Request Feature</a>
  </p>
</div>


A Minecraft clone built in [THREE.js](https://threejs.org/) as a final project for a [graphics course](https://student.cs.uwaterloo.ca/~cs488/Fall2023) at the University of Waterloo. 

https://github.com/0kzh/minicraft/assets/9621004/1b5432d7-dc20-4147-b8db-5fa180d94142

### Features
* Voxel-based rendering system
* Infinite world generation
* Breaking/placing blocks
* Tweened FOV changes when sprinting
* Day/night cycles
* Dynamic shadows based on sun position
* Block lighting sources
* Transparent blocks
* Sound effects

### Developing
- `npm install`
- `npm run dev`
- Navigate to [localhost:5173](http://localhost:5173)

### Controls
- `WASD` keys to move the player
- `Double tap W` to sprint 
- `Space` to jump
- `Left click` to break blocks
- `Right click` to place blocks
- `Numbers 1-9` to cycle through toolbar
- `R` to reset position
- `Esc` to disable pointer-lock/go into orbit mode

### Screenshots
**Orbit view**
![Orbit view](https://github.com/0kzh/minicraft/assets/9621004/8e46ce09-9442-4bb1-94b2-d2394e403cdf)

**Procedurally generated ore**
![Procedurally generated ore blocks](https://github.com/0kzh/minicraft/assets/9621004/2f4a0342-1246-4663-896d-5bdabafdda3f)

**Render fog**
![Render fog](https://github.com/0kzh/minicraft/assets/9621004/6cea76fe-8b29-4738-aa2a-3df59c70f06f)

### Objectives
1. Voxel Rendering System: Implement a voxel rendering system for a 3D matrix of blocks, each with unique properties like texture and translucency, and create a data structure and functions for rendering each voxel.

2. Texture Mapping: Develop a texture mapping system to apply image textures to block faces, with support for transparency in textures for blocks such as leaves, grass, and water.

3. Procedural Terrain Generation: Generate an infinite world using noise functions, rendering it in 16x16 chunks, with dynamic loading/unloading of chunks as the player moves, and adding fog for depth illusion. Ensure generated structures like trees render seamlessly between chunks.

4. Performance Optimizations: Implement at least three optimizations for smooth browser gameplay

5. Block Shading: Shade blocks based on their orientation relative to a simulated sunlight source.

6. Player Physics and Collision Detection: Develop a simple physics engine for realistic player movement, including walking, jumping, and gravity, along with efficient collision detection to prevent passing through objects.

7. Interactive Block Mechanics: Implement mechanics to allow players to break and place blocks, using raycasting for block detection, highlighting, and enabling block removal or placement.

8. Skydome: Create a skydome encompassing the play area, with a dynamic day-night cycle that affects the world's lighting conditions, featuring transitions between dawn, daylight, dusk, and night.

9. Procedural Generation of Environmental Structures: Algorithmically generate and place natural structures like trees and flowers, ensuring logical placement and natural patterns without unnatural overlaps.

10. Lighting: Enhance the lighting engine to support day/night cycle effects and additional placeable light blocks which will influence the visibility and shading of nearby objects.

### License
This project is licensed under the MIT License.

### Sources
- [Reinventing Minecraft world generation by Henrik Kniberg](https://www.youtube.com/watch?v=ob3VwY4JyzE)
- [Tutorials by Coffee Code Create](https://www.youtube.com/playlist?list=PLtzt35QOXmkKALLv9RzT8oGwN5qwmRjTo)
- [How Minecraft Actually Works by Alan Zucconi](https://www.youtube.com/watch?v=YyVAaJqYAfE)
- [Three.js Journey by Bruno Simon](https://threejs-journey.com)

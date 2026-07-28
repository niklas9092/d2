# Mystikbyggaren Multiplayer v36

Korrigering av den vita celebration-rutan i v35.

## Orsak
A-Frame hann skapa eller återställa sitt standardmaterial på `a-plane`.
Canvastexturen kunde därför ersättas av en vit standardyta.

## Lösning
Celebration-bannern är nu ett vanligt `a-entity` med:
- egen `THREE.PlaneGeometry`
- egen `THREE.MeshBasicMaterial`
- canvastexturen direkt som materialets `map`
- avstängd depth test och depth write
- hög renderOrder
- explicit texture update
- korrekt städning av texture, material och geometry

Animationen körs fortfarande i A-Frames WebXR-loop.

# Mystikbyggaren Multiplayer v35

Liten korrigering av v34.

## Fix
Celebration-texten använde webbläsarens vanliga `requestAnimationFrame`.
Den kan pausas när ett headset går in i immersive WebXR, så bannern skapades
men dess rörelse startade inte.

I v35 körs bannerns animation i en A-Frame-komponent (`celebration-banner`)
som uppdateras i WebXR-renderloopen. Därför visas och rör sig texten både på
dator och inne i VR-headset.

Övrig multiplayerkod från v33/v34 är oförändrad.

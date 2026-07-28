# Ordbyggaren Multiplayer v44

Bokstavsfysikens WebXR-komponent hade fortfarande en rad som stoppade hela
fysikloopen när den lokala spelaren var fryst. Den är nu borttagen.

- En fryst fysikvärd fortsätter simulera bokstäver.
- Kubpaket fortsätter skickas var 200 ms.
- Övriga spelare fortsätter interpolera rörelsen.
- Servern byter inte fysikvärd bara för att spelaren fryses.
- Värdbyte sker fortfarande om fysikvärden lämnar rummet.
- Frysningen påverkar endast spelarens rigg, kontroller, jetpack och buren bokstav.

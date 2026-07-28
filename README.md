# Ordbyggaren Multiplayer v42

## Frysning
- Träffad spelare låses till exakt rig-position och rotation i tio sekunder.
- Stickrörelse, armsving, jetpack, trigger och A-knapp blockeras.
- Hastighet och jetpack nollställs.
- En stor kamerafäst timer visar 10, 9, 8 ... 1, 0.
- Isblocket visas samtidigt för alla.

## Mjuk gemensam kubfysik
- Kubpositioner teleporteras inte längre vid varje nätpaket.
- Klienter interpolerar position och rotation mjukt mot servermålen.
- Paket har löpnummer så äldre paket ignoreras.
- Endast fysikvärden simulerar lösa kuber.

## Rätt bokstav i multiplayer
- Serverns placeringsstatus är alltid auktoritativ.
- En lokalt buren eller gömd kub tvingas fram och placeras om servern säger att den sitter i en ruta.
- Placerade kuber kan inte döljas av ett försenat ägarmeddelande.
- Rätt bokstav blir synlig, grön och fast hos alla spelare.

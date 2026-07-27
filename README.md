# Fruktbyggaren Cloudflare Multiplayer v33

## Kritiska multiplayerfixar
- En ny spelare skickar aldrig en tom lokal spelstatus vid anslutning.
- Serverns sparade rum är alltid auktoritativt vid `welcome`.
- Att någon ansluter kan därför inte längre starta om spelet.
- Spelarpositioner skickas från en A-Frame-komponent som körs i WebXR-renderloopen.
- Figurer jämnas ut i samma WebXR-loop; de fryser inte när vanlig browser-RAF pausas.
- Huvud, händer, armar och buren bokstav synkroniseras.
- Senaste pose sparas i WebSocket-attachment och skickas direkt till nya spelare.
- Figurer döljs först efter ett verkligt långt anslutningsavbrott.

## Poäng och sparning
- Varje korrekt låst bokstav sparas i Durable Object-lagringen och ger 1 poäng.
- Färdigt ord ger ytterligare 10 poäng.
- Rumstatus återställs från servern när en spelare ansluter.

Ladda upp filerna till samma GitHub-repository och gör en commit.

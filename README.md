# Ordbyggaren Multiplayer v47

## Grundfelet bakom fram-och-tillbaka-rörelsen

Servern läste spelstatus från Durable Object-lagringen för varje kubpaket.
Kubsekvensen och senaste heartbeat sparades däremot bara ibland. Flera paket
fick därför samma sekvensnummer.

Spelare 2 ignorerade då nästan alla paket. Watchdoggen trodde att värden hade
slutat skicka och utsåg en ny fysikvärd. Två simuleringar kunde därefter dra
kubarna mellan olika positioner.

## v47

- Klienten accepterar alla kubpaket i WebSocket-ordning.
- Durable Object håller den levande kubströmmen i minnet.
- Exakt en fysikvärd accepteras av servern.
- Senaste levande heartbeat används för watchdoggen.
- En aktiv värd ersätts inte på grund av gammal lagringsdata.
- Nya spelare får serverns senaste levande kubbild.
- Servern begär ett omedelbart paket när någon ansluter.
- Kubstatus sparas till lagring ungefär var femte sekund, men används inte
  som realtidskälla.
- Vid frånkoppling väljs en enda ny värd och den ombeds synka direkt.

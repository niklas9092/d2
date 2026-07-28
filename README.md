# Ordbyggaren Multiplayer v43

## Frysstråle
- Frysstrålen kan användas högst en gång var 60:e sekund per spelare.
- Cooldown kontrolleras både lokalt och av servern.
- Missad stråle förbrukar också laddningen.
- Försök under cooldown visar återstående sekunder.

## Ljud
- Strålen har stigande energiljud, isigt brus och avfyrningsslag.
- Träff ger ett kraftigt iskristall-ljud.
- Timern har ett tydligt tick varje sekund.
- De sista tre sekunderna låter mer brådskande.
- Upptining avslutas med en ljus tvåtons-signal.

## Kubarna stannar inte vid frysning
- Fysikvärden sparas nu uttryckligen i rummets serverstatus.
- Om fysikvärden träffas av frysstrålen flyttas värdskapet direkt till en annan aktiv spelare.
- Kubfysiken är helt frikopplad från spelarens frysta rörelselås.
- Vid frånkoppling väljs också en ny fysikvärd automatiskt.
